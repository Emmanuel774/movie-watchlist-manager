const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { once } = require("node:events");
const bcrypt = require("bcryptjs");

process.env.AUTH_TOKEN_SECRET =
  "movie-authorization-test-secret-at-least-thirty-two-bytes";

const createApp = require("../app");

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

class FakeUser {
  constructor({ email, passwordHash, role = "normal" }) {
    this._id = require("node:crypto").randomBytes(12).toString("hex");
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
    this.tokenVersion = 0;
  }

  async save() {
    FakeUserModel.users.set(String(this._id), this);
    return this;
  }
}

class FakeUserModel {
  static users = new Map();

  static findOne({ email }) {
    return new FakeQuery(() =>
      [...this.users.values()].find((user) => user.email === email) || null
    );
  }

  static findById(id) {
    return new FakeQuery(() => this.users.get(String(id)) || null);
  }

  static async create(data) {
    return new FakeUser(data).save();
  }
}

class FakeMovie {
  constructor(fields) {
    Object.assign(this, fields);
    this._id = require("node:crypto").randomBytes(12).toString("hex");
    this.createdAt = new Date();
    this.updatedAt = this.createdAt;
  }

  async save() {
    FakeMovieModel.records.set(String(this._id), this);
    return this;
  }
}

class FakeMovieModel {
  static records = new Map();
  static db = { readyState: 1 };

  constructor(fields) {
    return new FakeMovie(fields);
  }

  static find() {
    return new FakeQuery(() => [...this.records.values()]);
  }

  static findById(id) {
    return new FakeQuery(() => this.records.get(String(id)) || null);
  }

  static async findByIdAndUpdate(id, update) {
    const movie = this.records.get(String(id));
    if (!movie) return null;
    Object.assign(movie, update.$set);
    movie.updatedAt = new Date();
    return movie;
  }

  static async findByIdAndDelete(id) {
    const movie = this.records.get(String(id));
    if (movie) this.records.delete(String(id));
    return movie || null;
  }
}

const tmdbRequest = async (path) => {
  if (path === "/discover/movie") {
    return { data: { results: [{ id: 77, backdrop_path: "/feature.jpg" }] } };
  }
  if (path === "/search/movie") {
    return {
      data: {
        results: [
          {
            id: 123,
            title: "Example Movie",
            original_title: "Example Movie",
            release_date: "2024-01-01",
          },
        ],
      },
    };
  }
  if (path === "/movie/77") {
    return {
      data: {
        id: 77,
        title: "Featured Movie",
        backdrop_path: "/feature.jpg",
        videos: {
          results: [
            {
              site: "YouTube",
              type: "Trailer",
              key: "featured-trailer",
              official: true,
            },
          ],
        },
      },
    };
  }
  if (path === "/movie/123/videos") {
    return {
      data: {
        results: [
          {
            site: "YouTube",
            type: "Trailer",
            key: "example-trailer",
            official: true,
          },
        ],
      },
    };
  }
  return {
    data: {
      id: 123,
      title: "Example Movie",
      overview: "A test movie.",
      videos: { results: [] },
    },
  };
};

let server;
let baseUrl;

before(async () => {
  server = createApp({
    UserModel: FakeUserModel,
    MovieModel: FakeMovieModel,
    tmdbRequest,
  }).listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  FakeUserModel.users.clear();
  FakeMovieModel.records.clear();
});

