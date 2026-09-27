/**
 * lib/schemaDiff.js
 *
 * Pure function: given two plain-object schemas (oldSchema, newSchema),
 * computes the contract delta — what changed, was renamed, had its type
 * changed, or was added/removed.
 *
 * Returns a structured delta object consumed by the Principal Agent and
 * used by both subagents to decide whether a consumer will break.
 *
 * No dependencies — pure Node.js.
 */

"use strict";

/**
 * Returns the JSON type name of a JavaScript value, matching the names
 * used in JSON Schema: "number", "string", "boolean", "object", "array", "null".
 * @param {*} value
 * @returns {string}
 */
function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "number" | "string" | "boolean" | "object"
}

/**
 * Computes the diff between two flat JSON schema objects.
 *
 * @param {Object} oldSchema  — the previous contract (e.g. { id:1, nombre:"Laptop", precioTotal:1500 })
 * @param {Object} newSchema  — the proposed new contract
 * @returns {SchemaDelta}
 *
 * @typedef {Object} SchemaDelta
 * @property {FieldChange[]} changes   — list of per-field changes
 * @property {boolean}       hasBreaks — true if any change is a potential consumer break
 *
 * @typedef {Object} FieldChange
 * @property {string}  field      — field name in the OLD schema (or new, if added)
 * @property {string}  type       — "renamed" | "typeChanged" | "removed" | "added" | "unchanged"
 * @property {string}  [oldName]  — only for "renamed"
 * @property {string}  [newName]  — only for "renamed"
 * @property {string}  [oldType]  — only for "typeChanged"
 * @property {string}  [newType]  — only for "typeChanged"
 * @property {*}       [oldValue] — the old value (for context)
 * @property {*}       [newValue] — the new value (for context)
 */
function diffSchemas(oldSchema, newSchema) {
  const changes = [];

  const oldKeys = Object.keys(oldSchema);
  const newKeys = Object.keys(newSchema);

  const removedKeys = oldKeys.filter((k) => !newKeys.includes(k));
  const addedKeys = newKeys.filter((k) => !oldKeys.includes(k));
  const commonKeys = oldKeys.filter((k) => newKeys.includes(k));

  // --- Detect renames via value matching ---
  // A rename is when a key disappears and a new key appears with the same value.
  const renames = []; // [{ oldKey, newKey }]
  const unmatchedRemoved = [];

  for (const removedKey of removedKeys) {
    const oldVal = oldSchema[removedKey];
    // Look for an added key whose value equals the removed value
    const matchingAdded = addedKeys.find(
      (addedKey) =>
        newSchema[addedKey] === oldVal &&
        jsonType(newSchema[addedKey]) === jsonType(oldVal)
    );
    if (matchingAdded) {
      renames.push({ oldKey: removedKey, newKey: matchingAdded });
    } else {
      unmatchedRemoved.push(removedKey);
    }
  }

  const renamedNewKeys = renames.map((r) => r.newKey);

  // Emit rename changes
  for (const { oldKey, newKey } of renames) {
    changes.push({
      field: oldKey,
      type: "renamed",
      oldName: oldKey,
      newName: newKey,
      oldValue: oldSchema[oldKey],
      newValue: newSchema[newKey],
    });
  }

  // Emit removed changes (not part of a rename)
  for (const key of unmatchedRemoved) {
    changes.push({
      field: key,
      type: "removed",
      oldValue: oldSchema[key],
      oldType: jsonType(oldSchema[key]),
    });
  }

  // Emit added changes (not part of a rename)
  for (const key of addedKeys.filter((k) => !renamedNewKeys.includes(k))) {
    changes.push({
      field: key,
      type: "added",
      newValue: newSchema[key],
      newType: jsonType(newSchema[key]),
    });
  }

  // Detect type changes and value changes on common keys
  for (const key of commonKeys) {
    const oldVal = oldSchema[key];
    const newVal = newSchema[key];
    const oldT = jsonType(oldVal);
    const newT = jsonType(newVal);

    if (oldT !== newT) {
      changes.push({
        field: key,
        type: "typeChanged",
        oldType: oldT,
        newType: newT,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
    // value changed but same type — not a contract break for our purposes
  }

  const breakTypes = new Set(["renamed", "typeChanged", "removed"]);
  const hasBreaks = changes.some((c) => breakTypes.has(c.type));

  return { changes, hasBreaks };
}

module.exports = { diffSchemas, jsonType };
