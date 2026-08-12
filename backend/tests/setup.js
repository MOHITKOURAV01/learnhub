const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

async function startTestDatabase() {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "learnhub-test-secret";
  process.env.MONGO_DB_NAME = "learnhub-test";

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME,
  });
}

async function clearTestDatabase() {
  const collections = mongoose.connection.collections;

  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
}

async function stopTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = undefined;
  }
}

module.exports = {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
};
