const mongoose = require("mongoose");

const { ensureIndexes } = require("./ensureIndexes");

// Registering every model before the index pass runs. Requiring app.js pulls
// most of them in as a side effect of loading the routers, but relying on that
// order means adding a schema that no router touches would quietly leave its
// indexes unbuilt.
require("../schemas/userModel");
require("../schemas/courseModel");
require("../schemas/enrolledCourseModel");
require("../schemas/coursePaymentModel");
require("../schemas/courseBookmarkModel");
require("../schemas/courseReviewModel");
require("../schemas/activityLogModel");

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

  // users.email is unique now, and login, password reset and OTP verification
  // all assume one row per address. Build the indexes here so a build that
  // cannot complete is reported at startup instead of being swallowed by
  // Mongoose's background builder.
  await ensureIndexes();
};

module.exports = connectionOfDb;
