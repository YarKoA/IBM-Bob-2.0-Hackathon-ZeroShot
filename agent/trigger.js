/**
 * trigger.js — Sprint 2 entry point
 *
 * Simulates a GitHub PR webhook by constructing a contract change payload
 * and handing it to the Principal Agent.
 *
 * Usage:
 *   node trigger.js --scenario A      # field rename:      precioTotal → precio_total
 *   node trigger.js --scenario B      # type change:       precioTotal: 1500 → "1500"
 *   node trigger.js --scenario C      # field removal:     nombre removed
 *   node trigger.js --scenario clean  # no changes (green baseline)
 *
 * Environment variables (via agent/.env):
 *   GITHUB_TOKEN      — PAT with repo scope
 *   GITHUB_PR_NUMBER  — PR number to comment on
 *   GITHUB_OWNER      — repo owner (default: YarKoA)
 *   GITHUB_REPO       — repo name  (default: IBM-Bob-2.0-Hackathon-ZeroShot)
 *
 * To post real GitHub comments, create agent/.env from agent/.env.example
 * and fill in your token and PR number before running.
 */

"use strict";

// Load .env from the agent/ directory
require("dotenv").config({ path: __dirname + "/.env" });

const { runPrincipalAgent } = require("./principal");

// ─── Contract v1 (the Sprint 1 baseline — never changes) ─────────────────────
const CONTRACT_V1 = {
  id: 1,
  nombre: "Laptop",
  precioTotal: 1500,
};

// ─── Scenario definitions ─────────────────────────────────────────────────────
const SCENARIOS = {
  // Scenario A: field rename — detectable by grep, but still breaks consumers
  A: {
    label: "Scenario A: Field Rename (precioTotal → precio_total)",
    oldSchema: { ...CONTRACT_V1 },
    newSchema: { id: 1, nombre: "Laptop", precio_total: 1500 },
    changedFile: "backend/src/producto.schema.js",
  },

  // Scenario B: type change — NOT detectable by grep, NOT detectable by deserialization
  //             Only JSON schema-level type inspection catches this.
  B: {
    label: "Scenario B: Type Change (precioTotal: 1500 → \"1500\")",
    oldSchema: { ...CONTRACT_V1 },
    newSchema: { id: 1, nombre: "Laptop", precioTotal: "1500" },
    changedFile: "backend/src/producto.schema.js",
  },

  // Scenario C: field removed — silent failure in all consumers, no exception anywhere
  C: {
    label: "Scenario C: Field Removed (nombre deleted)",
    oldSchema: { ...CONTRACT_V1 },
    newSchema: { id: 1, precioTotal: 1500 },
    changedFile: "backend/src/producto.schema.js",
  },

  // Clean: no breaking change — agent should report green
  clean: {
    label: "Clean: No breaking changes (value update only)",
    oldSchema: { ...CONTRACT_V1 },
    newSchema: { id: 1, nombre: "Laptop Pro", precioTotal: 1600 },
    changedFile: "backend/src/producto.schema.js",
  },
};

// ─── CLI argument parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const scenarioFlagIdx = args.indexOf("--scenario");
const scenarioKey =
  scenarioFlagIdx !== -1 ? args[scenarioFlagIdx + 1] : undefined;

if (!scenarioKey || !SCENARIOS[scenarioKey]) {
  console.error(
    "Usage: node trigger.js --scenario <A|B|C|clean>\n\n" +
    "Available scenarios:\n" +
    Object.entries(SCENARIOS)
      .map(([key, s]) => `  ${key.padEnd(7)}  ${s.label}`)
      .join("\n")
  );
  process.exit(1);
}

const scenario = SCENARIOS[scenarioKey];

// ─── Run ──────────────────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
console.log("║   ZeroShot Contract Validation Swarm — IBM Bob 2.0 Hackathon        ║");
console.log("║   Sprint 2 — Principal Agent + Subagents                            ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝");

runPrincipalAgent({ ...scenario, scenarioLabel: scenario.label }).catch((err) => {
  console.error("\n❌ Fatal error in Principal Agent:", err);
  process.exit(1);
});
