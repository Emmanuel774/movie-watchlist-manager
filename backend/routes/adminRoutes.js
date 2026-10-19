const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../Models/User");
const Movie = require("../Models/Movie");
const { publicUser } = require("../middleware/authMiddleware");
const {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
} = require("../utils/authValidation");

const BCRYPT_COST = 12;
const ALLOWED_ROLES = new Set(["admin", "normal"]);

const isRequestObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const onlyAllowedFields = (body, fields) =>
  isRequestObject(body) && Object.keys(body).every((field) => fields.has(field));

const executeWithAdminRosterGuard = async ({
  UserModel,
  actorId,
  targetId,
  mutate,
}) => {
  const connection = UserModel.db;
  if (typeof connection?.startSession !== "function") {
    const target = await UserModel.findById(targetId);
    if (!target) return { status: 404 };
    if (target.role === "admin") {
      const adminCount = await UserModel.countDocuments({ role: "admin" });
      if (adminCount <= 1) return { status: 409, reason: "last-admin" };
    }
    return { value: await mutate(target) };
  }

  const rosterGuard = connection.collection("admin_roster_guards");
  try {
    await rosterGuard.updateOne(
      { _id: "admin-roster" },
      { $setOnInsert: { revision: 0 } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const session = await connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = undefined;
      await rosterGuard.updateOne(
        { _id: "admin-roster" },
        { $inc: { revision: 1 } },
        { session }
      );

      const [actor, target] = await Promise.all([
        UserModel.findById(actorId).session(session),
        UserModel.findById(targetId).session(session),
      ]);
      if (!actor || actor.role !== "admin") {
        result = { status: 403 };
        return;
      }
      if (!target) {
        result = { status: 404 };
        return;
      }

      if (target.role === "admin") {
        const adminCount = await UserModel.countDocuments({ role: "admin" })
          .session(session);
        if (adminCount <= 1) {
          result = { status: 409, reason: "last-admin" };
          return;
        }
      }

      result = { value: await mutate(target, session) };
    });
  } catch (error) {
    if (error.code === 11000 || error.name === "ValidationError") {
      throw error;
    }
    console.error("Admin roster transaction failed:", error.name);
    const transactionError = new Error("Administrator roster transaction failed.");
    transactionError.name = "AdminRosterTransactionError";
    throw transactionError;
  } finally {
    await session.endSession();
  }

  return result;
};

