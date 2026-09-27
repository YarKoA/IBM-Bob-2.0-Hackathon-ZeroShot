/**
 * webhook.js — Sprint 3: Tarea 3.1 + 3.2 + 3.3
 *
 * Simula el webhook de GitHub que se dispara cuando un desarrollador
 * modifica backend/src/producto.schema.js en un Pull Request.
 *
 * Flujo completo:
 *   1. Lee el schema ACTUAL desde disco   (estado HEAD — "before")
 *   2. Aplica la mutación del escenario   ("after" — lo que el PR propone)
 *   3. Extrae las líneas que cambiaron    (diff simulado)
 *   4. Envía el contexto a la API de IBM Bob 2.0 vía HTTP
 *   5. Toma la respuesta de Bob y la formatea como comentario de PR
 *   6. Imprime el reporte en consola (y opcionalmente lo postea en GitHub)
 *
 * Usage:
 *   node webhook.js --scenario A      # campo renombrado
 *   node webhook.js --scenario B      # cambio de tipo
 *   node webhook.js --scenario C      # campo eliminado
 *   node webhook.js --scenario clean  # sin ruptura (baseline verde)
 *
 * Env vars (agent/.env):
 *   BOB_API_URL          — URL base de la API de Bob 2.0
 *                          e.g. https://us-south.ml.cloud.ibm.com
 *   BOB_API_KEY          — API key de IBM Cloud / watsonx
 *   BOB_PROJECT_ID       — Project ID de watsonx.ai
 *   BOB_MODEL_ID         — Model ID (default: ibm/granite-3-3-8b-instruct)
 *   GITHUB_TOKEN         — PAT con scope repo (para postear comentario)
 *   GITHUB_PR_NUMBER     — Número del PR donde postear
 *   GITHUB_OWNER         — dueño del repo (default: YarKoA)
 *   GITHUB_REPO          — nombre del repo
 */

"use strict";

require("dotenv").config({ path: __dirname + "/.env" });

const https   = require("https");
const http    = require("http");
const { URL } = require("url");
const { loadBackendSchema } = require("./lib/fileReader");
const { diffSchemas }       = require("./lib/schemaDiff");

// ─── Scenario mutations (same as trigger.js) ─────────────────────────────────
const MUTATIONS = {
  A:     (schema) => ({ id: schema.id, nombre: schema.nombre, precio_total: schema.precioTotal }),
  B:     (schema) => ({ ...schema, precioTotal: String(schema.precioTotal) }),
  C:     (schema) => { const s = { ...schema }; delete s.nombre; return s; },
  clean: (schema) => ({ ...schema, nombre: schema.nombre + " Pro", precioTotal: schema.precioTotal + 100 }),
};

const SCENARIO_LABELS = {
  A:     "Scenario A: Field Rename (precioTotal → precio_total)",
  B:     "Scenario B: Type Change (precioTotal: 1500 → \"1500\")",
  C:     "Scenario C: Field Removed (nombre deleted)",
  clean: "Clean: No breaking changes (value update only)",
};

// ─── CLI parsing ──────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const scenarioIdx  = args.indexOf("--scenario");
const scenarioKey  = scenarioIdx !== -1 ? args[scenarioIdx + 1] : undefined;

