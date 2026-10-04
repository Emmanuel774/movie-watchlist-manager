const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

const allowedOrigins = [process.env.FRONTEND_URL, "http://localhost:5173"].filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
const movieRoutes = require("./routes/movieRoutes");

app.use("/api/movies", movieRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  autoSelectFamily: false
})
    .then(() => {
        console.log("MongoDB connected successfully!");
    })
    .catch((error) => {
        console.error("MongoDB connection failed:", error.message);
    });

// Test route
app.get("/", (req, res) => {
    res.send("Movie Watchlist Manager API is running!");
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});