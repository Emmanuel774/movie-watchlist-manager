const express = require("express");
const PersonalMovie = require("../Models/PersonalMovie");

const MAX_COLLECTION_SIZE = 500;
const MAX_NOTE_LENGTH = 2000;
const PERSONAL_FIELDS = new Set([
  "isFavorite",
  "isWatched",
  "note",
  "rating",
]);
const METADATA_FIELDS = new Set([
  "tmdbId",
  "title",
  "posterPath",
  "releaseYear",
  "genre",
  "overview",
]);
const ALLOWED_ITEM_FIELDS = new Set([...PERSONAL_FIELDS, ...METADATA_FIELDS]);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isValidMetadata = (metadata) =>
  Number.isInteger(metadata.tmdbId) &&
  metadata.tmdbId > 0 &&
  (metadata.title === undefined ||
    (typeof metadata.title === "string" &&
      metadata.title.trim().length > 0 &&
      metadata.title.length <= 300)) &&
  (metadata.posterPath === undefined ||
    (typeof metadata.posterPath === "string" && metadata.posterPath.length <= 500)) &&
  (metadata.releaseYear === undefined ||
    metadata.releaseYear === null ||
    (Number.isInteger(metadata.releaseYear) &&
      metadata.releaseYear >= 1888 &&
      metadata.releaseYear <= 2100)) &&
  (metadata.genre === undefined ||
    (typeof metadata.genre === "string" && metadata.genre.length <= 300)) &&
  (metadata.overview === undefined ||
    (typeof metadata.overview === "string" && metadata.overview.length <= 5000));

const isValidPersonalFields = (fields) =>
  Object.entries(fields).every(([key, value]) => {
    if (key === "isFavorite" || key === "isWatched") {
      return typeof value === "boolean";
    }
    if (key === "note") {
      return typeof value === "string" && value.length <= MAX_NOTE_LENGTH;
    }
    return (
      key === "rating" &&
      (value === null ||
        (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10))
    );
  });

const toPublicItem = (item) => ({
  tmdbId: item.tmdbId,
  title: item.title,
  posterPath: item.posterPath || "",
  releaseYear: item.releaseYear ?? null,
  genre: item.genre || "",
  overview: item.overview || "",
  isFavorite: Boolean(item.isFavorite),
  isWatched: Boolean(item.isWatched),
  note: item.note || "",
  rating: item.rating ?? null,
});

