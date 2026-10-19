const express = require("express");
const Movie = require("../Models/Movie");
const axios = require("axios");
const {
  authenticate,
  authenticateOptional,
  requireAdmin,
} = require("../middleware/authMiddleware");

const TMDB_API = "https://api.themoviedb.org/3";
const FEATURED_CACHE_MS = 30 * 60 * 1000;
let featuredMovieCache = null;
const ALLOWED_MOVIE_FIELDS = new Set([
  "title",
  "genre",
  "releaseYear",
  "status",
  "posterPath",
  "tmdbId",
  "overview",
]);
const VALID_MOVIE_STATUSES = new Set([
  "Want to Watch",
  "Watching",
  "Watched",
]);

const isValidMoviePayload = (body, { requireCoreFields = false } = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const fields = Object.keys(body);
  if (
    fields.length === 0 ||
    fields.some((field) => !ALLOWED_MOVIE_FIELDS.has(field)) ||
    (requireCoreFields &&
      !["title", "genre", "releaseYear"].every((field) => field in body))
  ) {
    return false;
  }

  return !(
    ("title" in body && (typeof body.title !== "string" || !body.title.trim())) ||
    ("genre" in body && (typeof body.genre !== "string" || !body.genre.trim())) ||
    ("releaseYear" in body &&
      (!Number.isInteger(body.releaseYear) ||
        body.releaseYear < 1888 ||
        body.releaseYear > 2100)) ||
    ("status" in body && !VALID_MOVIE_STATUSES.has(body.status)) ||
    ("posterPath" in body && typeof body.posterPath !== "string") ||
    ("overview" in body && typeof body.overview !== "string") ||
    ("tmdbId" in body &&
      body.tmdbId !== null &&
      (!Number.isInteger(body.tmdbId) || body.tmdbId < 1))
  );
};

const rankTrailerVideos = (videos = []) =>
  videos
    .filter(
      (video) =>
        video.site === "YouTube" &&
        ["Trailer", "Teaser"].includes(video.type) &&
        video.key
    )
    .sort((left, right) => {
      const priority = (video) => {
        if (video.official && video.type === "Trailer") return 0;
        if (video.official && video.type === "Teaser") return 1;
        if (video.type === "Trailer") return 2;
        return 3;
      };
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference) return priorityDifference;

      const languageDifference =
        Number(right.iso_639_1 === "en") - Number(left.iso_639_1 === "en");
      if (languageDifference) return languageDifference;

      const qualityDifference = (right.size || 0) - (left.size || 0);
      if (qualityDifference) return qualityDifference;

      return new Date(right.published_at || 0) - new Date(left.published_at || 0);
    });

