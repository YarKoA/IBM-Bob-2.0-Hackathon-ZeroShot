/**
 * subagents/webScanner.js — Subagent A
 *
 * Scans web/app/page.js for direct property accesses on the `producto`
 * object and cross-references them against the contract delta produced by
 * the Principal Agent.
 *
 * Returns a structured findings object — never throws; errors become findings.
 *
 * Consumed by: principal.js (via Promise.all)
 * Produces:    WebScanResult passed to consolidator.js
 */

"use strict";

const { readSource } = require("../lib/fileReader");

// The file this subagent is responsible for analysing
const TARGET_FILE = "web/app/page.js";

/**
 * Scans the web source for broken references.
 *
 * @param {import('../lib/schemaDiff').FieldChange[]} changes  — delta from Principal Agent
 * @returns {WebScanResult}
 *
 * @typedef {Object} WebScanResult
 * @property {string}       file       — path of the scanned file
 * @property {WebFinding[]} findings   — list of detected issues
 * @property {string}       rawSource  — the source text (included for PR comment context)
 * @property {string|null}  error      — set if the file could not be read
 *
 * @typedef {Object} WebFinding
 * @property {string} severity   — "CRITICAL" | "WARNING" | "INFO"
 * @property {string} field      — the field name involved
 * @property {string} changeType — mirrors FieldChange.type
 * @property {string} message    — human-readable description
 * @property {number} line       — approximate line number of the reference (1-based, 0 if unknown)
 * @property {string} snippet    — the line of code containing the reference
 */
async function runWebScanner(changes) {
  let source;
  try {
    source = readSource(TARGET_FILE);
  } catch (err) {
    return {
      file: TARGET_FILE,
      findings: [],
      rawSource: "",
      error: `Could not read ${TARGET_FILE}: ${err.message}`,
    };
  }

  const lines = source.split("\n");
  const findings = [];

  for (const change of changes) {
    // Only breaking change types matter
    if (change.type === "unchanged" || change.type === "added") continue;

    if (change.type === "renamed") {
      // Look for accesses to the OLD field name: producto.oldName or producto[oldName]
      const refs = findFieldRefs(lines, change.oldName);
      if (refs.length > 0) {
        for (const ref of refs) {
          findings.push({
            severity: "CRITICAL",
            field: change.oldName,
            changeType: "renamed",
            message:
              `Field \`${change.oldName}\` was renamed to \`${change.newName}\` in the backend contract. ` +
              `\`producto.${change.oldName}\` will be \`undefined\` at runtime — ` +
              `the cell will render empty with no console error (silent failure).`,
            line: ref.line,
            snippet: ref.snippet,
          });
        }
      }
    }

    if (change.type === "removed") {
      const refs = findFieldRefs(lines, change.field);
      if (refs.length > 0) {
        for (const ref of refs) {
          findings.push({
            severity: "CRITICAL",
            field: change.field,
            changeType: "removed",
            message:
              `Field \`${change.field}\` was removed from the backend contract. ` +
              `\`producto.${change.field}\` will be \`undefined\` — ` +
              `the cell will render empty with HTTP 200 (silent failure, worst case).`,
            line: ref.line,
            snippet: ref.snippet,
          });
        }
      }
    }

    if (change.type === "typeChanged") {
      const refs = findFieldRefs(lines, change.field);
      if (refs.length > 0) {
        // Type change: check if there's a numeric operation on the field
        const hasArithmetic = findArithmeticRefs(lines, change.field);
        for (const ref of refs) {
          findings.push({
            severity: hasArithmetic ? "CRITICAL" : "WARNING",
            field: change.field,
            changeType: "typeChanged",
            message:
              `Field \`${change.field}\` changed type from \`${change.oldType}\` to \`${change.newType}\` ` +
              `in the backend contract. React will render the value, but any arithmetic ` +
              `on \`producto.${change.field}\` (e.g. tax calculation) will produce \`NaN\`. ` +
              `No console error — this is a silent type drift (Scenario B). ` +
              `${hasArithmetic ? "⚠️  Arithmetic operations detected on this field." : ""}`,
            line: ref.line,
            snippet: ref.snippet,
          });
        }
      }
    }
  }

  return {
    file: TARGET_FILE,
    findings,
    rawSource: source,
    error: null,
  };
}

/**
 * Finds all lines where `producto.<fieldName>` is referenced (direct access).
 * Also matches `producto["fieldName"]`.
 *
 * @param {string[]} lines
 * @param {string}   fieldName
 * @returns {{ line: number, snippet: string }[]}
 */
function findFieldRefs(lines, fieldName) {
  const results = [];
  // Match: producto.fieldName  OR  producto["fieldName"]  OR  producto['fieldName']
  // Skip lines that are pure comments (// or * or */) — those are documentation,
  // not live code references.
  const pattern = new RegExp(
    `producto\\.${escapeRegex(fieldName)}\\b|producto\\[['"]${escapeRegex(fieldName)}['"]\\]`
  );
  lines.forEach((text, idx) => {
    const trimmed = text.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    if (!isComment && pattern.test(text)) {
      results.push({ line: idx + 1, snippet: trimmed });
    }
  });
  return results;
}

/**
 * Checks whether any non-comment line performs arithmetic on producto.<fieldName>.
 * Arithmetic operators: + - * / % applied to the field.
 */
function findArithmeticRefs(lines, fieldName) {
  const pattern = new RegExp(
    `producto\\.${escapeRegex(fieldName)}\\s*[+\\-*/]|[+\\-*/]\\s*producto\\.${escapeRegex(fieldName)}`
  );
  return lines.some((text) => {
    const trimmed = text.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    return !isComment && pattern.test(text);
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { runWebScanner };
