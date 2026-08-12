const dotenv = require("dotenv");
const DBConnection = require("./config/connect");
const app = require("./app");

dotenv.config();

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await DBConnection();
  return app.listen(PORT, () => {
    console.log(`running on ${PORT}`);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

module.exports = { startServer };