const createCollectionRouter = ({
  authenticateMiddleware,
  PersonalMovieModel = PersonalMovie,
} = {}) => {
  const router = express.Router();
  router.use(authenticateMiddleware);

  router.get("/me", async (req, res) => {
    try {
      const items = await PersonalMovieModel.find({ userId: req.user.id })
        .sort({ updatedAt: -1 });
      return res.json({ items: items.map(toPublicItem) });
    } catch (error) {
      console.error("Personal collection lookup failed:", error.name);
      return res.status(500).json({ message: "Unable to load your collection." });
    }
  });

  router.put("/me/items/:tmdbId", async (req, res) => {
    const tmdbId = Number(req.params.tmdbId);
    const body = req.body;
    if (
      !Number.isSafeInteger(tmdbId) ||
      tmdbId < 1 ||
      !isObject(body) ||
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !ALLOWED_ITEM_FIELDS.has(key)) ||
      (body.tmdbId !== undefined && body.tmdbId !== tmdbId) ||
      !isValidMetadata({ ...body, tmdbId }) ||
      !isValidPersonalFields(
        Object.fromEntries(
          Object.entries(body).filter(([key]) => PERSONAL_FIELDS.has(key))
        )
      )
    ) {
      return res.status(400).json({ message: "Movie collection data is invalid." });
    }

    try {
      const existing = await PersonalMovieModel.findOne({
        userId: req.user.id,
        tmdbId,
      });
      if (!existing && !body.title) {
        return res.status(400).json({ message: "A movie title is required." });
      }
      const values = Object.fromEntries(
        Object.entries(body).filter(([key]) => ALLOWED_ITEM_FIELDS.has(key))
      );
      values.tmdbId = tmdbId;

      const item = existing
        ? await PersonalMovieModel.findOneAndUpdate(
            { userId: req.user.id, tmdbId },
            { $set: values },
            { new: true, runValidators: true }
          )
        : await PersonalMovieModel.create({
            ...values,
            userId: req.user.id,
          });

      return res.json({ item: toPublicItem(item) });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "This movie was updated concurrently. Please retry.",
        });
      }
      if (error.name === "ValidationError" || error.name === "CastError") {
        return res.status(400).json({ message: "Movie collection data is invalid." });
      }
      console.error("Personal collection update failed:", error.name);
      return res.status(500).json({ message: "Unable to update your collection." });
    }
  });

  router.delete("/me/items/:tmdbId", async (req, res) => {
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) {
      return res.status(400).json({ message: "A valid TMDB movie ID is required." });
    }

    try {
      const deleted = await PersonalMovieModel.findOneAndDelete({
        userId: req.user.id,
        tmdbId,
      });
      if (!deleted) {
        return res.status(404).json({ message: "Movie not found in your collection." });
      }
      return res.json({ message: "Movie removed from your collection." });
    } catch (error) {
      console.error("Personal collection removal failed:", error.name);
      return res.status(500).json({ message: "Unable to remove movie." });
    }
  });

  router.post("/me/merge", async (req, res) => {
    const items = req.body?.items;
    if (
      !isObject(req.body) ||
      Object.keys(req.body).length !== 1 ||
      !Array.isArray(items) ||
      items.length > MAX_COLLECTION_SIZE ||
      items.some(
        (item) =>
          !isObject(item) ||
          Object.keys(item).some((key) => !ALLOWED_ITEM_FIELDS.has(key)) ||
          typeof item.title !== "string" ||
          !isValidMetadata(item) ||
          !isValidPersonalFields(
            Object.fromEntries(
              Object.entries(item).filter(([key]) => PERSONAL_FIELDS.has(key))
            )
          )
      )
    ) {
      return res.status(400).json({ message: "Guest collection data is invalid." });
    }

    try {
      const deduplicated = new Map();
      for (const item of items) {
        const previous = deduplicated.get(item.tmdbId);
        if (!previous) {
          deduplicated.set(item.tmdbId, { ...item });
          continue;
        }
        previous.isFavorite = Boolean(previous.isFavorite || item.isFavorite);
        previous.isWatched = Boolean(previous.isWatched || item.isWatched);
        if (!previous.note && item.note) previous.note = item.note;
        if (previous.rating == null && item.rating != null) {
          previous.rating = item.rating;
        }
      }

      if (deduplicated.size > MAX_COLLECTION_SIZE) {
        return res.status(400).json({ message: "Guest collection is too large." });
      }
      const existingCount = await PersonalMovieModel.countDocuments({
        userId: req.user.id,
      });
      const mergedItems = [];
      let createdCount = 0;
      for (const guestItem of deduplicated.values()) {
        const existing = await PersonalMovieModel.findOne({
          userId: req.user.id,
          tmdbId: guestItem.tmdbId,
        });
        if (existing) {
          existing.isFavorite = Boolean(existing.isFavorite || guestItem.isFavorite);
          existing.isWatched = Boolean(existing.isWatched || guestItem.isWatched);
          if (!existing.note && guestItem.note) existing.note = guestItem.note;
          if (existing.rating == null && guestItem.rating != null) {
            existing.rating = guestItem.rating;
          }
          await existing.save();
          mergedItems.push(existing);
          continue;
        }

        if (existingCount + createdCount >= MAX_COLLECTION_SIZE) {
          return res.status(409).json({
            message: "Your account collection is at its limit. Guest data has not been removed.",
          });
        }
        const created = await PersonalMovieModel.create({
          ...guestItem,
          userId: req.user.id,
          isFavorite: Boolean(guestItem.isFavorite),
          isWatched: Boolean(guestItem.isWatched),
          note: guestItem.note || "",
          rating: guestItem.rating ?? null,
        });
        mergedItems.push(created);
        createdCount += 1;
      }

      return res.json({
        mergedCount: deduplicated.size,
        items: mergedItems.map(toPublicItem),
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "Collection changed during merge. Guest data is safe; retry the merge.",
        });
      }
      if (error.name === "ValidationError" || error.name === "CastError") {
        return res.status(400).json({ message: "Guest collection data is invalid." });
      }
      console.error("Guest collection merge failed:", error.name);
      return res.status(500).json({
        message: "Unable to merge guest collection. Guest data has not been removed.",
      });
    }
  });

  return router;
};

module.exports = createCollectionRouter;
