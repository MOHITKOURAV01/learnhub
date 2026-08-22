// Where a request came from, in a form worth storing.
//
// The activity log declares `ipAddress` and `userAgent`, the admin controller
// selects them, the table has a column for each and the free-text search
// includes both — and nothing ever wrote either, so every row rendered blank
// and searching for an IP could never match.

// A User-Agent is client-supplied and unbounded. Long enough to keep the part
// that identifies a browser, short enough that a hostile header cannot bloat
// the collection.
const MAX_USER_AGENT_LENGTH = 300;

/**
 * The caller's IP.
 *
 * `req.ip` is the right source: Express resolves it from the forwarded headers
 * only when `trust proxy` is set, which app.js does behind `TRUST_PROXY=true`.
 * Reading `X-Forwarded-For` directly would take a client-supplied header at
 * face value on a deployment that is not behind a proxy.
 *
 * The IPv4-mapped IPv6 prefix is stripped, because `::ffff:203.0.113.4` and
 * `203.0.113.4` are the same address and an admin searching for one should find
 * rows written as the other.
 *
 * @param {object} req
 * @returns {string|null}
 */
function getClientIp(req) {
  const raw =
    req?.ip ||
    req?.connection?.remoteAddress ||
    req?.socket?.remoteAddress ||
    "";

  const address = String(raw).trim();

  if (!address) return null;

  return address.replace(/^::ffff:/i, "") || null;
}

/**
 * The caller's User-Agent, truncated.
 *
 * @param {object} req
 * @param {object} [options]
 * @param {number} [options.maxLength]
 * @returns {string|null}
 */
function getUserAgent(req, { maxLength = MAX_USER_AGENT_LENGTH } = {}) {
  const header = req?.headers?.["user-agent"];
  const agent = String(header ?? "").trim();

  if (!agent) return null;

  return agent.slice(0, maxLength);
}

/**
 * Both, as the activity log stores them.
 *
 * @param {object} req
 * @returns {{ ipAddress: string|null, userAgent: string|null }}
 */
function getRequestContext(req) {
  return {
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  };
}

module.exports = {
  MAX_USER_AGENT_LENGTH,
  getClientIp,
  getRequestContext,
  getUserAgent,
};