const createAdminRouter = ({
  UserModel = User,
  MovieModel = Movie,
  authenticateMiddleware,
  requireAdminMiddleware,
} = {}) => {
  const router = express.Router();

  router.use(authenticateMiddleware, requireAdminMiddleware);

  router.get("/dashboard", async (req, res) => {
    try {
      const [totalMovies, totalUsers, totalAdmins, totalNormalUsers] =
        await Promise.all([
          MovieModel.countDocuments({}),
          UserModel.countDocuments({}),
          UserModel.countDocuments({ role: "admin" }),
          UserModel.countDocuments({ role: "normal" }),
        ]);

      return res.json({
        stats: { totalMovies, totalUsers, totalAdmins, totalNormalUsers },
      });
    } catch (error) {
      console.error("Admin dashboard lookup failed:", error.name);
      return res.status(500).json({ message: "Unable to load dashboard data." });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const users = await UserModel.find({})
        .select("email role createdAt updatedAt")
        .sort({ createdAt: -1 });

      return res.json({
        users: users.map((user) => ({
          ...publicUser(user),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })),
      });
    } catch (error) {
      console.error("Admin user listing failed:", error.name);
      return res.status(500).json({ message: "Unable to load users." });
    }
  });

  router.post("/users", async (req, res) => {
    if (
      !onlyAllowedFields(req.body, new Set(["email", "password"])) ||
      !isValidEmail(req.body.email) ||
      !isStrongPassword(req.body.password)
    ) {
      return res.status(400).json({
        message:
          "Provide a valid email and a strong password. Administrator-created accounts are normal users.",
      });
    }

    const email = normalizeEmail(req.body.email);
    try {
      if (await UserModel.findOne({ email })) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }

      const user = await UserModel.create({
        email,
        passwordHash: await bcrypt.hash(req.body.password, BCRYPT_COST),
        role: "normal",
      });

      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      if (error.name === "ValidationError") {
        return res.status(400).json({ message: "The user details are invalid." });
      }

      console.error("Admin user creation failed:", error.name);
      return res.status(500).json({ message: "Unable to create user." });
    }
  });

  router.patch("/users/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid user ID is required." });
    }

    const allowedFields = new Set(["email", "role"]);
    if (
      !onlyAllowedFields(req.body, allowedFields) ||
      Object.keys(req.body).length === 0 ||
      ("email" in req.body && !isValidEmail(req.body.email)) ||
      ("role" in req.body && !ALLOWED_ROLES.has(req.body.role))
    ) {
      return res.status(400).json({
        message: "Provide only a valid email address and/or an allowed role.",
      });
    }

    try {
      const existingUser = await UserModel.findById(req.params.id);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found." });
      }

      const isSelf = String(existingUser._id) === req.user.id;
      const nextRole = req.body.role ?? existingUser.role;
      if (isSelf && nextRole !== existingUser.role) {
        return res.status(409).json({
          message: "You cannot change your own administrator role.",
        });
      }

      const updates = {};
      if ("email" in req.body) {
        const email = normalizeEmail(req.body.email);
        const duplicate = await UserModel.findOne({ email });
        if (duplicate && String(duplicate._id) !== String(existingUser._id)) {
          return res.status(409).json({ message: "An account with this email already exists." });
        }
        updates.email = email;
      }

      if ("role" in req.body) updates.role = nextRole;
      const saveUser = async (target, session) => {
        const roleChanged = nextRole !== target.role;
        const update = { $set: updates };
        if (roleChanged) update.$inc = { tokenVersion: 1 };
        return UserModel.findByIdAndUpdate(req.params.id, update, {
          new: true,
          runValidators: true,
          ...(session ? { session } : {}),
        });
      };
      const result =
        existingUser.role === "admin" && nextRole === "normal"
          ? await executeWithAdminRosterGuard({
              UserModel,
              actorId: req.user.id,
              targetId: req.params.id,
              mutate: saveUser,
            })
          : {
              value: await saveUser(existingUser),
            };
      if (result.status === 403) {
        return res.status(403).json({
          message: "You are not authorized to perform this action.",
        });
      }
      if (result.status === 404) {
        return res.status(404).json({ message: "User not found." });
      }
      if (result.status === 409) {
        return res.status(409).json({
          message: "The last administrator cannot be demoted.",
        });
      }
      const user = result.value;
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.json({ user: publicUser(user) });
    } catch (error) {
      if (error.name === "AdminRosterTransactionError") {
        console.error("Admin role change transaction failed:", error.name);
        return res.status(503).json({
          message: "Administrator role changes are temporarily unavailable.",
        });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      if (error.name === "ValidationError") {
        return res.status(400).json({ message: "The user details are invalid." });
      }

      console.error("Admin user update failed:", error.name);
      return res.status(500).json({ message: "Unable to update user." });
    }
  });

  router.delete("/users/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid user ID is required." });
    }

    try {
      const user = await UserModel.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      if (String(user._id) === req.user.id) {
        return res.status(409).json({
          message: "You cannot delete your own administrator account.",
        });
      }

      const deleteUser = (target, session) =>
        UserModel.findByIdAndDelete(req.params.id, session ? { session } : {});
      const result =
        user.role === "admin"
          ? await executeWithAdminRosterGuard({
              UserModel,
              actorId: req.user.id,
              targetId: req.params.id,
              mutate: deleteUser,
            })
          : { value: await deleteUser(user) };
      if (result.status === 403) {
        return res.status(403).json({
          message: "You are not authorized to perform this action.",
        });
      }
      if (result.status === 404) {
        return res.status(404).json({ message: "User not found." });
      }
      if (result.status === 409) {
        return res.status(409).json({
          message: "The last administrator cannot be deleted.",
        });
      }
      const deleted = result.value;
      if (!deleted) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.json({ message: "User deleted." });
    } catch (error) {
      if (error.name === "AdminRosterTransactionError") {
        console.error("Admin deletion transaction failed:", error.name);
        return res.status(503).json({
          message: "Administrator removal is temporarily unavailable.",
        });
      }
      console.error("Admin user deletion failed:", error.name);
      return res.status(500).json({ message: "Unable to delete user." });
    }
  });

  return router;
};

module.exports = createAdminRouter;
