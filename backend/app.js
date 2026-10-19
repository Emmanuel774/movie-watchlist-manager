const express = require("express");
const cors = require("cors");
const createMovieRouter = require("./routes/movieRoutes");
const createAuthRouter = require("./routes/authRoutes");
const createAdminRouter = require("./routes/adminRoutes");
const User = require("./Models/User");
const Movie = require("./Models/Movie");
const {
  authenticate,
  authenticateOptional,
  requireAdmin,
} = require("./middleware/authMiddleware");

const createApp = ({ UserModel, MovieModel, tmdbRequest } = {}) => {
  const app = express();
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
  ].filter(Boolean);

  app.set("trust proxy", 1);
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(UserModel));
  app.use(
    "/api/admin",
    createAdminRouter({
      UserModel,
      MovieModel,
      authenticateMiddleware: authenticate(UserModel),
      requireAdminMiddleware: requireAdmin,
    })
  );
  app.use(
    "/api/movies",
    createMovieRouter({
      MovieModel,
      authenticateMiddleware: authenticate(UserModel),
      optionalAuthenticateMiddleware: authenticateOptional(UserModel),
      requireAdminMiddleware: requireAdmin,
      tmdbRequest,
    })
  );

  app.get("/", (req, res) => {
    res.send("Movie Watchlist Manager API is running!");
  });

  return app;
};

module.exports = createApp;