const requestTmdb = async (path, params = {}) => {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await axios.get(`${TMDB_API}${path}`, {
        params: {
          api_key: process.env.TMDB_API_KEY,
          ...params,
        },
        headers: { Accept: "application/json" },
        timeout: 15000,
      });
    } catch (error) {
      lastError = error;
      const retryable =
        !error.response ||
        [429, 500, 502, 503, 504].includes(error.response.status);

      if (!retryable || attempt === 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
};

const normalizeTitle = (title = "") =>
  title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const createMovieRouter = ({
  MovieModel = Movie,
  authenticateMiddleware = authenticate(),
  optionalAuthenticateMiddleware = authenticateOptional(),
  requireAdminMiddleware = requireAdmin,
  tmdbRequest = requestTmdb,
} = {}) => {
const router = express.Router();

// Get all movies
router.get("/", async (req, res) => {
    try {
        const movies = await MovieModel.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (error) {
        console.error("Movie listing failed:", error.name);
        res.status(500).json({ message: "Failed to retrieve movies." });
    }
});

router.get("/featured", async (req, res) => {
  try {
    if (featuredMovieCache && featuredMovieCache.expiresAt > Date.now()) {
      return res.json(featuredMovieCache.movie);
    }

    const today = new Date();
    const releaseWindowStart = new Date(today);
    releaseWindowStart.setDate(today.getDate() - 120);
    const formatDate = (date) => date.toISOString().slice(0, 10);
    const discoverResponse = await tmdbRequest("/discover/movie", {
      include_adult: false,
      include_video: false,
      language: "en-US",
      page: 1,
      "primary_release_date.gte": formatDate(releaseWindowStart),
      "primary_release_date.lte": formatDate(today),
      sort_by: "popularity.desc",
      "vote_count.gte": 75,
    });
    const candidates = (discoverResponse.data?.results || [])
      .filter((movie) => movie.backdrop_path && movie.id)
      .slice(0, 12);

    for (const candidate of candidates) {
      const detailsResponse = await tmdbRequest(`/movie/${candidate.id}`, {
        append_to_response: "videos",
      });
      const movie = detailsResponse.data;
      const trailer = rankTrailerVideos(movie.videos?.results)[0];

      if (!movie.backdrop_path || !trailer) {
        continue;
      }

      const featuredMovie = {
        ...movie,
        featured_trailer_key: trailer.key,
        featured_trailer_name: trailer.name,
        featured_trailer_type: trailer.type,
      };
      featuredMovieCache = {
        movie: featuredMovie,
        expiresAt: Date.now() + FEATURED_CACHE_MS,
      };

      res.set("Cache-Control", "public, max-age=1800");
      return res.json(featuredMovie);
    }

    return res.status(404).json({ message: "No recent featured movie is available" });
  } catch (error) {
    console.error("TMDB featured movie error:", {
      code: error.code,
      status: error.response?.status,
    });
    return res.status(502).json({ message: "Failed to find a featured movie" });
  }
});

// Add a movie
router.post("/", authenticateMiddleware, requireAdminMiddleware, async (req, res) => {
    try {
        if (!isValidMoviePayload(req.body, { requireCoreFields: true })) {
          return res.status(400).json({
            message: "Movie payload contains invalid fields or values.",
          });
        }

        const { title, genre, releaseYear, status, posterPath, tmdbId, overview } = req.body;

        if (MovieModel.db.readyState !== 1) {
          return res.status(503).json({
            message: "Database unavailable. Check MongoDB Atlas network access and try again.",
          });
        }

        const movie = new MovieModel({
  title,
  genre,
  releaseYear,
  status,
  posterPath,
  tmdbId,
  overview
});

        const savedMovie = await movie.save();

        res.status(201).json(savedMovie);
    } catch (error) {
        console.error("Movie create failed:", error.name);
        const isValidationError =
          error.name === "ValidationError" || error.name === "CastError";
        const isDatabaseUnavailable =
          MovieModel.db.readyState !== 1 ||
          /MongoServerSelectionError|MongoNetworkError|buffering timed out|SSL routines/i.test(
            error.message
          );

        if (isDatabaseUnavailable) {
          return res.status(503).json({
            message: "Database unavailable. Check MongoDB Atlas network access and try again.",
          });
        }

        return res.status(isValidationError ? 400 : 500).json({
          message: isValidationError ? error.message : "Failed to save movie.",
        });
    }
});

router.post(
  "/:id/resolve-tmdb",
  optionalAuthenticateMiddleware,
  async (req, res) => {
  try {
    const movie = await MovieModel.findById(req.params.id);

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    if (movie.tmdbId) {
      const response = await tmdbRequest(`/movie/${movie.tmdbId}`, {
        append_to_response: "videos",
      });
      return res.json({
        ...response.data,
        tmdbId: movie.tmdbId,
        posterPath: movie.posterPath,
        genre: movie.genre,
        status: movie.status,
      });
    }

    const searchResponse = await tmdbRequest("/search/movie", {
      query: movie.title,
      year: movie.releaseYear,
      include_adult: false,
    });
    const normalizedTitle = normalizeTitle(movie.title);
    const exactMatches = (searchResponse.data?.results || []).filter(
      (result) =>
        normalizeTitle(result.title) === normalizedTitle ||
        normalizeTitle(result.original_title) === normalizedTitle
    );
    const matchingMovie =
      exactMatches.find(
        (result) => result.release_date?.slice(0, 4) === String(movie.releaseYear)
      ) || exactMatches[0];

    if (!matchingMovie) {
      return res.status(404).json({ message: "No matching TMDB movie found" });
    }

    const detailsResponse = await tmdbRequest(`/movie/${matchingMovie.id}`, {
      append_to_response: "videos",
    });
    const details = detailsResponse.data;
    let resolvedMetadata = {
      tmdbId: details.id,
      overview: details.overview || movie.overview || "",
      posterPath: details.poster_path || movie.posterPath || "",
    };

    if (req.user?.role === "admin") {
      const savedMovie = await MovieModel.findByIdAndUpdate(
        movie._id,
        { $set: resolvedMetadata },
        { new: true, runValidators: true }
      );

      resolvedMetadata = {
        tmdbId: savedMovie.tmdbId,
        overview: savedMovie.overview,
        posterPath: savedMovie.posterPath,
      };
    }

    return res.json({
      ...details,
      ...resolvedMetadata,
      genre: movie.genre,
      status: movie.status,
    });
  } catch (error) {
    console.error("TMDB movie resolution error:", {
      code: error.code,
      status: error.response?.status,
    });
    return res.status(502).json({ message: "Failed to resolve movie details" });
  }
  }
);

// Update a movie
router.put('/:id', authenticateMiddleware, requireAdminMiddleware, async (req, res) => {
  const body = req.body;

  if (!isValidMoviePayload(body)) {
    return res.status(400).json({
      message: "Movie update contains invalid fields or values.",
    });
  }

  const fields = Object.keys(body);

  try {
    const update = Object.fromEntries(
      fields.map((field) => [field, body[field]])
    );
    const updatedMovie = await MovieModel.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    )

    if (!updatedMovie) {
      return res.status(404).json({ message: 'Movie not found' })
    }

    res.json(updatedMovie)
  } catch (error) {
    const isValidationError =
      error.name === "ValidationError" || error.name === "CastError";
    res.status(isValidationError ? 400 : 500).json({
      message: isValidationError ? "Movie update contains invalid values." : "Failed to update movie.",
    })
  }
})

// Delete a movie
router.delete("/:id", authenticateMiddleware, requireAdminMiddleware, async (req, res) => {
    try {
        const deletedMovie = await MovieModel.findByIdAndDelete(
            req.params.id
        );

        if (!deletedMovie) {
            return res.status(404).json({
                message: "Movie not found"
            });
        }

        res.json({
            message: "Movie deleted successfully"
        });
    } catch (error) {
        const isInvalidId = error.name === "CastError";
        console.error("Movie delete failed:", error.name);
        res.status(isInvalidId ? 400 : 500).json({
            message: isInvalidId ? "Invalid movie id." : "Failed to delete movie.",
        });
    }
});
// Get movie details from TMDB
router.get("/details/:id", async (req, res) => {
  try {
    const response = await tmdbRequest(`/movie/${req.params.id}`, {
      append_to_response: "videos",
    });

    res.json(response.data);
  } catch (error) {
    console.error("TMDB details error:", {
      tmdbId: req.params.id,
      code: error.code,
      status: error.response?.status,
    });

    res.status(500).json({
      message: "Failed to get movie details",
    });
  }
});
// Search movies from TMDB
router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        message: "Please provide a movie search query",
      });
    }

    const response = await tmdbRequest("/search/movie", {
      query,
      include_adult: false,
    });

    res.json(response.data.results);
  } catch (error) {
    console.error("TMDB search error:", error.name, error.response?.status);

    res.status(500).json({
      message: "Failed to search movies",
    });
  }
});