if (!scenarioKey || !MUTATIONS[scenarioKey]) {
  console.error(
    "Usage: node webhook.js --scenario <A|B|C|clean>\n\n" +
    "Available scenarios:\n" +
    Object.keys(MUTATIONS).map((k) => `  ${k.padEnd(7)}  ${SCENARIO_LABELS[k]}`).join("\n")
  );
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  printBanner();

  // ── Tarea 3.1: Intercepción del cambio ──────────────────────────────────────
  console.log("\n[1/4] 📂 Reading live backend schema from disk...");
  const oldSchema = loadBackendSchema();
  const newSchema = MUTATIONS[scenarioKey](oldSchema);
  console.log(`  Old: ${JSON.stringify(oldSchema)}`);
  console.log(`  New: ${JSON.stringify(newSchema)}`);

  const delta = diffSchemas(oldSchema, newSchema);
  const changedLines = extractChangedLines(oldSchema, newSchema, delta);

  console.log(`\n[1/4] ✅ Diff extracted — ${changedLines.length} changed line(s):`);
  for (const line of changedLines) {
    const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : "~";
    console.log(`  ${prefix} ${line.content}`);
  }

  if (!delta.hasBreaks) {
    console.log("\n  ✅ No breaking changes. Pipeline stops here (no Bob call needed).");
    process.exit(0);
  }

  // ── Tarea 3.2: Llamada a la API de IBM Bob 2.0 ──────────────────────────────
  console.log("\n[2/4] 🤖 Sending changed code to IBM Bob 2.0 API...");
  const prompt = buildBobPrompt(oldSchema, newSchema, delta, changedLines, SCENARIO_LABELS[scenarioKey]);

  let bobResponseText;
  try {
    bobResponseText = await callBobApi(prompt);
    console.log("  ✅ Bob 2.0 responded.");
  } catch (err) {
    console.warn(`  ⚠️  Bob API unavailable (${err.message}). Using offline fallback analysis.`);
    bobResponseText = buildOfflineFallback(delta, SCENARIO_LABELS[scenarioKey]);
  }

  // ── Tarea 3.3: Formateo del Reporte Final ───────────────────────────────────
  console.log("\n[3/4] 📝 Formatting final PR comment report...");
  const prComment = formatPrComment(bobResponseText, delta, changedLines, SCENARIO_LABELS[scenarioKey]);

  printReport(prComment);

  // ── Post to GitHub (optional) ───────────────────────────────────────────────
  console.log("[4/4] 📬 Posting to GitHub...");
  const token    = process.env.GITHUB_TOKEN;
  const prNumber = process.env.GITHUB_PR_NUMBER;
  const owner    = process.env.GITHUB_OWNER || "YarKoA";
  const repo     = process.env.GITHUB_REPO  || "IBM-Bob-2.0-Hackathon-ZeroShot";

  if (!token || !prNumber) {
    console.warn("  ⚠️  GITHUB_TOKEN or GITHUB_PR_NUMBER not set — skipping GitHub post.");
    console.warn("     Set them in agent/.env to enable automatic PR commenting.");
  } else {
    try {
      const resp = await postGithubComment({ token, owner, repo, prNumber, body: prComment });
      console.log(`  ✅ Comment posted to PR #${prNumber} — ${resp.html_url}`);
    } catch (err) {
      console.error(`  ❌ GitHub post failed: ${err.message}`);
    }
  }
})();

// ─── Tarea 3.1 helper: extract changed lines as structured diff ───────────────
function extractChangedLines(oldSchema, newSchema, delta) {
  const lines = [];
  for (const change of delta.changes) {
    if (change.type === "renamed") {
      lines.push({ type: "removed", content: `  "${change.oldName}": ${JSON.stringify(change.oldValue)},  // RENAMED` });
      lines.push({ type: "added",   content: `  "${change.newName}": ${JSON.stringify(change.newValue)},  // NEW NAME` });
    } else if (change.type === "removed") {
      lines.push({ type: "removed", content: `  "${change.field}": ${JSON.stringify(change.oldValue)},  // DELETED` });
    } else if (change.type === "added") {
      lines.push({ type: "added",   content: `  "${change.field}": ${JSON.stringify(change.newValue)},  // ADDED` });
    } else if (change.type === "typeChanged") {
      lines.push({ type: "removed", content: `  "${change.field}": ${JSON.stringify(change.oldValue)},  // WAS ${change.oldType}` });
      lines.push({ type: "added",   content: `  "${change.field}": ${JSON.stringify(change.newValue)},  // NOW ${change.newType}` });
    }
  }
  return lines;
}

