const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { once } = require("node:events");
const jwt = require("jsonwebtoken");
const createApp = require("../app");

process.env.AUTH_TOKEN_SECRET =
  "personal-collection-test-secret-at-least-thirty-two-bytes";

class FakeQuery {
  constructor(resolve) {
    this.resolve = resolve;
  }

  select() {
    return this;
  }

  sort() {
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve().then(this.resolve).then(resolve, reject);
  }
}

const users = new Map([
  ["111111111111111111111111", { _id: "111111111111111111111111", email: "one@example.test", role: "normal", tokenVersion: 0 }],
  ["222222222222222222222222", { _id: "222222222222222222222222", email: "two@example.test", role: "normal", tokenVersion: 0 }],
]);

class FakeUserModel {
  static findById(id) {
    return new FakeQuery(() => users.get(String(id)) || null);
  }
}

class FakePersonalMovie {
  constructor(fields) {
    Object.assign(this, fields);
    this._id = `${this.userId}-${this.tmdbId}`;
    this.updatedAt = new Date();
  }

  async save() {
    FakePersonalMovieModel.records.set(
      `${this.userId}:${this.tmdbId}`,
      this
    );
    return this;
  }
}

class FakePersonalMovieModel {
  static records = new Map();

  static find({ userId }) {
    return new FakeQuery(() =>
      [...this.records.values()].filter((movie) => movie.userId === userId)
    );
  }

  static async findOne({ userId, tmdbId }) {
    return this.records.get(`${userId}:${tmdbId}`) || null;
  }

  static async findOneAndUpdate({ userId, tmdbId }, update) {
    const movie = this.records.get(`${userId}:${tmdbId}`);
    if (!movie) return null;
    Object.assign(movie, update.$set);
    return movie;
  }

  static async findOneAndDelete({ userId, tmdbId }) {
    const key = `${userId}:${tmdbId}`;
    const movie = this.records.get(key);
    this.records.delete(key);
    return movie || null;
  }

  static async countDocuments({ userId }) {
    return [...this.records.values()].filter((movie) => movie.userId === userId).length;
  }

  static async create(fields) {
    return new FakePersonalMovie(fields).save();
  }
}

const tokenFor = (id) =>
  jwt.sign(
    { sub: id, ver: 0 },
    process.env.AUTH_TOKEN_SECRET,
    { algorithm: "HS256", audience: "noir-client", issuer: "noir-api", expiresIn: "15m" }
  );

const moviePayload = {
  tmdbId: 42,
  title: "The Example",
  posterPath: "/poster.jpg",
  releaseYear: 2024,
  genre: "Drama",
  overview: "A private note belongs to each account.",
  isFavorite: true,
  isWatched: false,
  note: "Watch this later.",
  rating: 8,
};

let server;
let baseUrl;

before(async () => {
  server = createApp({
    UserModel: FakeUserModel,
    PersonalMovieModel: FakePersonalMovieModel,
    tmdbRequest: async (path) => {
      assert.ok(["/trending/movie/week", "/movie/popular"].includes(path));
      return {
        data: {
          page: 1,
          results: [{ id: 42, title: path === "/movie/popular" ? "Popular Example" : "The Example" }],
          total_pages: 1,
        },
      };
    },
  }).listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/api/collections/me`;
});

beforeEach(() => {
  FakePersonalMovieModel.records.clear();
});

after(async () => {
  server.close();
  await once(server, "close");
});

test("requires authentication for personal collections", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 401);
});

test("keeps TMDB discovery public", async () => {
  const trendingResponse = await fetch(
    `${baseUrl.replace("/api/collections/me", "/api/movies")}/discover`
  );
  assert.equal(trendingResponse.status, 200);
  assert.equal((await trendingResponse.json()).results[0].title, "The Example");

  const popularResponse = await fetch(
    `${baseUrl.replace("/api/collections/me", "/api/movies")}/discover?sort=popular`
  );
  assert.equal(popularResponse.status, 200);
  assert.equal((await popularResponse.json()).results[0].title, "Popular Example");
});

test("stores and reads personal collection items only for the authenticated owner", async () => {
  const firstToken = tokenFor("111111111111111111111111");
  const secondToken = tokenFor("222222222222222222222222");

  const saveResponse = await fetch(`${baseUrl}/items/42`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${firstToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(moviePayload),
  });
  assert.equal(saveResponse.status, 200);

  const firstCollection = await fetch(baseUrl, {
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  const firstData = await firstCollection.json();
  assert.equal(firstData.items.length, 1);
  assert.equal(firstData.items[0].note, moviePayload.note);

  const secondCollection = await fetch(baseUrl, {
    headers: { Authorization: `Bearer ${secondToken}` },
  });
  assert.deepEqual((await secondCollection.json()).items, []);

  const secondDelete = await fetch(`${baseUrl}/items/42`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secondToken}` },
  });
  assert.equal(secondDelete.status, 404);
});

test("rejects arbitrary collection fields and invalid data", async () => {
  const response = await fetch(`${baseUrl}/items/42`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokenFor("111111111111111111111111")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...moviePayload, userId: "222222222222222222222222" }),
  });
  assert.equal(response.status, 400);
});

test("merges guest movies by TMDB ID without replacing account notes or ratings", async () => {
  const token = tokenFor("111111111111111111111111");
  await fetch(`${baseUrl}/items/42`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...moviePayload, note: "My existing note", rating: 6 }),
  });

  const response = await fetch(`${baseUrl}/merge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { ...moviePayload, note: "Guest note", rating: 9, isWatched: true },
        { ...moviePayload, isFavorite: false, note: "Duplicate note" },
      ],
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mergedCount, 1);
  assert.equal(result.items[0].note, "My existing note");
  assert.equal(result.items[0].rating, 6);
  assert.equal(result.items[0].isFavorite, true);
  assert.equal(result.items[0].isWatched, true);
});

test("does not accept an unauthenticated guest merge", async () => {
  const response = await fetch(`${baseUrl}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [moviePayload] }),
  });
  assert.equal(response.status, 401);
});
