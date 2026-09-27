/**
 * consolidator.js
 *
 * Merges findings from Subagent A (Web) and Subagent B (Mobile),
 * formats the final PR comment in Markdown, prints it to stdout,
 * and posts it to the GitHub PR via the REST API.
 *
 * GitHub API call:
 *   POST /repos/{owner}/{repo}/issues/{pr_number}/comments
 *   Authorization: Bearer <GITHUB_TOKEN>
 *
 * Env vars required (loaded by principal.js via dotenv):
 *   GITHUB_TOKEN      — PAT with repo scope
 *   GITHUB_PR_NUMBER  — the PR to comment on
 *   GITHUB_OWNER      — repo owner (default: YarKoA)
 *   GITHUB_REPO       — repo name  (default: IBM-Bob-2.0-Hackathon-ZeroShot)
 */

"use strict";

const https = require("https");

/**
 * @param {import('./subagents/webScanner').WebScanResult}    webResult
 * @param {import('./subagents/mobileScanner').MobileScanResult} mobileResult
 * @param {import('./lib/schemaDiff').SchemaDelta}             delta
 * @param {Object}                                             prInfo
 * @param {string}                                             prInfo.scenarioLabel  — e.g. "Scenario A: Rename"
 * @param {Object}                                             prInfo.oldSchema
 * @param {Object}                                             prInfo.newSchema
 * @returns {Promise<{ comment: string, posted: boolean, githubResponse: string|null }>}
 */