let requestIp = 1;
const request = async (path, { method = "GET", body, token, ip } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "X-Forwarded-For": ip || `192.0.2.${requestIp++}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
};

const moviePayload = {
  title: "Example Movie",
  genre: "Drama",
  releaseYear: 2024,
  status: "Want to Watch",
};

const seedUserToken = async (role, email) => {
  await FakeUserModel.create({
    email,
    passwordHash: await bcrypt.hash("StrongPassword123", 4),
    role,
  });

  const response = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "StrongPassword123" },
  });
  assert.equal(response.status, 200);
  return response.body.token;
};

const seedMovie = async () => {
  const movie = await new FakeMovie(moviePayload).save();
  return movie;
};

test("unauthenticated users cannot create, update, or delete movies", async () => {
  const movie = await seedMovie();

  const create = await request("/api/movies", {
    method: "POST",
    body: moviePayload,
  });
  const update = await request(`/api/movies/${movie._id}`, {
    method: "PUT",
    body: { status: "Watched" },
  });
  const remove = await request(`/api/movies/${movie._id}`, {
    method: "DELETE",
  });

  assert.equal(create.status, 401);
  assert.equal(update.status, 401);
  assert.equal(remove.status, 401);
  assert.equal(movie.status, "Want to Watch");
  assert.equal(FakeMovieModel.records.size, 1);
});

test("normal users have read-only movie access and cannot modify records", async () => {
  const token = await seedUserToken("normal", "reader@example.com");
  const movie = await seedMovie();

  const list = await request("/api/movies", { token });
  const create = await request("/api/movies", {
    method: "POST",
    token,
    body: moviePayload,
  });
  const update = await request(`/api/movies/${movie._id}`, {
    method: "PUT",
    token,
    body: { status: "Watched" },
  });
  const remove = await request(`/api/movies/${movie._id}`, {
    method: "DELETE",
    token,
  });

  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(create.status, 403);
  assert.equal(update.status, 403);
  assert.equal(remove.status, 403);
  assert.equal(movie.status, "Want to Watch");
});

test("administrators can create, update, and delete movie records", async () => {
  const token = await seedUserToken("admin", "admin@example.com");

  const create = await request("/api/movies", {
    method: "POST",
    token,
    body: moviePayload,
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.title, moviePayload.title);

  const update = await request(`/api/movies/${create.body._id}`, {
    method: "PUT",
    token,
    body: { status: "Watched", overview: "Seen." },
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.status, "Watched");
  assert.equal(update.body.overview, "Seen.");

  const remove = await request(`/api/movies/${create.body._id}`, {
    method: "DELETE",
    token,
  });
  assert.equal(remove.status, 200);
  assert.equal(FakeMovieModel.records.size, 0);
});

test("movie updates reject unknown fields, invalid values, and empty updates", async () => {
  const token = await seedUserToken("admin", "editor@example.com");
  const movie = await seedMovie();

  for (const body of [
    { role: "admin" },
    { status: "Queued" },
    { releaseYear: "2024" },
    { title: "   " },
    {},
  ]) {
    const response = await request(`/api/movies/${movie._id}`, {
      method: "PUT",
      token,
      body,
    });
    assert.equal(response.status, 400);
  }

  assert.equal(movie.status, "Want to Watch");
  assert.equal(movie.title, moviePayload.title);

  const missing = await request(`/api/movies/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "PUT",
    token,
    body: { status: "Watched" },
  });
  assert.equal(missing.status, 404);
});

test("movie collection browsing and public TMDB discovery endpoints remain available", async () => {
  await seedMovie();

  const list = await request("/api/movies");
  const featured = await request("/api/movies/featured");
  const search = await request("/api/movies/search?query=Example");
  const details = await request("/api/movies/details/123");
  const preview = await request("/api/movies/video-preview?title=Example%20Movie");

  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(featured.status, 200);
  assert.equal(featured.body.featured_trailer_key, "featured-trailer");
  assert.equal(search.status, 200);
  assert.equal(search.body[0].title, "Example Movie");
  assert.equal(details.status, 200);
  assert.equal(details.body.title, "Example Movie");
  assert.equal(preview.status, 200);
  assert.equal(preview.body.key, "example-trailer");
});

test("TMDB resolution remains readable but does not persist metadata for unauthenticated or normal users", async () => {
  const movie = await seedMovie();

  const unauthenticated = await request(`/api/movies/${movie._id}/resolve-tmdb`, {
    method: "POST",
  });
  assert.equal(unauthenticated.status, 200);
  assert.equal(unauthenticated.body.tmdbId, 123);
  assert.equal(movie.tmdbId, undefined);

  const normalToken = await seedUserToken("normal", "normal@example.com");
  const normal = await request(`/api/movies/${movie._id}/resolve-tmdb`, {
    method: "POST",
    token: normalToken,
  });
  assert.equal(normal.status, 200);
  assert.equal(normal.body.tmdbId, 123);
  assert.equal(movie.tmdbId, undefined);
});

test("administrators can resolve TMDB metadata for existing movies", async () => {
  const movie = await seedMovie();
  const token = await seedUserToken("admin", "metadata-admin@example.com");
  const response = await request(`/api/movies/${movie._id}/resolve-tmdb`, {
    method: "POST",
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.tmdbId, 123);
  assert.equal(movie.tmdbId, 123);
});

test("registration and login endpoints apply per-IP rate limits", async () => {
  const registrationIp = "198.51.100.10";
  const loginIp = "198.51.100.11";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request("/api/auth/register", {
      method: "POST",
      ip: registrationIp,
      body: { email: "invalid", password: "weak" },
    });
    assert.equal(response.status, 400);
  }

  const registrationLimited = await request("/api/auth/register", {
    method: "POST",
    ip: registrationIp,
    body: { email: "invalid", password: "weak" },
  });
  assert.equal(registrationLimited.status, 429);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request("/api/auth/login", {
      method: "POST",
      ip: loginIp,
      body: { email: "invalid", password: "" },
    });
    assert.equal(response.status, 400);
  }

  const loginLimited = await request("/api/auth/login", {
    method: "POST",
    ip: loginIp,
    body: { email: "invalid", password: "" },
  });
  assert.equal(loginLimited.status, 429);
});
