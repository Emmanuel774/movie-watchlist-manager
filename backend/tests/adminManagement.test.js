const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { once } = require("node:events");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

process.env.AUTH_TOKEN_SECRET =
  "admin-management-test-secret-with-more-than-thirty-two-bytes";

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
  constructor({ email, passwordHash, role = "normal", tokenVersion = 0 }) {
    this._id = crypto.randomBytes(12).toString("hex");
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
    this.tokenVersion = tokenVersion;
    this.createdAt = new Date();
    this.updatedAt = this.createdAt;
  }

  async save() {
    FakeUserModel.users.set(String(this._id), this);
    return this;
  }
}

class FakeUserModel {
  static users = new Map();

  static findOne({ email }) {
    return new FakeQuery(
      () => [...this.users.values()].find((user) => user.email === email) || null
    );
  }

  static findById(id) {
    return new FakeQuery(() => this.users.get(String(id)) || null);
  }

  static find() {
    return new FakeQuery(() =>
      [...this.users.values()].sort(
        (left, right) => right.createdAt - left.createdAt
      )
    );
  }

  static async countDocuments(filter = {}) {
    return [...this.users.values()].filter((user) =>
      Object.entries(filter).every(([key, value]) => user[key] === value)
    ).length;
  }

  static async create(data) {
    if ([...this.users.values()].some((user) => user.email === data.email)) {
      const error = new Error("Duplicate email");
      error.code = 11000;
      throw error;
    }

    return new FakeUser(data).save();
  }

  static async findByIdAndUpdate(id, update) {
    const user = this.users.get(String(id));
    if (!user) return null;
    Object.assign(user, update.$set);
    if (update.$inc) {
      user.tokenVersion += update.$inc.tokenVersion;
    }
    user.updatedAt = new Date();
    return user;
  }

  static async findByIdAndDelete(id) {
    const user = this.users.get(String(id));
    if (user) this.users.delete(String(id));
    return user || null;
  }
}

class FakeMovieModel {
  static total = 0;

  static async countDocuments() {
    return this.total;
  }
}

let server;
let baseUrl;

