const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },

        genre: {
            type: String,
            required: true,
            trim: true
        },
        posterPath: {
    type: String,
    default: ''
},

        tmdbId: {
            type: Number,
            default: null
        },

        overview: {
            type: String,
            default: ''
        },

        releaseYear: {
            type: Number,
            required: true
        },

        status: {
            type: String,
            enum: ["Want to Watch", "Watching", "Watched"],
            default: "Want to Watch"
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Movie", movieSchema);