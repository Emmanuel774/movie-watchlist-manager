require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../Models/User");
const {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
} = require("../utils/authValidation");

const BCRYPT_COST = 12;

const provisionAdmin = async () => {
  const { INITIAL_ADMIN_EMAIL: email, INITIAL_ADMIN_PASSWORD: password } =
    process.env;

  if (!process.env.MONGO_URI) {
    console.error("Admin provisioning requires the database configuration.");
    process.exitCode = 1;
    return;
  }

  if (!isValidEmail(email) || !isStrongPassword(password)) {
    console.error("Provide valid initial-admin credentials through the provisioning environment.");
    process.exitCode = 1;
    return;
  }

  let connected = false;

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      autoSelectFamily: false,
    });
    connected = true;

    if (await User.exists({ role: "admin" })) {
      console.error("An administrator already exists; provisioning is disabled.");
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await User.create({
      email: normalizeEmail(email),
      passwordHash,
      role: "admin",
    });

    console.log("Initial administrator provisioned successfully.");
  } catch (error) {
    console.error(
      "Admin provisioning failed:",
      error.code === 11000 ? "The email is already registered." : error.name
    );
    process.exitCode = 1;
  } finally {
    if (connected) {
      await mongoose.disconnect();
    }
  }
};

provisionAdmin();