async function consolidate(webResult, mobileResult, delta, prInfo) {
  const allFindings = [
    ...webResult.findings.map((f) => ({ ...f, consumer: "Web (Next.js)", file: webResult.file })),
    ...mobileResult.findings.map((f) => ({ ...f, consumer: "Mobile (Kotlin/JVM)", file: mobileResult.file })),
  ];

  const criticals = allFindings.filter((f) => f.severity === "CRITICAL");
  const warnings  = allFindings.filter((f) => f.severity === "WARNING");

  const hasCriticals = criticals.length > 0;

  // ─── Build PR comment ────────────────────────────────────────────────────
  const lines = [];

  // Header
  if (hasCriticals) {
    lines.push("## 🛑 ZeroShot Contract Validation — BREAKING CHANGES DETECTED");
  } else if (warnings.length > 0) {
    lines.push("## ⚠️ ZeroShot Contract Validation — Warnings");
  } else {
    lines.push("## ✅ ZeroShot Contract Validation — No Issues Found");
  }

  lines.push("");
  lines.push(`**Trigger:** \`${prInfo.scenarioLabel}\``);
  lines.push(`**Analysed by:** Principal Agent + Subagent A (Web) + Subagent B (Mobile)`);
  lines.push("");

  // Contract diff summary
  lines.push("### Contract Delta");
  lines.push("```diff");
  for (const change of delta.changes) {
    if (change.type === "renamed") {
      lines.push(`- ${change.oldName}: ${JSON.stringify(change.oldValue)}  // OLD`);
      lines.push(`+ ${change.newName}: ${JSON.stringify(change.newValue)}  // RENAMED`);
    } else if (change.type === "removed") {
      lines.push(`- ${change.field}: ${JSON.stringify(change.oldValue)}  // REMOVED`);
    } else if (change.type === "added") {
      lines.push(`+ ${change.field}: ${JSON.stringify(change.newValue)}  // ADDED`);
    } else if (change.type === "typeChanged") {
      lines.push(`- ${change.field}: ${change.oldType}  // OLD TYPE`);
      lines.push(`+ ${change.field}: ${change.newType}  // NEW TYPE`);
    }
  }
  lines.push("```");
  lines.push("");

  // Errors section
  if (webResult.error) {
    lines.push(`> ⚠️ **Subagent A error:** ${webResult.error}`);
    lines.push("");
  }
  if (mobileResult.error) {
    lines.push(`> ⚠️ **Subagent B error:** ${mobileResult.error}`);
    lines.push("");
  }

  // Findings
  if (allFindings.length === 0) {
    lines.push("No consumer references to changed fields were found. The consumers appear safe.");
  } else {
    if (criticals.length > 0) {
      lines.push("### 🛑 Critical Findings");
      lines.push("");
      for (const f of criticals) {
        lines.push(`**[${f.consumer}]** \`${f.file}\` — line ${f.line}`);
        lines.push(`> ${f.message}`);
        lines.push("```");
        lines.push(f.snippet);
        lines.push("```");
        lines.push("");
      }
    }

    if (warnings.length > 0) {
      lines.push("### ⚠️ Warnings");
      lines.push("");
      for (const f of warnings) {
        lines.push(`**[${f.consumer}]** \`${f.file}\` — line ${f.line}`);
        lines.push(`> ${f.message}`);
        lines.push("```");
        lines.push(f.snippet);
        lines.push("```");
        lines.push("");
      }
    }
  }

  // Scenario-specific explanation
  const hasTypeChange = delta.changes.some((c) => c.type === "typeChanged");
  const hasRename     = delta.changes.some((c) => c.type === "renamed");
  const hasRemoval    = delta.changes.some((c) => c.type === "removed");

  if (hasTypeChange) {
    lines.push("---");
    lines.push(
      "> **ℹ️ Scenario B note:** The field name did not change — `grep` finds nothing abnormal. " +
      "The type change is invisible to text search and to Gson deserialization (Gson coerces silently). " +
      "Only JSON schema-level type inspection (`isNumber()`) detects this. " +
      "This is why contract validation requires schema analysis, not just string matching."
    );
    lines.push("");
  }

  if (hasRemoval) {
    lines.push("---");
    lines.push(
      "> **ℹ️ Scenario C note (worst case):** The removed field produces no exception in any consumer. " +
      "HTTP 200 is returned. The web renders an empty cell. Kotlin holds `null` / `0`. " +
      "No Sentry alert, no crash, no CI failure without the test suite. " +
      "The only visible symptom is a wrong value in the UI."
    );
    lines.push("");
  }

  if (hasRename && !hasTypeChange && !hasRemoval) {
    lines.push("---");
    lines.push(
      "> **ℹ️ Scenario A note:** This rename IS detectable by grep (`precioTotal` → `precio_total`). " +
      "It is included as a control scenario to confirm the validation suite works. " +
      "The more dangerous scenarios (B and C) are not detectable by text search."
    );
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push(
    "*Generated by ZeroShot Contract Validation Swarm — IBM Bob 2.0 Hackathon. " +
    "Do not merge until all 🛑 findings are resolved.*"
  );

  const comment = lines.join("\n");

  // ─── Print to console ────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(72));
  console.log("  PR COMMENT OUTPUT");
  console.log("═".repeat(72) + "\n");
  console.log(comment);
  console.log("\n" + "═".repeat(72) + "\n");

  // ─── Post to GitHub ──────────────────────────────────────────────────────
  const token    = process.env.GITHUB_TOKEN;
  const prNumber = process.env.GITHUB_PR_NUMBER;
  const owner    = process.env.GITHUB_OWNER || "YarKoA";
  const repo     = process.env.GITHUB_REPO  || "IBM-Bob-2.0-Hackathon-ZeroShot";

  if (!token || !prNumber) {
    console.warn(
      "⚠️  GITHUB_TOKEN or GITHUB_PR_NUMBER not set — skipping GitHub post.\n" +
      "   Set them in agent/.env to enable automatic PR commenting."
    );
    return { comment, posted: false, githubResponse: null };
  }

  let githubResponse = null;
  let posted = false;

  try {
    githubResponse = await postGithubComment({ token, owner, repo, prNumber, body: comment });
    posted = true;
    console.log(`✅ Comment posted to PR #${prNumber} on ${owner}/${repo}`);
    console.log(`   URL: ${githubResponse.html_url}`);
  } catch (err) {
    console.error(`❌ Failed to post GitHub comment: ${err.message}`);
    githubResponse = err.message;
  }

  return { comment, posted, githubResponse };
}

/**
 * Posts a comment to a GitHub PR via HTTPS (no third-party dependencies).
 *
 * @param {{ token: string, owner: string, repo: string, prNumber: string, body: string }} opts
 * @returns {Promise<Object>} — the parsed JSON response from GitHub
 */
function postGithubComment({ token, owner, repo, prNumber, body }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ body });
    const options = {
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ZeroShot-Contract-Agent/2.0",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(
              new Error(
                `GitHub API returned HTTP ${res.statusCode}: ${parsed.message || data}`
              )
            );
          }
        } catch {
          reject(new Error(`GitHub API returned non-JSON response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { consolidate };
