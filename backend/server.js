const mongoose = require("mongoose");
require("dotenv").config();
const createApp = require("./app");
const app = createApp();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  autoSelectFamily: false
})
    .then(() => {
        console.log("MongoDB connected successfully!");
    })
    .catch((error) => {
        console.error("MongoDB connection failed:", error.name);
    });

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});