const mongoose = require("mongoose");

const courseModel = mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    C_educator: {
      type: String,
      required: [true, "name is required"],
    },
    C_title: {
      type: String,
      required: [true, "C_title is required"],
    },
    C_categories: {
      type: String,
      required: [true, "C_categories: is required"],
    },
    C_price: {
      type: String,
    },
    C_description: {
      type: String,
      required: [true, "C_description: is required"],
    },
    sections: {},
    enrolled: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// getAllCoursesUserController filters by userId (the owning teacher), and the
// paginated catalogue from #43 sorts by createdAt, enrolled or C_title.
courseModel.index({ userId: 1, createdAt: -1 });
courseModel.index({ createdAt: -1 });
courseModel.index({ enrolled: -1 });

const courseSchema = mongoose.model("course", courseModel);

module.exports = courseSchema;
