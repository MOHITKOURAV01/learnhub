// courseModel declares `sections: {}`, which Mongoose treats as a free-form
// Mixed value. Documents in the wild therefore hold arrays, plain objects keyed
// by index, or nothing at all. Every consumer that needs a section count has to
// cope with all three, so the normalisation lives here instead of being
// re-implemented (and re-broken) per controller.

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// Mongoose sometimes hands back a Map for Mixed subdocuments and sometimes a
// POJO. Both need to look like an array to the callers below.
function toEntries(sections) {
  if (sections instanceof Map) {
    return Array.from(sections.values());
  }

  if (isPlainObject(sections)) {
    return Object.values(sections);
  }

  return [];
}

/**
 * Coerces whatever is stored in `course.sections` into an array.
 *
 * @param {unknown} sections raw value read from a course document
 * @returns {Array<unknown>} always an array, never null or undefined
 */
function normalizeSections(sections) {
  if (Array.isArray(sections)) {
    return sections.filter((section) => section !== undefined);
  }

  return toEntries(sections);
}

/**
 * Number of sections in a course, safe for any stored shape.
 *
 * @param {unknown} sections raw value read from a course document
 * @returns {number} zero or a positive integer
 */
function countSections(sections) {
  return normalizeSections(sections).length;
}

/**
 * True when the stored value is something this project can still read as a
 * section list. Used to tell "course has no sections yet" apart from "the
 * sections field holds a string/number and the document is corrupt".
 *
 * @param {unknown} sections raw value read from a course document
 * @returns {boolean}
 */
function hasReadableSections(sections) {
  if (sections === undefined || sections === null) {
    return true;
  }

  return Array.isArray(sections) || isPlainObject(sections) || sections instanceof Map;
}

module.exports = {
  countSections,
  hasReadableSections,
  normalizeSections,
};
