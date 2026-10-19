const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { once } = require("node:events");
const bcrypt = require("bcryptjs");

process.env.AUTH_TOKEN_SECRET =
  "test-only-secret-with-at-least-thirty-two-bytes";

const createApp = require("../app");
const { authorizeRoles } = require("../middleware/authMiddleware");

class FakeQuery {
  constructor(resolve) {
    this.resolve = resolve;
  }

  select() {
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

  static async findByIdAndUpdate(id, update) {
    const user = this.users.get(String(id));
    if (!user) return null;
    user.tokenVersion += update.$inc.tokenVersion;
    return user;
  }

  static async create(data) {
    if ([...this.users.values()].some((user) => user.email === data.email)) {
      const error = new Error("Duplicate email");
      error.code = 11000;
      throw error;
    }

    return new FakeUser(data).save();
  }
}

let server;
let baseUrl;

before(async () => {
  server = createApp({ UserModel: FakeUserModel }).listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  FakeUserModel.users.clear();
});

const request = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
};

const register = (email = "person@example.com", password = "StrongPassword123") =>
  request("/register", {
    method: "POST",
    body: { email, password },
  });

const login = (email = "person@example.com", password = "StrongPassword123") =>
  request("/login", {
    method: "POST",
    body: { email, password },
  });

test("registration validates inputs, ignores a requested admin role, and stores only a hash", async () => {
  const invalid = await request("/register", {
    method: "POST",
    body: { email: "not-an-email", password: "weak" },
  });
  assert.equal(invalid.status, 400);

  const result = await request("/register", {
    method: "POST",
    body: {
      email: " Person@Example.com ",
      password: "StrongPassword123",
      role: "admin",
    },
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.body.user, {
    id: result.body.user.id,
    email: "person@example.com",
    role: "normal",
  });
  assert.equal(JSON.stringify(result.body).includes("passwordHash"), false);

  const stored = FakeUserModel.users.get(result.body.user.id);
  assert.notEqual(stored.passwordHash, "StrongPassword123");
  assert.equal(await bcrypt.compare("StrongPassword123", stored.passwordHash), true);
});

test("registration rejects duplicate email addresses regardless of case", async () => {
  assert.equal((await register()).status, 201);

  const duplicate = await register("PERSON@example.com");
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.message, "An account with this email already exists.");
});

test("login returns the same generic error for unknown users and incorrect passwords", async () => {
  await register();

  const wrongPassword = await login("person@example.com", "WrongPassword123");
  const unknownUser = await login("unknown@example.com", "WrongPassword123");

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(unknownUser.body, wrongPassword.body);
});

test("login issues a bearer token that /me verifies without exposing the hash", async () => {
  await register();
  const loginResponse = await login();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body.tokenType, "Bearer");
  assert.equal(loginResponse.body.expiresIn, 900);
  assert.equal("passwordHash" in loginResponse.body.user, false);

  const me = await request("/me", { token: loginResponse.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "person@example.com");

  const invalid = await request("/me", {
    token: `${loginResponse.body.token}invalid`,
  });
  assert.equal(invalid.status, 401);
});

test("password change requires the current password and invalidates existing tokens", async () => {
  await register();
  const loginResponse = await login();
  const token = loginResponse.body.token;

  const incorrectCurrentPassword = await request("/change-password", {
    method: "POST",
    token,
    body: {
      currentPassword: "WrongPassword123",
      newPassword: "AnotherStrong456",
    },
  });
  assert.equal(incorrectCurrentPassword.status, 400);

  const changed = await request("/change-password", {
    method: "POST",
    token,
    body: {
      currentPassword: "StrongPassword123",
      newPassword: "AnotherStrong456",
    },
  });
  assert.equal(changed.status, 200);
  assert.equal((await request("/me", { token })).status, 401);
  assert.equal((await login("person@example.com", "StrongPassword123")).status, 401);
  assert.equal((await login("person@example.com", "AnotherStrong456")).status, 200);
});

test("logout invalidates all outstanding tokens for that account", async () => {
  await register();
  const loginResponse = await login();
  const logout = await request("/logout", {
    method: "POST",
    token: loginResponse.body.token,
  });

  assert.equal(logout.status, 200);
  assert.equal((await request("/me", { token: loginResponse.body.token })).status, 401);
});

test("role middleware denies normal users and permits admins", async () => {
  const requireAdmin = authorizeRoles("admin");
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextCalled = false;

  requireAdmin(
    { user: { role: "normal" } },
    response,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);

  let adminNextCalled = false;
  requireAdmin(
    { user: { role: "admin" } },
    response,
    () => {
      adminNextCalled = true;
    }
  );
  assert.equal(adminNextCalled, true);
});
