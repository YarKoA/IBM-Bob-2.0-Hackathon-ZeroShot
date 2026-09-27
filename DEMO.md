# 🎬 Demo Script — ZeroShot Contract Validation · IBM Bob 2.0 Hackathon

> **Tiempo estimado del demo en vivo:** 4–5 minutos  
> **Audiencia:** Jueces del hackathon  
> **Objetivo:** Mostrar que un cambio de backend rompe a los consumidores en silencio,
> y que el sistema lo detecta automáticamente en segundos, antes de que llegue a producción.

---

## Contexto (30 segundos — abrir antes de subir al escenario)

Tenemos un monorepo con 3 apps conectadas:

```
backend/   → Express API  →  GET /api/producto  →  { id, nombre, precioTotal }
web/       → Next.js frontend que consume esa API
mobile/    → Kotlin/JVM que deserializa con Gson
```

El problema real: **un desarrollador cambia el backend → los consumidores se rompen en silencio → HTTP 200, cero excepciones, cero alertas en Sentry**.

---

## Paso 1 — Mostrar el sistema funcionando (1 minuto)

**Terminal 1 — Arrancar el backend:**
```bash
cd backend
npm install
node src/server.js
```
Mostrar en browser: `http://localhost:3001/api/producto`

```json
{ "id": 1, "nombre": "Laptop", "precioTotal": 1500 }
```

**Terminal 2 — Arrancar la web:**
```bash
cd web
npm install
npm run dev
```
Mostrar en browser: `http://localhost:3000`  
→ La tabla muestra **Laptop · $1500** ✅

**Frase clave para los jueces:**
> "Este es el estado feliz. Todo funciona. Ahora vamos a replicar lo que pasa cuando un desarrollador hace un cambio inocente."

---

## Paso 2 — Cambiar el código (30 segundos)

Abrir `backend/src/producto.schema.js` en el editor y hacer el cambio **en vivo**:

```js
// ANTES (contrato v1)
const productoSchema = {
  id: 1,
  nombre: "Laptop",
  precioTotal: 1500,     // ← este campo
};

// DESPUÉS (lo que el desarrollador propone en el PR)
const productoSchema = {
  id: 1,
  nombre: "Laptop",
  precio_total: 1500,   // ← renombrado (guión bajo)
};
```

**Guardar el archivo.**

**Frase clave:**
> "El desarrollador abre un Pull Request con este cambio. En un flujo normal, esto pasaría code review y llegaría a producción. Vamos a mostrar por qué eso es un problema."

*Opcional: recargar el browser de la web — el precio desaparece. HTTP 200. Sin errores en consola.*

---

## Paso 3 — Correr el webhook (1 minuto)

**Terminal 3 — el sistema de validación automática:**

```bash
cd agent
npm install
node webhook.js --scenario A
```

*(Si las credenciales de Bob están configuradas en `agent/.env`, la llamada real se hace aquí)*

**Lo que se ve en consola:**

```
╔══════════════════════════════════════════════════════════════════════╗
║   ZeroShot · Sprint 3 — Webhook + Bob 2.0 API Integration          ║
╚══════════════════════════════════════════════════════════════════════╝

[1/4] 📂 Reading live backend schema from disk...
  Old: {"id":1,"nombre":"Laptop","precioTotal":1500}
  New: {"id":1,"nombre":"Laptop","precio_total":1500}

[1/4] ✅ Diff extracted — 2 changed line(s):
  - "precioTotal": 1500,  // RENAMED
  + "precio_total": 1500, // NEW NAME

[2/4] 🤖 Sending changed code to IBM Bob 2.0 API...
  ✅ Bob 2.0 responded.

[3/4] 📝 Formatting final PR comment report...
```

---

## Paso 4 — Mostrar la alerta de Bob 2.0 salvando el día (1.5 minutos)

El reporte final se imprime en consola. Señalar las partes clave:

