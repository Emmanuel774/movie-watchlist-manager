const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { randomBytes } = require("node:crypto");
const User = require("../Models/User");
const {
  authenticate,
  getTokenSecret,
  publicUser,
} = require("../middleware/authMiddleware");
const {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
} = require("../utils/authValidation");

const TOKEN_LIFETIME_SECONDS = 15 * 60;
const BCRYPT_COST = 12;
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many registration attempts. Try again later." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." },
});
let missingUserPasswordHash;

const getMissingUserPasswordHash = () => {
  if (!missingUserPasswordHash) {
    missingUserPasswordHash = bcrypt.hash(
      randomBytes(32).toString("hex"),
      BCRYPT_COST
    );
  }

  return missingUserPasswordHash;
};

const credentialsArePresent = (body) =>
  body &&
  typeof body.email === "string" &&
  typeof body.password === "string";

const createAuthRouter = (UserModel = User) => {
  const router = express.Router();
  const requireAuthentication = authenticate(UserModel);

  router.post("/register", registrationLimiter, async (req, res) => {
    const { email, password } = req.body || {};

    if (
      !credentialsArePresent(req.body) ||
      !isValidEmail(email) ||
      !isStrongPassword(password)
    ) {
      return res.status(400).json({
        message:
          "Provide a valid email and a password of at least 12 characters containing an uppercase letter, a lowercase letter, and a number. Passwords may not exceed 72 UTF-8 bytes.",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    try {
      if (await UserModel.findOne({ email: normalizedEmail })) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const user = await UserModel.create({
        email: normalizedEmail,
        passwordHash,
        role: "normal",
      });

      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }

      console.error("Registration failed:", error.name);
      return res.status(500).json({ message: "Unable to create account." });
    }
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};

    if (
      !credentialsArePresent(req.body) ||
      !isValidEmail(email) ||
      password.length === 0 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({ message: "Provide a valid email and password." });
    }

    let secret;
    try {
      secret = getTokenSecret();
    } catch {
      return res.status(503).json({ message: "Authentication is not configured." });
    }

    try {
      const user = await UserModel.findOne({
        email: normalizeEmail(email),
      }).select("+passwordHash +tokenVersion");
      const passwordHash = user
        ? user.passwordHash
        : await getMissingUserPasswordHash();
      const passwordMatches = await bcrypt.compare(password, passwordHash);

      if (!user || !passwordMatches) {
        return res.status(401).json({ message: "Invalid email or password." });
      }

      const token = jwt.sign(
        { ver: user.tokenVersion },
        secret,
        {
          algorithm: "HS256",
          audience: "noir-client",
          expiresIn: TOKEN_LIFETIME_SECONDS,
          issuer: "noir-api",
          subject: String(user._id),
        }
      );

      return res.json({
        token,
        tokenType: "Bearer",
        expiresIn: TOKEN_LIFETIME_SECONDS,
        user: publicUser(user),
      });
    } catch (error) {
      console.error("Login failed:", error.name);
      return res.status(500).json({ message: "Unable to log in." });
    }
  });

  router.post("/logout", requireAuthentication, async (req, res) => {
    try {
      const updatedUser = await UserModel.findByIdAndUpdate(
        req.user.id,
        { $inc: { tokenVersion: 1 } },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(401).json({ message: "Invalid or expired authentication token." });
      }

      return res.json({
        message: "Logged out. All outstanding tokens for this account have been invalidated.",
      });
    } catch (error) {
      console.error("Logout failed:", error.name);
      return res.status(500).json({ message: "Unable to log out." });
    }
  });

  router.post("/change-password", requireAuthentication, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (
      typeof currentPassword !== "string" ||
      currentPassword.length === 0 ||
      Buffer.byteLength(currentPassword, "utf8") > 72 ||
      !isStrongPassword(newPassword)
    ) {
      return res.status(400).json({
        message:
          "Provide the current password and a new password of at least 12 characters containing an uppercase letter, a lowercase letter, and a number. Passwords may not exceed 72 UTF-8 bytes.",
      });
    }

    try {
      const user = await UserModel.findById(req.user.id).select(
        "+passwordHash +tokenVersion"
      );

      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return res.status(400).json({ message: "Current password is incorrect." });
      }

      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        return res.status(400).json({
          message: "The new password must differ from the current password.",
        });
      }

      user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
      user.tokenVersion += 1;
      await user.save();

      return res.json({ message: "Password changed. Please log in again." });
    } catch (error) {
      console.error("Password change failed:", error.name);
      return res.status(500).json({ message: "Unable to change password." });
    }
  });

  router.get("/me", requireAuthentication, async (req, res) =>
    res.json({ user: req.user })
  );

  return router;
};

module.exports = createAuthRouter;
