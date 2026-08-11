const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

app.get("/api/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/admin/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-dashboard.html"));
});

app.use("/api/admin", require("./routers/adminRoutes"));
app.use("/api/user", require("./routers/userRoutes"));
app.use("/api/bookmarks", require("./routers/courseBookmarkRoutes"));
app.use("/api/reviews", require("./routers/courseReviewRoutes"));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: err.message || "Upload failed",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;
