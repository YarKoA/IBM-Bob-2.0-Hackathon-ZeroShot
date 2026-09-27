/**
 * subagents/mobileScanner.js — Subagent B
 *
 * Scans mobile/src/main/kotlin/.../model/Producto.kt for:
 *   1. @SerializedName annotations that reference renamed or removed fields
 *   2. Kotlin property types that conflict with changed JSON types
 *
 * Returns a structured findings object — never throws; errors become findings.
 *
 * Consumed by: principal.js (via Promise.all)
 * Produces:    MobileScanResult passed to consolidator.js
 */

"use strict";

const { readSource } = require("../lib/fileReader");

const TARGET_FILE =
  "mobile/src/main/kotlin/com/hackathon/mobile/model/Producto.kt";

/**
 * Maps Kotlin primitive type names to JSON type names.
 * Used to detect type mismatches between the JSON contract and the data class.
 */
const KOTLIN_TO_JSON_TYPE = {
  Int: "number",
  Long: "number",
  Double: "number",
  Float: "number",
  Short: "number",
  Byte: "number",
  String: "string",
  Boolean: "boolean",
};

/**
 * Scans the mobile Kotlin data class for broken references.
 *
 * @param {import('../lib/schemaDiff').FieldChange[]} changes  — delta from Principal Agent
 * @returns {MobileScanResult}
 *
 * @typedef {Object} MobileScanResult
 * @property {string}         file       — path of the scanned file
 * @property {MobileFinding[]} findings  — list of detected issues
 * @property {string}         rawSource  — source text (for PR comment context)
 * @property {string|null}    error      — set if the file could not be read
 *
 * @typedef {Object} MobileFinding
 * @property {string} severity    — "CRITICAL" | "WARNING" | "INFO"
 * @property {string} field       — JSON field name involved
 * @property {string} changeType  — mirrors FieldChange.type
 * @property {string} message     — human-readable description
 * @property {number} line        — approximate line number (1-based, 0 if unknown)
 * @property {string} snippet     — the line of code containing the annotation/property
 */
