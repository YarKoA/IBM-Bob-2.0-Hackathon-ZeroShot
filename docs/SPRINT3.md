# Sprint 3: Automatización y Presentación

## ZeroShot Contract Validation — Webhook + IBM Bob 2.0 API Integration

**Fecha:** 2026-09-27  
**Rama:** main  
**Stack:** Node.js · IBM watsonx.ai (Granite) · GitHub REST API

---

## 0. Resumen ejecutivo

Sprint 3 cierra el ciclo de automatización:

- **Sprint 1** construyó el ecosistema vulnerable y documentó los 3 escenarios de ruptura.
- **Sprint 2** construyó el enjambre de validación multi-agente (análisis estático determinista).
- **Sprint 3** conecta ese enjambre con la API de IBM Bob 2.0 para obtener análisis de impacto en lenguaje natural, y formatea el resultado como un comentario automático de Pull Request.

---

## 1. Qué se construyó en Sprint 3

### `agent/webhook.js` — script central del sprint

Nuevo módulo Node.js que integra las 4 tareas del sprint:

| Tarea | Descripción |
|-------|-------------|
| **3.1** | Lee `backend/src/producto.schema.js` **en vivo desde disco** (no recibe el payload hardcodeado como `trigger.js`) y extrae las líneas que cambiaron vía `diffSchemas()` |
| **3.2** | Construye un prompt técnico y lo envía a la API de IBM watsonx.ai (modelo Granite) usando IAM token exchange + `https` nativo |
| **3.3** | Formatea la respuesta de Bob como un comentario de PR con tabla de severidad, contract delta en `diff`, y análisis por consumidor |
| **3.4** | (DEMO.md) Guión paso a paso para la presentación ante los jueces |

### `DEMO.md` — guión del demo en vivo

Documento en la raíz del repo con:
- 5 pasos exactos del demo (arrancar backend, mostrar funcionando, cambiar código, correr webhook, mostrar alerta)
- Frases clave para cada momento
- Tabla de puntos de énfasis para los jueces
- Checklist pre-demo
- Comandos de recuperación rápida si algo falla

---

## 2. Arquitectura del flujo de Sprint 3

```
[dev modifica producto.schema.js]
              │
              ▼
      webhook.js (Tarea 3.1)
    ┌─────────────────────────┐
    │ loadBackendSchema()      │  ← lee el schema ACTUAL desde disco
    │ MUTATIONS[scenario]()    │  ← aplica la mutación del PR
    │ diffSchemas(old, new)    │  ← calcula el delta estructurado
    │ extractChangedLines()    │  ← convierte el delta en líneas diff
    └────────────┬────────────┘
                 │ delta + changedLines
                 ▼
      webhook.js (Tarea 3.2)
    ┌─────────────────────────┐
    │ buildBobPrompt()         │  ← construye el prompt técnico
    │ getIamToken(apiKey)      │  ← IAM token exchange
    │ callBobApi(prompt)       │  ← POST /ml/v1/text/generation
    └────────────┬────────────┘
                 │ bobResponseText
                 ▼
      webhook.js (Tarea 3.3)
    ┌─────────────────────────┐
    │ formatPrComment()        │  ← tabla + diff + análisis Bob
    │ postGithubComment()      │  ← POST GitHub Issues API
    └─────────────────────────┘
```

---

## 3. Cómo ejecutar

### Prerequisito (una sola vez)
```bash
cd agent
npm install
```

### Sin credenciales de Bob (fallback offline — funciona siempre)
```bash
node webhook.js --scenario A      # campo renombrado
node webhook.js --scenario B      # cambio de tipo (el más peligroso)
node webhook.js --scenario C      # campo eliminado (el peor caso)
node webhook.js --scenario clean  # sin ruptura — baseline verde
```

O vía npm scripts:
```bash
npm run demo:A
npm run demo:B
npm run demo:C
npm run demo:clean
```

### Con IBM Bob 2.0 / watsonx.ai

1. Crear `agent/.env` desde `agent/.env.example`:
   ```bash
   cp agent/.env.example agent/.env
   ```

2. Editar `agent/.env`:
   ```env
   BOB_API_URL=https://us-south.ml.cloud.ibm.com
   BOB_API_KEY=tu_ibm_cloud_api_key
   BOB_PROJECT_ID=tu_watsonx_project_id
   BOB_MODEL_ID=ibm/granite-3-3-8b-instruct
   ```