router.get("/video-preview", async (req, res) => {
  try {
    const { title } = req.query;

    if (!title) {
      return res.status(400).json({ message: "Please provide a movie title" });
    }

    const searchResponse = await tmdbRequest("/search/movie", {
      query: title,
      include_adult: false,
    });

    const movieResult =
      (searchResponse.data?.results || []).find(
        (movie) =>
          movie.title && movie.title.toLowerCase() === String(title).toLowerCase()
      ) || (searchResponse.data?.results || [])[0];

    if (!movieResult) {
      return res.json({ key: null });
    }

    const videosResponse = await tmdbRequest(`/movie/${movieResult.id}/videos`);

    const videos = videosResponse.data?.results || [];
    const preferredVideo =
      videos.find(
        (video) =>
          video.site === "YouTube" &&
          (video.type === "Trailer" || video.type === "Teaser") &&
          video.official
      ) ||
      videos.find(
        (video) =>
          video.site === "YouTube" &&
          (video.type === "Trailer" || video.type === "Teaser" || video.type === "Clip")
      ) ||
      videos.find((video) => video.site === "YouTube");

    return res.json({ key: preferredVideo ? preferredVideo.key : null });
  } catch (error) {
    console.error("TMDB video preview error:", error.name, error.response?.status);
    return res.json({ key: null });
  }
});

return router;
};

module.exports = createMovieRouter;