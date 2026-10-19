const jwt = require("jsonwebtoken");
const User = require("../Models/User");

const getTokenSecret = () => {
  const secret = process.env.AUTH_TOKEN_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Authentication token secret is not configured.");
  }

  return secret;
};

const publicUser = (user) => ({
  id: String(user._id),
  email: user.email,
  role: user.role,
});

const authenticate = (UserModel = User) => async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ message: "Authentication required." });
  }

  let secret;
  try {
    secret = getTokenSecret();
  } catch {
    return res.status(503).json({ message: "Authentication is not configured." });
  }

  let payload;
  try {
    payload = jwt.verify(match[1], secret, {
      algorithms: ["HS256"],
      audience: "noir-client",
      issuer: "noir-api",
    });
  } catch {
    return res.status(401).json({ message: "Invalid or expired authentication token." });
  }

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    !Number.isInteger(payload.ver)
  ) {
    return res.status(401).json({ message: "Invalid or expired authentication token." });
  }

  try {
    const user = await UserModel.findById(payload.sub).select("+tokenVersion");

    if (!user || user.tokenVersion !== payload.ver) {
      return res.status(401).json({ message: "Invalid or expired authentication token." });
    }

    req.user = publicUser(user);
    return next();
  } catch (error) {
    console.error("Authentication lookup failed:", error.name);
    return res.status(500).json({ message: "Unable to authenticate request." });
  }
};

const authenticateOptional = (UserModel = User) => {
  const authenticateRequest = authenticate(UserModel);

  return (req, res, next) => {
    if (!req.get("authorization")) {
      return next();
    }

    return authenticateRequest(req, res, next);
  };
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required." });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "You are not authorized to perform this action." });
  }

  return next();
};

const requireAdmin = authorizeRoles("admin");

module.exports = {
  authenticate,
  authenticateOptional,
  authorizeRoles,
  getTokenSecret,
  publicUser,
  requireAdmin,
};
