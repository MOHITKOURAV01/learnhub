const mongoose = require("mongoose");

const progressEntrySchema = new mongoose.Schema(
  {
    sectionId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false },
);

const enrolledCourseSchema = mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "course",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    course_Length: {
      type: Number,
      required: true,
    },
    progress: {
      type: [progressEntrySchema],
      default: [],
    },
    certificateDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

enrolledCourseSchema.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model("enrolledCourses", enrolledCourseSchema);