// ─── Tarea 3.2: Build the prompt for Bob 2.0 ─────────────────────────────────
function buildBobPrompt(oldSchema, newSchema, delta, changedLines, scenarioLabel) {
  const diffBlock = changedLines
    .map((l) => (l.type === "added" ? `+ ${l.content}` : `- ${l.content}`))
    .join("\n");

  const changeDescriptions = delta.changes.map((c) => {
    if (c.type === "renamed")     return `RENAMED field "${c.oldName}" → "${c.newName}"`;
    if (c.type === "removed")     return `REMOVED field "${c.field}" (was ${c.oldType})`;
    if (c.type === "typeChanged") return `TYPE CHANGE on field "${c.field}": ${c.oldType} → ${c.newType}`;
    if (c.type === "added")       return `ADDED field "${c.field}" (${c.newType})`;
    return "";
  }).join("\n");

  return `You are a backend contract validator for a multi-platform API.

A developer has modified the backend contract file \`backend/src/producto.schema.js\` in a Pull Request.

## Git diff (changed lines)
\`\`\`diff
--- a/backend/src/producto.schema.js
+++ b/backend/src/producto.schema.js
${diffBlock}
\`\`\`

## Detected breaking changes
${changeDescriptions}

## Consumers affected
- **Web consumer**: Next.js frontend (web/app/page.js) accesses \`producto.nombre\`, \`producto.precioTotal\` directly
- **Mobile consumer**: Kotlin/JVM (Producto.kt) uses \`@SerializedName\` with Gson deserialization

## Your task
Analyze each breaking change and explain:
1. How it breaks the Web consumer silently (React renders undefined as empty — no console error)
2. How it breaks the Mobile consumer silently (Gson coerces or assigns 0/null — no exception thrown)
3. Why grep / unit tests cannot catch this without schema-level validation
4. The severity: CRITICAL (silent data loss) or WARNING (degraded rendering only)

Be concise and technical. Format your response as structured findings per change.`;
}

// ─── Tarea 3.2: Call IBM Bob 2.0 / watsonx.ai API ────────────────────────────
async function callBobApi(prompt) {
  const baseUrl    = process.env.BOB_API_URL    || "https://us-south.ml.cloud.ibm.com";
  const apiKey     = process.env.BOB_API_KEY;
  const projectId  = process.env.BOB_PROJECT_ID;
  const modelId    = process.env.BOB_MODEL_ID || "ibm/granite-3-3-8b-instruct";

  if (!apiKey || !projectId) {
    throw new Error("BOB_API_KEY or BOB_PROJECT_ID not set in agent/.env");
  }

  // Get IAM token
  const iamToken = await getIamToken(apiKey);

  const body = JSON.stringify({
    model_id:   modelId,
    project_id: projectId,
    input:      prompt,
    parameters: {
      decoding_method: "greedy",
      max_new_tokens:  800,
      repetition_penalty: 1.1,
    },
  });

  const endpoint = `${baseUrl}/ml/v1/text/generation?version=2023-05-29`;
  return await httpsPost(endpoint, body, {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${iamToken}`,
    "Accept":        "application/json",
  }, (parsed) => parsed.results?.[0]?.generated_text?.trim() || JSON.stringify(parsed));
}

// ─── IAM token exchange ───────────────────────────────────────────────────────
function getIamToken(apiKey) {
  const body = `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`;
  return httpsPost("https://iam.cloud.ibm.com/identity/token", body, {
    "Content-Type":  "application/x-www-form-urlencoded",
    "Accept":        "application/json",
  }, (parsed) => parsed.access_token);
}

// ─── Generic HTTPS POST helper ────────────────────────────────────────────────
function httpsPost(endpoint, body, headers, extract) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(endpoint);
    const isHttps = parsed.protocol === "https:";
    const lib     = isHttps ? https : http;

    const bodyBuf = Buffer.from(body, "utf8");
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ""),
      method:   "POST",
      headers:  { ...headers, "Content-Length": bodyBuf.byteLength },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(extract(obj));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${obj.message || obj.error || data}`));
          }
        } catch {
          reject(new Error(`Non-JSON response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ─── Tarea 3.2 fallback: offline analysis when Bob is unreachable ─────────────
function buildOfflineFallback(delta, label) {
  return delta.changes.map((c) => {
    if (c.type === "renamed")
      return `**RENAMED \`${c.oldName}\` → \`${c.newName}\`**: Web will render \`undefined\` (silent). Kotlin @SerializedName("${c.oldName}") stale — Gson assigns 0.0 (silent). grep detects rename but NOT the runtime impact.`;
    if (c.type === "removed")
      return `**REMOVED \`${c.field}\`**: Web renders empty cell with HTTP 200 — zero console errors. Kotlin assigns null/0 via Gson — no JsonSyntaxException. Worst-case silent failure; no test suite catches this without a schema check.`;
    if (c.type === "typeChanged")
      return `**TYPE CHANGE \`${c.field}\`: ${c.oldType} → ${c.newType}**: Field name unchanged — grep finds nothing. Gson coerces String→Double silently; value test passes. Only \`isNumber()==false\` at JSON parse time reveals the drift.`;
    return `**${c.type.toUpperCase()} \`${c.field}\`**: change detected.`;
  }).join("\n\n");
}

