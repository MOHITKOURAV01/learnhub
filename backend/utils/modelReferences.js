// Checking that every `ref:` on every schema names a model that exists.
//
// Mongoose resolves `ref` by exact name, at populate time, and only for the
// documents that actually carry a value on that path. A typo is therefore
// invisible until a populate runs over a non-null path, and then it is not a
// wrong answer but a thrown MissingSchemaError:
//
//   ref: "User"                                  // activityLogModel
//   mongoose.model("user", userModel)            // userModel
//
//   MissingSchemaError: Schema hasn't been registered for model "User".
//
// That was #113. The admin Activity Logs page answered 500 on every request
// from the first successful sign-in onwards, because a `login_failed` row is
// written without a userId and populating a set of all-null paths never
// resolves the model — so the failure only appeared once real data existed.
//
// One string was the fix. This module is the part that stops the next one:
// the reference graph is derivable from the registered models, so it can be
// asserted instead of reviewed.

/**
 * Every declared reference on one schema, including the ones nested inside
 * subdocuments and arrays.
 *
 * `schema.eachPath` walks single nested paths and array element types, so a
 * `[{ type: ObjectId, ref: "course" }]` is visited like a scalar. A `refPath`
 * is deliberately not reported: it names the *field* holding the model name,
 * which is only known per document, so there is nothing to resolve statically.
 *
 * @param {import("mongoose").Schema} schema
 * @param {string} modelName the owning model, for the message
 * @returns {Array<{ model: string, path: string, ref: string }>}
 */
function collectSchemaReferences(schema, modelName) {
  const references = [];

  if (!schema || typeof schema.eachPath !== "function") {
    return references;
  }

  schema.eachPath((pathName, schemaType) => {
    // A scalar ObjectId path, or the element type of an array of them.
    const ref = schemaType?.options?.ref ?? schemaType?.caster?.options?.ref;

    // Only a literal name can be checked. `ref` also accepts a function or a
    // Model, and both of those resolve to something real by construction.
    if (typeof ref !== "string" || !ref) return;

    references.push({ model: modelName, path: pathName, ref });
  });

  return references;
}

/**
 * Every declared reference across a set of registered models.
 *
 * @param {object} [models] mongoose.models, or a stub
 * @returns {Array<{ model: string, path: string, ref: string }>}
 */
function collectModelReferences(models = {}) {
  const references = [];

  for (const [modelName, model] of Object.entries(models)) {
    references.push(...collectSchemaReferences(model?.schema, modelName));
  }

  return references;
}

/**
 * The references whose target is not registered.
 *
 * @param {object} [models] mongoose.models, or a stub
 * @returns {Array<{ model: string, path: string, ref: string }>}
 */
function findUnresolvedReferences(models = {}) {
  const registered = new Set(Object.keys(models));

  return collectModelReferences(models).filter(
    (reference) => !registered.has(reference.ref),
  );
}

/**
 * Turns an unresolved reference into a message that names the fix.
 *
 * The registered names are listed because the mistake is almost always
 * casing — "User" for "user" — and seeing the two side by side is the whole
 * diagnosis.
 *
 * @param {{ model: string, path: string, ref: string }} reference
 * @param {string[]} registeredNames
 * @returns {string}
 */
function describeUnresolvedReference(reference, registeredNames = []) {
  const known = [...registeredNames].sort().join(", ");

  return (
    `${reference.model}.${reference.path} references the model ` +
    `"${reference.ref}", which is not registered. Populating it throws ` +
    `MissingSchemaError. Registered models: ${known}`
  );
}

/**
 * Reports unresolved references without throwing.
 *
 * Called at boot next to `ensureIndexes`, for the same reason that exists: a
 * misconfiguration that only shows up under real data should be loud once, at
 * start-up, rather than as a 500 in an endpoint nobody is watching.
 *
 * @param {object} [options]
 * @param {object} [options.models]
 * @param {object} [options.logger]
 * @returns {{ checked: number, unresolved: Array<{ model: string, path: string, ref: string }> }}
 */
function verifyModelReferences({ models, logger = console } = {}) {
  const registry = models || require("mongoose").models || {};
  const all = collectModelReferences(registry);
  const unresolved = findUnresolvedReferences(registry);
  const registeredNames = Object.keys(registry);

  for (const reference of unresolved) {
    logger.error(describeUnresolvedReference(reference, registeredNames));
  }

  return { checked: all.length, unresolved };
}

module.exports = {
  collectModelReferences,
  collectSchemaReferences,
  describeUnresolvedReference,
  findUnresolvedReferences,
  verifyModelReferences,
};