before(async () => {
  server = createApp({
    UserModel: FakeUserModel,
    MovieModel: FakeMovieModel,
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
  FakeMovieModel.total = 7;
});

let requestIp = 1;
const request = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "X-Forwarded-For": `198.51.100.${requestIp++}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: response.status, body: await response.json() };
};

const seedUser = async (email, role) =>
  FakeUserModel.create({
    email,
    role,
    passwordHash: await bcrypt.hash("StrongPassword123", 4),
  });

const getToken = async (email) => {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "StrongPassword123" },
  });
  assert.equal(result.status, 200);
  return result.body.token;
};

test("administrator dashboard reports live movie and user statistics", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  await seedUser("member@example.com", "normal");
  const token = await getToken(admin.email);

  const dashboard = await request("/api/admin/dashboard", { token });
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.body.stats, {
    totalMovies: 7,
    totalUsers: 2,
    totalAdmins: 1,
    totalNormalUsers: 1,
  });
});

test("admin user operations require authentication and administrator role", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  const normal = await seedUser("member@example.com", "normal");
  const adminToken = await getToken(admin.email);
  const normalToken = await getToken(normal.email);

  const cases = [
    ["/api/admin/dashboard", "GET"],
    ["/api/admin/users", "GET"],
    ["/api/admin/users", "POST"],
    [`/api/admin/users/${normal._id}`, "PATCH"],
    [`/api/admin/users/${normal._id}`, "DELETE"],
  ];

  for (const [path, method] of cases) {
    assert.equal((await request(path, { method })).status, 401);
    assert.equal((await request(path, { method, token: normalToken })).status, 403);
  }

  const userList = await request("/api/admin/users", { token: adminToken });
  assert.equal(userList.status, 200);
  assert.equal(JSON.stringify(userList.body).includes("passwordHash"), false);
  assert.equal(JSON.stringify(userList.body).includes("tokenVersion"), false);
});

test("administrator can create normal users without exposing password hashes", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  const token = await getToken(admin.email);

  const created = await request("/api/admin/users", {
    method: "POST",
    token,
    body: { email: " NEW@example.com ", password: "StrongPassword123" },
  });

  assert.equal(created.status, 201);
  assert.deepEqual(created.body.user, {
    id: created.body.user.id,
    email: "new@example.com",
    role: "normal",
  });
  assert.equal(JSON.stringify(created.body).includes("passwordHash"), false);
  const stored = FakeUserModel.users.get(created.body.user.id);
  assert.equal(await bcrypt.compare("StrongPassword123", stored.passwordHash), true);

  const attemptedAdmin = await request("/api/admin/users", {
    method: "POST",
    token,
    body: {
      email: "new-admin@example.com",
      password: "StrongPassword123",
      role: "admin",
    },
  });
  assert.equal(attemptedAdmin.status, 400);

  const weakPassword = await request("/api/admin/users", {
    method: "POST",
    token,
    body: { email: "weak@example.com", password: "weak" },
  });
  assert.equal(weakPassword.status, 400);
});

test("administrator can update a user's email and role, invalidating their old token", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  const normal = await seedUser("member@example.com", "normal");
  const adminToken = await getToken(admin.email);
  const oldUserToken = await getToken(normal.email);

  const updated = await request(`/api/admin/users/${normal._id}`, {
    method: "PATCH",
    token: adminToken,
    body: { email: "updated@example.com", role: "admin" },
  });

  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.user, {
    id: normal._id,
    email: "updated@example.com",
    role: "admin",
  });
  assert.equal(
    (await request("/api/auth/me", { token: oldUserToken })).status,
    401
  );
});

test("administrator can demote another administrator and invalidate that account's token", async () => {
  const actor = await seedUser("actor@example.com", "admin");
  const target = await seedUser("target@example.com", "admin");
  const actorToken = await getToken(actor.email);
  const targetToken = await getToken(target.email);

  const demoted = await request(`/api/admin/users/${target._id}`, {
    method: "PATCH",
    token: actorToken,
    body: { role: "normal" },
  });

  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.user.role, "normal");
  assert.equal(await FakeUserModel.countDocuments({ role: "admin" }), 1);
  assert.equal((await request("/api/auth/me", { token: targetToken })).status, 401);
});

test("administrator can delete users but cannot remove the last administrator", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  const normal = await seedUser("member@example.com", "normal");
  const secondAdmin = await seedUser("second-admin@example.com", "admin");
  const token = await getToken(admin.email);

  const deleted = await request(`/api/admin/users/${normal._id}`, {
    method: "DELETE",
    token,
  });
  assert.equal(deleted.status, 200);
  assert.equal(FakeUserModel.users.has(String(normal._id)), false);

  const removedAdmin = await request(`/api/admin/users/${secondAdmin._id}`, {
    method: "DELETE",
    token,
  });
  assert.equal(removedAdmin.status, 200);
  assert.equal(await FakeUserModel.countDocuments({ role: "admin" }), 1);

  const selfDelete = await request(`/api/admin/users/${admin._id}`, {
    method: "DELETE",
    token,
  });
  assert.equal(selfDelete.status, 409);
  assert.equal(FakeUserModel.users.has(String(admin._id)), true);
  assert.equal(await FakeUserModel.countDocuments({ role: "admin" }), 1);
});

test("invalid update input and last-administrator self-demotion are rejected", async () => {
  const admin = await seedUser("admin@example.com", "admin");
  const token = await getToken(admin.email);

  const invalidEmail = await request(`/api/admin/users/${admin._id}`, {
    method: "PATCH",
    token,
    body: { email: "invalid" },
  });
  assert.equal(invalidEmail.status, 400);

  const invalidRole = await request(`/api/admin/users/${admin._id}`, {
    method: "PATCH",
    token,
    body: { role: "superuser" },
  });
  assert.equal(invalidRole.status, 400);

  const arbitraryField = await request(`/api/admin/users/${admin._id}`, {
    method: "PATCH",
    token,
    body: { tokenVersion: 0 },
  });
  assert.equal(arbitraryField.status, 400);

  const invalidId = await request("/api/admin/users/not-an-id", {
    method: "PATCH",
    token,
    body: { role: "normal" },
  });
  assert.equal(invalidId.status, 400);

  const missingUser = await request("/api/admin/users/ffffffffffffffffffffffff", {
    method: "DELETE",
    token,
  });
  assert.equal(missingUser.status, 404);

  const selfDemotion = await request(`/api/admin/users/${admin._id}`, {
    method: "PATCH",
    token,
    body: { role: "normal" },
  });
  assert.equal(selfDemotion.status, 409);
  assert.equal(admin.role, "admin");
  assert.equal(await FakeUserModel.countDocuments({ role: "admin" }), 1);
});
