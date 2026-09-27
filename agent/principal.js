/**
 * principal.js — Principal Agent
 *
 * Entry point for the Sprint 2 validation swarm.
 * Receives a contract change payload, computes the schema delta,
 * launches Subagent A (Web) and Subagent B (Mobile) in parallel,
 * then hands results to the consolidator.
 *
 * Called by trigger.js. Not meant to be run directly.
 *
 * @param {PrincipalPayload} payload
 * @returns {Promise<void>}
 *
 * @typedef {Object} PrincipalPayload
 * @property {Object} oldSchema      — the previous backend contract
 * @property {Object} newSchema      — the proposed new backend contract
 * @property {string} scenarioLabel  — human label for the trigger (e.g. "Scenario A: Rename")
 * @property {string} changedFile    — the file that changed (e.g. "backend/src/producto.schema.js")
 */

"use strict";

const { diffSchemas }     = require("./lib/schemaDiff");
const { runWebScanner }   = require("./subagents/webScanner");
const { runMobileScanner } = require("./subagents/mobileScanner");
const { consolidate }     = require("./consolidator");

async function runPrincipalAgent(payload) {
  const { oldSchema, newSchema, scenarioLabel, changedFile } = payload;

  console.log("\n" + "─".repeat(72));
  console.log(`  PRINCIPAL AGENT — ${scenarioLabel}`);
  console.log("─".repeat(72));
  console.log(`  Changed file : ${changedFile}`);
  console.log(`  Old schema   : ${JSON.stringify(oldSchema)}`);
  console.log(`  New schema   : ${JSON.stringify(newSchema)}`);

  // Step 1: Compute contract delta
  console.log("\n[1/3] Computing schema delta...");
  const delta = diffSchemas(oldSchema, newSchema);

  if (!delta.hasBreaks) {
    console.log("  ✅ No breaking changes detected in the schema delta.");
    console.log("     Consumers are not affected by this change.");
    return;
  }

  console.log(`  ⚠️  Breaking changes detected: ${delta.changes.length} change(s)`);
  for (const c of delta.changes) {
    if (c.type === "renamed")     console.log(`     • RENAMED     : ${c.oldName} → ${c.newName}`);
    if (c.type === "removed")     console.log(`     • REMOVED     : ${c.field} (was ${c.oldType})`);
    if (c.type === "typeChanged") console.log(`     • TYPE CHANGED: ${c.field} (${c.oldType} → ${c.newType})`);
    if (c.type === "added")       console.log(`     • ADDED       : ${c.field} (${c.newType})`);
  }

  // Step 2: Launch subagents in parallel
  console.log("\n[2/3] Launching subagents in parallel...");
  console.log("      → Subagent A: Web Scanner  (web/app/page.js)");
  console.log("      → Subagent B: Mobile Scanner (Producto.kt)");

  const [webResult, mobileResult] = await Promise.all([
    runWebScanner(delta.changes),
    runMobileScanner(delta.changes),
  ]);

  const totalFindings =
    webResult.findings.length + mobileResult.findings.length;

  console.log(`\n      Subagent A: ${webResult.findings.length} finding(s)${webResult.error ? " [ERROR: " + webResult.error + "]" : ""}`);
  console.log(`      Subagent B: ${mobileResult.findings.length} finding(s)${mobileResult.error ? " [ERROR: " + mobileResult.error + "]" : ""}`);
  console.log(`      Total     : ${totalFindings} finding(s)`);

  // Step 3: Consolidate and post
  console.log("\n[3/3] Consolidating findings and formatting PR comment...");
  await consolidate(webResult, mobileResult, delta, {
    scenarioLabel,
    oldSchema,
    newSchema,
  });
}

module.exports = { runPrincipalAgent };
