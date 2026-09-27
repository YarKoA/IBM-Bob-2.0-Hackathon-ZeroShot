# SPRINT2.md — Contract Validation Swarm

**Project:** Hackathon IBM Bob 2.0 — ZeroShot Contract Validation  
**Sprint:** 2 — The Agent Layer  
**Date:** 2026-09-26  
**Stack:** Node.js agent layer · Next.js (web consumer) · Kotlin/JVM (mobile consumer)

---

## What Sprint 2 Builds

Sprint 1 proved the problem: three scenarios where a backend contract change silently or loudly breaks consumers, none of which a grep can fully detect.

Sprint 2 adds the **automated detection layer**: a multi-agent swarm that intercepts a proposed backend change, fans out to both consumers in parallel, and posts a formatted alert comment on the GitHub PR — before the code merges.

---

## Architecture

```
trigger.js                         ← simulates GitHub PR webhook
    │
    ▼
agent/principal.js                 ← Principal Agent
    │  reads:  backend/src/producto.schema.js
    │  computes: schema delta (schemaDiff.js)
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  │
subagents/             subagents/         │  (Promise.all — parallel)
webScanner.js          mobileScanner.js   │
    │                  │                  │
    │  reads:          │  reads:          │
    │  web/app/page.js │  Producto.kt     │
    └────────┬─────────┘                  │
             ▼                            │
        consolidator.js ◄─────────────────┘
             │
             ├── prints formatted PR comment to stdout
             └── POST /repos/{owner}/{repo}/issues/{pr}/comments  (GitHub API)
```

### File Map

| File | Role |
|---|---|
| [`agent/trigger.js`](agent/trigger.js) | Entry point — constructs a contract change payload and passes it to the Principal Agent. Accepts `--scenario A/B/C/clean` |
| [`agent/principal.js`](agent/principal.js) | Principal Agent — reads the schema delta, launches subagents in parallel via `Promise.all` |
| [`agent/lib/schemaDiff.js`](agent/lib/schemaDiff.js) | Pure function — computes the diff between old and new schema objects (detects renames, type changes, removals, additions) |
| [`agent/lib/fileReader.js`](agent/lib/fileReader.js) | Utility — reads source files relative to workspace root |
| [`agent/subagents/webScanner.js`](agent/subagents/webScanner.js) | Subagent A — scans `web/app/page.js` for direct field accesses that reference changed/removed fields |
| [`agent/subagents/mobileScanner.js`](agent/subagents/mobileScanner.js) | Subagent B — parses `Producto.kt` for `@SerializedName` annotations and plain `val` properties, cross-references against the delta |
| [`agent/consolidator.js`](agent/consolidator.js) | Merges findings from both subagents, formats the PR comment, posts to GitHub via HTTPS |

---

## How to Run

### Prerequisites

```bash
cd agent
npm install   # installs only: dotenv
```

### Without GitHub posting (console output only)

```bash
cd agent
node trigger.js --scenario A    # field rename
node trigger.js --scenario B    # type change
node trigger.js --scenario C    # field removed
node trigger.js --scenario clean  # no breaking change (green)
```

### With GitHub PR commenting

1. Copy `.env.example` to `.env`:
   ```bash
   cp agent/.env.example agent/.env
   ```

2. Edit `agent/.env`:
   ```
   GITHUB_TOKEN=ghp_your_token_here
   GITHUB_PR_NUMBER=1
   GITHUB_OWNER=YarKoA
   GITHUB_REPO=IBM-Bob-2.0-Hackathon-ZeroShot
   ```

3. Run any scenario — the comment is posted automatically to the PR:
   ```bash
   node trigger.js --scenario A
   ```

---

## Validation Results — All 4 Scenarios

### Scenario A — Field Rename (`precioTotal` → `precio_total`)

```
Principal Agent: RENAMED: precioTotal → precio_total
Subagent A (Web):    1 finding  — web/app/page.js:53
Subagent B (Mobile): 1 finding  — Producto.kt:23

🛑 [Web]    producto.precioTotal will be undefined at runtime (silent render failure)
🛑 [Mobile] @SerializedName("precioTotal") is stale — Gson sets 0.0 silently
```

Detectable by grep? **YES** — included as a control scenario.

---

### Scenario B — Type Change (`precioTotal: 1500` → `precioTotal: "1500"`)

```
Principal Agent: TYPE CHANGED: precioTotal (number → string)
Subagent A (Web):    1 finding  — web/app/page.js:53  [WARNING]
Subagent B (Mobile): 1 finding  — Producto.kt:23      [CRITICAL]

⚠️  [Web]    React renders "1500" and "1500" look identical — silent drift
🛑 [Mobile] Type mismatch: Gson coerces String→Double silently.
             Value test PASSES. Only isNumber() type inspection detects this.
```

Detectable by grep? **NO** — the field name didn't change.  
Detectable by deserialization value test? **NO** — Gson coerces silently.  
Detectable by JSON type analysis? **YES** — this is why schema analysis is required.

---

### Scenario C — Field Removed (`nombre` deleted)

```
Principal Agent: REMOVED: nombre (was string)
Subagent A (Web):    1 finding  — web/app/page.js:48  [CRITICAL]
Subagent B (Mobile): 1 finding  — Producto.kt:22      [CRITICAL]

🛑 [Web]    producto.nombre is undefined — empty cell, HTTP 200, no console error
🛑 [Mobile] nombre (unannotated) maps by name — Gson sets null silently. No exception.
```

Detectable by grep? **NO** — grep cannot detect absence.  
Runtime exception thrown? **NO** — this is the worst case (Scenario C).  
Detectable by the agent? **YES** — schema diff catches the removal.

---

### Clean Scenario — Value update only (no structural change)

```
Principal Agent: ✅ No breaking changes detected.
                    Consumers are not affected by this change.
```

No subagents launched. No comment posted.

---

## Summary Table

| Scenario | Agent detects? | grep detects? | Runtime exception? | Worst case? |
|---|:---:|:---:|:---:|:---:|
| **A** — Rename | ✅ YES | ✅ YES | ❌ NO (silent) | No |
| **B** — Type change | ✅ YES | ❌ NO | ❌ NO (Gson coerces) | **The invisible one** |
| **C** — Field removed | ✅ YES | ❌ NO | ❌ NO (silent null) | **The worst case** |
| **Clean** — Value update | ✅ Green (no alert) | — | — | — |

---

## Why This Approach Needs No LLM

The intelligence is in **schema-level comparison**, not language models:

1. `schemaDiff.js` computes a structured delta by comparing two plain objects — renames are detected by value matching, type changes by `typeof` comparison.
2. `webScanner.js` uses regex to find live code references (not comments) to changed fields.
3. `mobileScanner.js` parses `@SerializedName` annotations and plain `val` declarations using regex, then cross-references them with the delta.

This makes the system **deterministic, fast (< 100ms), and zero-dependency beyond `dotenv`**. No API key required to run the analysis — only the GitHub post needs a token.

---

## What Sprint 3 Could Add

- Read `producto.schema.js` live from disk instead of accepting it as a payload (already supported via `lib/fileReader.js#loadBackendSchema`)
- GitHub webhook server that receives real PR events and runs the pipeline automatically
- Support for nested schemas (currently handles flat objects)
- Scan multiple web components (currently targets `page.js` only)
- Support for Kotlin `data class` with multiple files