```markdown
## 🛑 ZeroShot · Sprint 3 — BREAKING CHANGES DETECTED

**Trigger:** `Scenario A: Field Rename (precioTotal → precio_total)`
**Analysis by:** ZeroShot Webhook (Sprint 3) + IBM Bob 2.0 API

### 📋 Contract Delta
```diff
- "precioTotal": 1500,  // RENAMED
+ "precio_total": 1500, // NEW NAME
```

### 🔍 Impact Analysis

| Severity   | Change                          | Consumer Impact                              | Detectable by              |
|------------|---------------------------------|----------------------------------------------|----------------------------|
| 🛑 CRITICAL | `precioTotal` renamed → `precio_total` | Web: `undefined` cell · Mobile: Gson assigns `0.0` | grep ✅ · runtime exc ❌ · schema diff ✅ |

### 🤖 IBM Bob 2.0 Analysis

[Análisis de Bob aquí — explica el impacto técnico en cada consumidor]
```

**Frases clave para señalar:**

1. **La tabla de impacto** → "Bob no solo detecta el cambio — explica exactamente cómo se rompe cada consumidor."

2. **La columna "Detectable by"** → "Esto es lo importante: grep lo encuentra en el Escenario A. Pero en el B y C, grep dice que todo está bien. Solo el análisis de esquema lo atrapa."

3. **"IBM Bob 2.0 Analysis"** → "Esta sección viene directamente de la API de Bob. Le enviamos el diff, él hace el análisis de impacto."

---

## Paso 5 — El remate: Scenario B (30 segundos)

```bash
node webhook.js --scenario B
```

**Frase clave:**
> "Escenario B: el nombre del campo NO cambió. Grep no ve nada raro. El test de Kotlin pasa porque Gson coerciona el string silenciosamente. Solo el análisis de tipo detecta que `precioTotal` pasó de `number` a `string`. Este es el escenario que justifica el sistema."

---

## Puntos de énfasis para los jueces

| Punto | Argumento |
|-------|-----------|
| **Velocidad** | El script corre en < 3 segundos. Sin Docker, sin CI/CD setup. |
| **Sin falsos positivos** | `--scenario clean` devuelve verde. No alarma innecesariamente. |
| **Multi-plataforma** | El mismo análisis cubre Web (JS) y Mobile (Kotlin) simultáneamente. |
| **Escenario B** | El único escenario que grep y los tests de runtime no pueden detectar. La razón de existir del sistema. |
| **IBM Bob 2.0** | El LLM no reemplaza la lógica determinista — la *amplifica* con análisis de impacto en lenguaje natural. |

---

## Checklist pre-demo

- [ ] `cd agent && npm install` corrido
- [ ] `agent/.env` tiene `BOB_API_KEY`, `BOB_PROJECT_ID` (o acepta el fallback offline)
- [ ] Backend parado (o corriendo en Terminal 1 para el efecto visual del Paso 1)
- [ ] `backend/src/producto.schema.js` en estado v1 (sin modificar)
- [ ] Terminals abiertas y listas
- [ ] Browser con `http://localhost:3001/api/producto` y `http://localhost:3000` en tabs

---

## Comandos de recuperación rápida

Si algo falla durante el demo:

```bash
# Restaurar el schema al estado v1
cd agent
node -e "
const fs = require('fs');
const schema = \`module.exports = { id: 1, nombre: 'Laptop', precioTotal: 1500 };\`;
fs.writeFileSync('../backend/src/producto.schema.js', schema);
console.log('Schema restored to v1');
"

# Ver el reporte sin necesidad de credenciales de Bob (fallback offline)
node webhook.js --scenario A    # Usa fallback automáticamente si BOB_API_KEY no está
node webhook.js --scenario B
node webhook.js --scenario C
```

---

*ZeroShot Contract Validation Swarm — IBM Bob 2.0 Hackathon · Sprint 3*