async function runMobileScanner(changes) {
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

  // Parse all properties — both annotated (@SerializedName) and plain val properties
  const annotations = parseAllProperties(lines);

  for (const change of changes) {
    if (change.type === "unchanged" || change.type === "added") continue;

    if (change.type === "renamed") {
      // Find annotations pointing at the OLD field name
      const ann = annotations.find((a) => a.serializedName === change.oldName);
      if (ann) {
        findings.push({
          severity: "CRITICAL",
          field: change.oldName,
          changeType: "renamed",
          message:
            `\`@SerializedName("${change.oldName}")\` is now stale — ` +
            `the backend renamed the field to \`${change.newName}\`. ` +
            `Gson will NOT throw an exception: it silently assigns \`${ann.kotlinType === "String" ? "null" : "0.0 / 0"}\` ` +
            `(the default for \`${ann.kotlinType}\`). ` +
            `Fix: update the annotation to \`@SerializedName("${change.newName}")\`.`,
          line: ann.annotationLine,
          snippet: ann.annotationSnippet,
        });
      }
    }

    if (change.type === "removed") {
      const ann = annotations.find((a) => a.serializedName === change.field);
      if (ann) {
        findings.push({
          severity: "CRITICAL",
          field: change.field,
          changeType: "removed",
          message:
            `Field \`${change.field}\` was removed from the backend contract. ` +
            `\`@SerializedName("${change.field}")\` will never match — ` +
            `Gson silently sets \`${ann.kotlinProperty}\` to \`${ann.kotlinType === "String" ? "null" : "0 / 0.0"}\`. ` +
            `No \`JsonSyntaxException\` is thrown (silent failure — Scenario C). ` +
            `The data class will hold a wrong value at runtime.`,
          line: ann.annotationLine,
          snippet: ann.annotationSnippet,
        });
      }
    }

    if (change.type === "typeChanged") {
      const ann = annotations.find((a) => a.serializedName === change.field);
      if (ann) {
        const expectedJsonType = KOTLIN_TO_JSON_TYPE[ann.kotlinType];
        const actualJsonType = change.newType;

        if (expectedJsonType && expectedJsonType !== actualJsonType) {
          // Specific case: String → Number or Number → String
          // Gson 2.11.0 coerces String→Number silently but Number→String may throw
          const willThrow =
            actualJsonType === "string" && expectedJsonType === "number"
              ? false  // Gson coerces String→Double silently (Scenario B — the invisible one)
              : true;  // Number→String: JsonSyntaxException

          findings.push({
            severity: "CRITICAL",
            field: change.field,
            changeType: "typeChanged",
            message:
              `Type mismatch on field \`${change.field}\`: ` +
              `backend now sends \`${change.newType}\`, ` +
              `but \`${ann.kotlinProperty}: ${ann.kotlinType}\` expects \`${expectedJsonType}\`. ` +
              (willThrow
                ? `Gson WILL throw \`JsonSyntaxException\` at runtime — app crash.`
                : `Gson silently coerces \`"${change.newValue}"\` (String) → \`${change.newValue}\` (${ann.kotlinType}). ` +
                  `No exception thrown, but the JSON type is wrong (Scenario B — invisible to value-only tests). ` +
                  `Only a JSON type inspection test (\`isNumber()\`) detects this.`),
            line: ann.annotationLine,
            snippet: ann.annotationSnippet,
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
 * Parses all @SerializedName annotations from a Kotlin source file.
 * Handles the pattern:
 *   @SerializedName("fieldName") val propertyName: KotlinType
 *
 * Also handles multi-line:
 *   @SerializedName("fieldName")
 *   val propertyName: KotlinType
 *
 * @param {string[]} lines
 * @returns {ParsedAnnotation[]}
 *
 * @typedef {Object} ParsedAnnotation
 * @property {string} serializedName     — the JSON field name in the annotation
 * @property {string} kotlinProperty     — the Kotlin property name
 * @property {string} kotlinType         — the Kotlin type (e.g. "Double", "String", "Int")
 * @property {number} annotationLine     — 1-based line number of @SerializedName
 * @property {string} annotationSnippet  — trimmed text of the annotation line
 */
function parseSerializedNames(lines) {
  const results = [];

  // Inline pattern: @SerializedName("x") val y: Z
  const inlinePattern =
    /^\s*@SerializedName\("([^"]+)"\)\s+val\s+(\w+)\s*:\s*(\w+)/;

  // Two-line pattern:
  //   line N:   @SerializedName("x")
  //   line N+1: val y: Z
  const annotationOnly = /^\s*@SerializedName\("([^"]+)"\)\s*$/;
  const propertyLine = /^\s*val\s+(\w+)\s*:\s*(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try inline first
    const inlineMatch = inlinePattern.exec(line);
    if (inlineMatch) {
      results.push({
        serializedName: inlineMatch[1],
        kotlinProperty: inlineMatch[2],
        kotlinType: inlineMatch[3],
        annotationLine: i + 1,
        annotationSnippet: line.trim(),
      });
      continue;
    }

    // Try two-line form
    const annMatch = annotationOnly.exec(line);
    if (annMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const propMatch = propertyLine.exec(nextLine);
      if (propMatch) {
        results.push({
          serializedName: annMatch[1],
          kotlinProperty: propMatch[1],
          kotlinType: propMatch[2],
          annotationLine: i + 1,
          annotationSnippet: line.trim(),
        });
      }
    }
  }

  return results;
}

/**
 * Parses ALL val properties from a Kotlin data class — both annotated and plain.
 * For unannotated properties, serializedName == kotlinProperty (Gson default behaviour).
 * For annotated properties, serializedName comes from @SerializedName.
 *
 * @param {string[]} lines
 * @returns {ParsedAnnotation[]}
 */
function parseAllProperties(lines) {
  const results = [];

  // Inline annotated: @SerializedName("x") val y: Z
  const inlinePattern =
    /^\s*@SerializedName\("([^"]+)"\)\s+val\s+(\w+)\s*:\s*(\w+)/;

  // Annotation-only line: @SerializedName("x")
  const annotationOnly = /^\s*@SerializedName\("([^"]+)"\)\s*$/;

  // Plain property: val y: Z  (no annotation on this line or previous line)
  const plainProperty = /^\s*val\s+(\w+)\s*:\s*(\w+)/;

  const seenLines = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inline annotated
    const inlineMatch = inlinePattern.exec(line);
    if (inlineMatch) {
      results.push({
        serializedName: inlineMatch[1],
        kotlinProperty: inlineMatch[2],
        kotlinType: inlineMatch[3],
        annotationLine: i + 1,
        annotationSnippet: line.trim(),
      });
      seenLines.add(i);
      continue;
    }

    // Two-line annotated
    const annMatch = annotationOnly.exec(line);
    if (annMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const propMatch = plainProperty.exec(nextLine);
      if (propMatch) {
        results.push({
          serializedName: annMatch[1],
          kotlinProperty: propMatch[1],
          kotlinType: propMatch[2],
          annotationLine: i + 1,
          annotationSnippet: line.trim(),
        });
        seenLines.add(i);
        seenLines.add(i + 1);
      }
      continue;
    }

    // Plain (unannotated) property — serializedName equals the property name
    if (!seenLines.has(i)) {
      const plainMatch = plainProperty.exec(line);
      if (plainMatch) {
        results.push({
          serializedName: plainMatch[1],  // Gson maps field name directly
          kotlinProperty: plainMatch[1],
          kotlinType: plainMatch[2],
          annotationLine: i + 1,
          annotationSnippet: line.trim(),
        });
        seenLines.add(i);
      }
    }
  }

  return results;
}

module.exports = { runMobileScanner };
