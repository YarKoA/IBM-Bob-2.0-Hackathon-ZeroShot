/**
 * lib/fileReader.js
 *
 * Utility: reads source files from disk relative to the workspace root.
 * Centralises path resolution so subagents don't need to know where they
 * are relative to the source tree.
 *
 * No dependencies — pure Node.js fs.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Workspace root is one level up from agent/
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Reads a file relative to the workspace root and returns its contents as a string.
 * Throws a clear error if the file does not exist.
 *
 * @param {string} relPath  — path relative to workspace root, e.g. "web/app/page.js"
 * @returns {string}
 */
function readSource(relPath) {
  const abs = path.join(WORKSPACE_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `fileReader: file not found: ${relPath}\n  (resolved to: ${abs})`
    );
  }
  return fs.readFileSync(abs, "utf8");
}

/**
 * Loads and evaluates backend/src/producto.schema.js as a CommonJS module,
 * returning the exported schema object.
 * Uses require() so we get the actual exported value, not raw text.
 *
 * @returns {Object}
 */
function loadBackendSchema() {
  const abs = path.join(WORKSPACE_ROOT, "backend", "src", "producto.schema.js");
  if (!fs.existsSync(abs)) {
    throw new Error(
      `fileReader: backend schema not found at backend/src/producto.schema.js\n  (resolved to: ${abs})`
    );
  }
  // Clear require cache so we always get the latest version on disk
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

module.exports = { readSource, loadBackendSchema, WORKSPACE_ROOT };