3. Correr:
   ```bash
   node webhook.js --scenario B
   ```

### Con posteo automático en GitHub PR

Agregar al `agent/.env`:
```env
GITHUB_TOKEN=ghp_tu_token
GITHUB_PR_NUMBER=1
GITHUB_OWNER=YarKoA
GITHUB_REPO=IBM-Bob-2.0-Hackathon-ZeroShot
```

---

## 4. Detalles técnicos

### Tarea 3.1: El Script de Intercepción

`webhook.js` **no recibe** el payload de `trigger.js`. En cambio:

1. Llama a `loadBackendSchema()` (ya existía en `lib/fileReader.js` desde Sprint 2) para leer el schema vivo desde disco.
2. Aplica la mutación del escenario en memoria para simular el PR.
3. Llama a `diffSchemas()` (de `lib/schemaDiff.js`) para obtener el delta estructurado.
4. Convierte el delta en líneas `+`/`-` legibles en `extractChangedLines()`.

Esto simula exactamente lo que haría un webhook real de GitHub: recibir `before` y `after` del archivo modificado y extraer el diff.

### Tarea 3.2: Conexión con IBM Bob 2.0

Flujo de autenticación:
```
POST https://iam.cloud.ibm.com/identity/token
  Body: grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=...
  → access_token (IAM Bearer token, válido 1h)

POST https://us-south.ml.cloud.ibm.com/ml/v1/text/generation?version=2023-05-29
  Authorization: Bearer <access_token>
  Body: { model_id, project_id, input: <prompt>, parameters: {...} }
  → { results: [{ generated_text }] }
```

**Sin dependencias nuevas**: usa `https` nativo de Node.js. El `.env` ya tiene `dotenv` del Sprint 2.

**Fallback offline**: si `BOB_API_KEY` o `BOB_PROJECT_ID` no están configurados (o la API no está disponible), `buildOfflineFallback()` genera el análisis localmente a partir del delta determinista. El demo funciona siempre.

### Tarea 3.3: Formateo del Reporte Final

El comentario de PR tiene 4 secciones:

```markdown
## 🛑 ZeroShot · Sprint 3 — BREAKING CHANGES DETECTED

**Trigger:** `Scenario A: Field Rename`
**Changed file:** `backend/src/producto.schema.js`

### 📋 Contract Delta
```diff
- "precioTotal": 1500,  // RENAMED
+ "precio_total": 1500, // NEW NAME
```

### 🔍 Impact Analysis
| Severity   | Change          | Consumer Impact                     | Detectable by                  |
|------------|-----------------|-------------------------------------|--------------------------------|
| 🛑 CRITICAL | `precioTotal` renamed | Web: `undefined` cell · Mobile: `0.0` | grep ✅ · runtime exc ❌ · schema ✅ |

### 🤖 IBM Bob 2.0 Analysis
[Respuesta de Bob aquí]
```

---

## 5. Diferencia con Sprint 2 (`trigger.js`)

| Aspecto | Sprint 2 `trigger.js` | Sprint 3 `webhook.js` |
|---------|----------------------|----------------------|
| Entrada | Payload hardcodeado en el script | Schema leído vivo desde disco |
| Análisis | Determinista (regex + schemaDiff) | Determinista **+** IBM Bob 2.0 LLM |
| Salida | PR comment texto plano | PR comment con tabla de severidad + análisis Bob |
| Subagentes | Lanza webScanner + mobileScanner | Schema diff directo (más ligero para el demo) |
| Fallback | N/A | Análisis offline automático si Bob no está disponible |

Los dos scripts coexisten. `trigger.js` sigue siendo la demostración del enjambre de Sprint 2. `webhook.js` es la integración completa de Sprint 3.

---

## 6. Archivos nuevos en Sprint 3

```
agent/
  webhook.js          ← NUEVO: script central del sprint (Tareas 3.1–3.3)
  .env.example        ← ACTUALIZADO: añadidas variables BOB_*
  package.json        ← ACTUALIZADO: versión 3.0.0, scripts demo:A/B/C/clean

DEMO.md               ← NUEVO: guión del demo para los jueces (Tarea 3.4)
docs/SPRINT3.md       ← NUEVO: esta documentación técnica
```

---

*ZeroShot Contract Validation Swarm — IBM Bob 2.0 Hackathon · Sprint 3*
