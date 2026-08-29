// Serving a video by reading the whole file and sending it back breaks
// seeking: a <video> element scrubs by asking for a byte range, and a server
// that ignores Range makes the timeline unusable on anything longer than a
// couple of minutes. express.static handled this for free. A guarded route has
// to do it itself.

/**
 * Parses a single-range `Range` header.
 *
 * Multi-range requests (`bytes=0-99,200-299`) are deliberately not supported —
 * no browser uses them for video — and are treated as "send the whole file",
 * which is a valid response to any Range request.
 *
 * @param {string|undefined} header
 * @param {number} size total file size in bytes
 * @returns {{ start: number, end: number }|null|'unsatisfiable'}
 *   null to send the whole file, 'unsatisfiable' for a 416
 */
function parseRangeHeader(header, size) {
  if (!header || typeof header !== "string") return null;
  if (!Number.isFinite(size) || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  // "bytes=-500" means the last 500 bytes.
  if (rawStart === "") {
    if (rawEnd === "") return null;

    const suffixLength = Number(rawEnd);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "unsatisfiable";
    }

    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(rawStart);

  if (!Number.isSafeInteger(start) || start >= size) {
    return "unsatisfiable";
  }

  // "bytes=1000-" means from that byte to the end.
  const end = rawEnd === "" ? size - 1 : Number(rawEnd);

  if (!Number.isSafeInteger(end) || end < start) {
    return "unsatisfiable";
  }

  return { start, end: Math.min(end, size - 1) };
}

/**
 * The headers for a full-file response.
 *
 * @param {number} size
 * @returns {object}
 */
function buildFullResponseHeaders(size) {
  return {
    "Content-Length": String(size),
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // The URL carries a short-lived credential, so a shared cache must not
    // keep a copy of the body it produced.
    "Cache-Control": "private, no-store",
  };
}

/**
 * The headers for a 206 partial response.
 *
 * @param {{ start: number, end: number }} range
 * @param {number} size
 * @returns {object}
 */
function buildRangeResponseHeaders(range, size) {
  return {
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    "Content-Length": String(range.end - range.start + 1),
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
}

module.exports = {
  buildFullResponseHeaders,
  buildRangeResponseHeaders,
  parseRangeHeader,
};
