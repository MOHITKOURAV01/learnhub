const express = require("express");
const mongoose = require("mongoose");

// Mongoose connection states, mapped to something a human or an uptime check
// can read without consulting the driver docs.
const CONNECTION_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

/**
 * Liveness and readiness endpoint.
 *
 * Deliberately unauthenticated and deliberately cheap: it reports the driver's
 * cached connection state rather than issuing a ping, so a health check cannot
 * itself add load during an incident.
 */
function createHealthRouter({ connection = mongoose.connection, uptime = process.uptime } = {}) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const readyState = connection?.readyState ?? 0;
    const database = CONNECTION_STATES[readyState] || "unknown";
    const healthy = readyState === 1;

    return res.status(healthy ? 200 : 503).json({
      success: healthy,
      status: healthy ? "ok" : "degraded",
      uptimeSeconds: Math.floor(uptime()),
      database,
    });
  });

  return router;
}

module.exports = {
  CONNECTION_STATES,
  createHealthRouter,
};