// ─── Tarea 3.3: Format the final PR comment ───────────────────────────────────
function formatPrComment(bobText, delta, changedLines, label) {
  const criticalCount = delta.changes.filter(
    (c) => c.type === "renamed" || c.type === "removed" || c.type === "typeChanged"
  ).length;

  const header = criticalCount > 0
    ? "## 🛑 ZeroShot · Sprint 3 — BREAKING CHANGES DETECTED"
    : "## ✅ ZeroShot · Sprint 3 — Contract Validated (No Issues)";

  const diffBlock = changedLines
    .map((l) => (l.type === "added" ? `+${l.content}` : `-${l.content}`))
    .join("\n");

  // Build severity table
  const tableRows = delta.changes.map((c) => {
    let severity = "ℹ️ INFO";
    if (c.type === "renamed" || c.type === "removed") severity = "🛑 CRITICAL";
    if (c.type === "typeChanged") severity = "⚠️ WARNING";
    if (c.type === "added")       severity = "✅ SAFE";

    const description = {
      renamed:     `\`${c.oldName}\` renamed → \`${c.newName}\``,
      removed:     `\`${c.field}\` deleted (was \`${c.oldType}\`)`,
      typeChanged: `\`${c.field}\` type drift \`${c.oldType}\` → \`${c.newType}\``,
      added:       `\`${c.field}\` added (\`${c.newType}\`)`,
    }[c.type] || c.type;

    const impact = {
      renamed:     "Web: `undefined` cell · Mobile: Gson assigns `0.0`",
      removed:     "Web: empty cell + HTTP 200 · Mobile: Gson assigns `null`",
      typeChanged: "Web: arithmetic → NaN · Mobile: Gson coerces silently",
      added:       "Additive — existing consumers unaffected",
    }[c.type] || "—";

    const detectable = {
      renamed:     "grep ✅ · runtime exc ❌ · schema diff ✅",
      removed:     "grep ❌ · runtime exc ❌ · schema diff ✅",
      typeChanged: "grep ❌ · runtime exc ❌ · `isNumber()` ✅",
      added:       "n/a",
    }[c.type] || "—";

    return `| ${severity} | ${description} | ${impact} | ${detectable} |`;
  });

  const lines = [
    header,
    "",
    `**Trigger:** \`${label}\`  `,
    `**Analysis by:** ZeroShot Webhook (Sprint 3) + IBM Bob 2.0 API  `,
    `**Changed file:** \`backend/src/producto.schema.js\``,
    "",
    "### 📋 Contract Delta",
    "```diff",
    "--- a/backend/src/producto.schema.js",
    "+++ b/backend/src/producto.schema.js",
    diffBlock,
    "```",
    "",
    "### 🔍 Impact Analysis",
    "",
    "| Severity | Change | Consumer Impact | Detectable by |",
    "|----------|--------|-----------------|---------------|",
    ...tableRows,
    "",
    "### 🤖 IBM Bob 2.0 Analysis",
    "",
    bobText,
    "",
    "---",
    "*Generated by **ZeroShot Contract Validation Webhook** — IBM Bob 2.0 Hackathon · Sprint 3.  ",
    "Do not merge until all 🛑 findings are resolved.*",
  ];

  return lines.join("\n");
}

// ─── Post to GitHub ───────────────────────────────────────────────────────────
function postGithubComment({ token, owner, repo, prNumber, body }) {
  const payload = JSON.stringify({ body });
  return httpsPost(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    payload,
    {
      "Content-Type":       "application/json",
      "Authorization":      `Bearer ${token}`,
      "User-Agent":         "ZeroShot-Sprint3-Webhook/1.0",
      "Accept":             "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    (parsed) => parsed
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function printBanner() {
  console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║   ZeroShot · Sprint 3 — Webhook + Bob 2.0 API Integration          ║");
  console.log("║   Automatic contract validation on simulated PR event               ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(`\n  Scenario : ${SCENARIO_LABELS[scenarioKey]}`);
  console.log(`  Schema   : backend/src/producto.schema.js (live read from disk)`);
}

function printReport(comment) {
  console.log("\n" + "═".repeat(72));
  console.log("  PULL REQUEST COMMENT — SPRINT 3 FORMATTED REPORT");
  console.log("═".repeat(72) + "\n");
  console.log(comment);
  console.log("\n" + "═".repeat(72) + "\n");
}
