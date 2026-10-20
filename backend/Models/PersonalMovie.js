const mongoose = require("mongoose");

const personalMovieSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tmdbId: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    posterPath: {
      type: String,
      default: "",
      maxlength: 500,
    },
    releaseYear: {
      type: Number,
      default: null,
      min: 1888,
      max: 2100,
    },
    genre: {
      type: String,
      default: "",
      maxlength: 300,
    },
    overview: {
      type: String,
      default: "",
      maxlength: 5000,
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    isWatched: {
      type: Boolean,
      default: false,
    },
    note: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    rating: {
      type: Number,
      default: null,
      min: 0,
      max: 10,
    },
  },
  { timestamps: true }
);

personalMovieSchema.index({ userId: 1, tmdbId: 1 }, { unique: true });

module.exports = mongoose.model("PersonalMovie", personalMovieSchema);
