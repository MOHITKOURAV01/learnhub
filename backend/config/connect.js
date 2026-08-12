const mongoose = require("mongoose");

const connectionOfDb = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "video-course-application",
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  console.log("Connected to MongoDB");
};

module.exports = connectionOfDb;
