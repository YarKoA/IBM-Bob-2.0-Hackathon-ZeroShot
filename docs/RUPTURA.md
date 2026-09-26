# RUPTURA.md — Prueba de Ruptura de Contrato de API

**Proyecto:** Hackathon IBM Bob 2.0 — El Ecosistema Vulnerable  
**Sprint:** 1 — Tarea 1.5  
**Fecha:** 2026-09-26  
**Stack:** Backend Node.js/Express · Web Next.js · Mobile Kotlin/JVM + Gson  
**Versión:** 2 — suite actualizada con tests de endpoint vivo y verificación de tipos JSON  

---

## Contrato v1 (baseline — estado verde)

```json
GET http://localhost:3001/api/producto
{"id":1,"nombre":"Laptop","precioTotal":1500}
```

- `id`: `number` (entero)
- `nombre`: `string`
- `precioTotal`: `number` (entero)

Todos los escenarios parten de este estado. Todos revierten a este estado al terminar.

---

## Suite de tests — 5 tests en 3 grupos

```
GRUPO 1 — CONTRATO_V1 (JSON hardcodeado, especificación histórica)
  CONTRATO_V1 deserializa contrato v1 correctamente
  CONTRATO_V1 precioTotal se mapea desde el campo precioTotal del JSON
  CONTRATO_V1 todos los campos del contrato v1 estan presentes y tipados

GRUPO 2 — ENDPOINT_VIVO (HTTP GET real a localhost:3001)
  ENDPOINT_VIVO deserializa respuesta real del backend

GRUPO 3 — TIPO_JSON (verifica el TIPO de cada campo en el JSON crudo)
  TIPO_JSON los tipos de cada campo del contrato son los esperados
```

**Ejecutar:** `.\gradlew.bat test` (requiere `node backend/src/server.js` levantado para Grupos 2 y 3)

---

## Tabla de resultados por escenario

Esta tabla es el argumento central del proyecto.

| Test | Contrato v1 (verde) | Esc. A: renombrado | Esc. B: cambio de tipo | Esc. C: campo eliminado |
|---|:---:|:---:|:---:|:---:|
| CONTRATO_V1 (×3) | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS |
| ENDPOINT_VIVO (valor) | ✅ PASS | ❌ **FAIL** | ✅ PASS | ❌ **FAIL** |
| TIPO_JSON (esquema) | ✅ PASS | ❌ **FAIL** | ❌ **FAIL** | ❌ **FAIL** |
| **`gradlew test` exit code** | **0** | **1** | **1** | **1** |
| Detectable por grep | — | ✅ sí | ❌ **NO** | ❌ **NO** |
| Produce excepción en runtime | — | ❌ NO | ❌ NO | ❌ NO |

**El Escenario B es la fila decisiva:** ENDPOINT_VIVO PASA pero TIPO_JSON FALLA.
Esto demuestra que la deserialización exitosa no garantiza el cumplimiento del contrato de tipos.
Un grep tampoco lo detecta. Solo el análisis de esquema lo encuentra.

---

## Escenario A: Cambio de nombre de campo

**Tipo de ruptura:** Renombrado de campo (`precioTotal` → `precio_total`)  
**Detectado por grep:** SÍ  
**Excepción en runtime:** NO — fallo silencioso en mobile  

### Cambio aplicado (solo en `backend/src/producto.schema.js`)

```diff
-  precioTotal: 1500,
+  precio_total: 1500,
```

### Respuesta real del endpoint

```
curl http://localhost:3001/api/producto
{"id":1,"nombre":"Laptop","precio_total":1500}
```

### Comportamiento de `web/`

`producto.precioTotal` es `undefined` (el campo no existe en el objeto). React renderiza `undefined` como string vacío.

**Pantalla:** celda "Precio Total" vacía  
**Consola:** Sin `TypeError` en React JSX (undefined → string vacío silencioso). En Server Component, puede producir error HTTP 500 si se intenta operar con el valor.

### Comportamiento de `mobile/` — mensajes de error reales

**ENDPOINT_VIVO FALLA:**
```
AssertionFailedError: precioTotal esperado: 1500.0. Recibido: 0.0.
Si es 0.0: el campo fue renombrado (Esc. A).
JSON: {"id":1,"nombre":"Laptop","precio_total":1500}
==> expected: <1500.0> but was: <0.0>
```

**TIPO_JSON FALLA:**
```
AssertionFailedError: Campo 'precioTotal' AUSENTE en el JSON del endpoint.
JSON: {"id":1,"nombre":"Laptop","precio_total":1500}
```

**¿Hay excepción en Gson?** NO — Gson asigna `0.0` (valor default de `Double`) cuando `@SerializedName("precioTotal")` no encuentra el campo. El objeto se construye sin error.

**`gradlew test` exit code:** `1` (BUILD FAILED — 2 failures)

### Cómo reproducirlo

```bash
# 1. Aplicar el cambio en backend/src/producto.schema.js:
#    precioTotal: 1500  →  precio_total: 1500

# 2. Levantar el backend
cd backend && node src/server.js

# 3. Verificar el JSON roto
curl http://localhost:3001/api/producto
# Output: {"id":1,"nombre":"Laptop","precio_total":1500}

# 4. Ejecutar tests mobile (backend debe seguir corriendo)
cd mobile && .\gradlew.bat test --rerun-tasks
# Resultado: BUILD FAILED — exit code 1
# CONTRATO_V1: 3 PASS (usan JSON hardcodeado, no saben del cambio)
# ENDPOINT_VIVO: FAIL — precioTotal=0.0, expected 1500.0
# TIPO_JSON: FAIL — campo 'precioTotal' AUSENTE

# 5. Revertir
#    precio_total: 1500  →  precioTotal: 1500
```

### Lo que un grep NO detectaría

Un `grep -r "precioTotal"` encuentra el cambio porque el nombre cambia de `precioTotal` a `precio_total`. **Este escenario SÍ es detectable por grep.** Lo incluimos como control para demostrar que la suite funciona, no como el logro del proyecto.

---

## Escenario B: Cambio de tipo (el escenario que justifica el proyecto)

**Tipo de ruptura:** Cambio de tipo sin cambio de nombre (`precioTotal: Number` → `precioTotal: String`)  
**Detectado por grep:** ❌ NO — ningún `grep` encuentra nada  
**Excepción en runtime:** ❌ NO en ningún consumidor  
**Detectado por deserialización:** ❌ NO — Gson coerciona String→Double silenciosamente  
**Detectado por análisis de tipo JSON:** ✅ SÍ — `TIPO_JSON` FALLA  

### Cambio aplicado (solo en `backend/src/producto.schema.js`)

```diff
-  precioTotal: 1500,
+  precioTotal: "1500",
```

El nombre del campo no cambió. Solo el tipo: de `number` JSON a `string` JSON.

### Respuesta real del endpoint

```
curl http://localhost:3001/api/producto
{"id":1,"nombre":"Laptop","precioTotal":"1500"}
```

Visualmente casi idéntico. La diferencia son las comillas en `"1500"`.

### Comportamiento de `web/`

`producto.precioTotal` recibe el string `"1500"`. React lo renderiza igual que el número `1500`.

**Pantalla:** "1500" — idéntica a la versión correcta  
**Consola:** SIN EXCEPCION — cero entradas en la consola del navegador o del servidor  
**Fallo diferido:** Si el código usara `precioTotal * 1.21` (cálculo de IVA), el resultado sería `NaN` — visible solo al ejecutar esa operación específica.

### Comportamiento de `mobile/` — mensajes de error reales

**ENDPOINT_VIVO PASA** ← este es el hallazgo central:
```
tests=5 skipped=0 failures=0  ← antes de que TIPO_JSON detecte el fallo
```
Gson coerciona `"1500"` (String JSON) a `1500.0` (Double Kotlin) sin error.
El valor deserializado es correcto. El test de valor no puede distinguir el tipo del JSON de origen.

**TIPO_JSON FALLA:**
```
AssertionFailedError: TIPO INCORRECTO: 'precioTotal' debe ser NUMBER en el JSON.
Tipo encontrado: STRING ("1500").
Nota: Gson coerciona String->Double silenciosamente — el test de valor
puede PASAR aunque el tipo sea String. Este es el Escenario B.
JSON: {"id":1,"nombre":"Laptop","precioTotal":"1500"}
```

**¿Hay excepción en Gson?** NO — Gson 2.11.0 convierte `"1500"` → `1500.0` automáticamente.

**`gradlew test` exit code:** `1` (BUILD FAILED — 1 failure: solo TIPO_JSON)

### Por qué ENDPOINT_VIVO pasa y TIPO_JSON falla en el mismo escenario

Esta es la demostración clave del proyecto. Gson hace una conversión de tipo implícita:

```
JSON recibido:           {"precioTotal":"1500"}   ← String
Tipo en data class:      val precioTotal: Double  ← Number
Gson convierte:          "1500" → 1500.0          ← coerción silenciosa
Valor deserializado:     1500.0                   ← correcto numéricamente
isNumber() en JsonTree:  false                    ← el tipo del JSON era String
```

El test de valor (`assertEquals(1500.0, producto.precioTotal)`) compara el valor ya convertido — pasa.  
El test de tipo (`isNumber()`) inspecciona el JSON crudo antes de la conversión — falla.

**Sin análisis de tipo del JSON crudo, este escenario es invisible para toda la suite.**

### Cómo reproducirlo

```bash
# 1. Aplicar el cambio en backend/src/producto.schema.js:
#    precioTotal: 1500  →  precioTotal: "1500"

# 2. Levantar el backend
cd backend && node src/server.js

# 3. Verificar el JSON roto
curl http://localhost:3001/api/producto
# Output: {"id":1,"nombre":"Laptop","precioTotal":"1500"}  ← comillas en el valor

# 4. Ejecutar tests mobile
cd mobile && .\gradlew.bat test --rerun-tasks
# Resultado: BUILD FAILED — exit code 1
# CONTRATO_V1: 3 PASS
# ENDPOINT_VIVO: PASS  ← Gson coerciona, el valor numérico es correcto
# TIPO_JSON: FAIL  ← STRING("1500") encontrado, se esperaba NUMBER

# 5. Revertir
#    precioTotal: "1500"  →  precioTotal: 1500
```

### Lo que un grep NO detectaría

```bash
grep -r "precioTotal" backend/    # encuentra el campo — nombre sin cambios
grep -r "precioTotal" mobile/     # encuentra @SerializedName — nombre sin cambios
grep -r "precioTotal" web/        # encuentra el acceso directo — nombre sin cambios
```

Ningún grep encuentra nada anormal. El nombre del campo no cambió. Para detectar este caso se necesita comparar el **tipo** del campo en el JSON del endpoint contra el tipo declarado en el contrato. Esto requiere análisis de esquema, no búsqueda de texto.

---

## Escenario C: Fallo silencioso — campo eliminado

**Tipo de ruptura:** Eliminación de campo (`nombre` eliminado)  
**Detectado por grep:** ❌ NO — grep no detecta ausencias  
**Excepción en runtime:** ❌ NO en ningún consumidor  
**Severidad:** MÁXIMA — el sistema "funciona", nadie lo sabe  

### Cambio aplicado (solo en `backend/src/producto.schema.js`)

```diff
 const productoSchema = {
   id: 1,
-  nombre: "Laptop",
   precioTotal: 1500,
 };
```

### Respuesta real del endpoint

```
curl http://localhost:3001/api/producto
{"id":1,"precioTotal":1500}
```

### Comportamiento de `web/`

`producto.nombre` es `undefined`. React renderiza `undefined` como string vacío en JSX.

**Pantalla:** celda "Nombre" vacía, resto de campos normales, HTTP 200  
**Consola del navegador:** SIN EXCEPCION  
**Consola del servidor:** SIN EXCEPCION  
**Sistema de monitoreo de errores (Sentry/Datadog):** SIN ALERTA — no hay excepción que interceptar

### Comportamiento de `mobile/` — mensajes de error reales

**ENDPOINT_VIVO FALLA:**
```
AssertionFailedError: nombre esperado: 'Laptop'. Recibido: 'null'.
JSON: {"id":1,"precioTotal":1500}
==> expected: <Laptop> but was: <null>
```

**TIPO_JSON FALLA:**
```
AssertionFailedError: Campo 'nombre' AUSENTE en el JSON del endpoint.
JSON: {"id":1,"precioTotal":1500}
```

**¿Hay excepción en Gson?** NO — cuando `nombre` no está en el JSON, Gson asigna `null` al campo `String` (bypasea el non-nullable de Kotlin via reflection). El objeto `Producto` se construye sin error.

**`gradlew test` exit code:** `1` (BUILD FAILED — 2 failures)

### Cómo reproducirlo

```bash
# 1. Aplicar el cambio en backend/src/producto.schema.js:
#    eliminar la línea:  nombre: "Laptop",

# 2. Levantar el backend
cd backend && node src/server.js

# 3. Verificar el JSON roto
curl http://localhost:3001/api/producto
# Output: {"id":1,"precioTotal":1500}

# 4. Ver la web — NO hay error en consola, nombre aparece vacío
cd web && npm run dev
# HTTP 200, consola limpia, celda "Nombre" vacía

# 5. Ejecutar tests mobile
cd mobile && .\gradlew.bat test --rerun-tasks
# Resultado: BUILD FAILED — exit code 1
# CONTRATO_V1: 3 PASS
# ENDPOINT_VIVO: FAIL — nombre='null', expected 'Laptop'
# TIPO_JSON: FAIL — campo 'nombre' AUSENTE en el JSON

# 6. Revertir
#    agregar de vuelta:  nombre: "Laptop",
```

### Lo que un grep NO detectaría

Grep busca strings presentes. No puede detectar la **ausencia** de un campo. Para saber que `nombre` fue eliminado del contrato del backend hay que comparar el esquema actual del endpoint contra el esquema esperado por los consumidores.

---

## Por qué el Escenario C es el peor

Los Escenarios A y B producen señales que la suite detecta:

- **Escenario A:** ENDPOINT_VIVO falla porque `precioTotal = 0.0`. El número incorrecto es detectable.
- **Escenario B:** TIPO_JSON falla porque `isNumber() = false`. El tipo incorrecto es detectable con análisis de esquema.

**El Escenario C no produce ninguna señal observable en producción:**

1. **HTTP 200** — el servidor responde exitosamente.
2. **SIN excepción** — ni JavaScript, ni la JVM de Kotlin, ni Gson lanzan nada.
3. **SIN alerta en Sentry/Datadog/etc.** — las herramientas de monitoreo de errores interceptan excepciones. Si no hay excepción, no hay evento. Un campo `null` en un objeto válido no es una excepción.
4. **SIN fallo en CI** — sin los tests de Grupo 2 y 3, `gradlew test` devuelve exit code 0. `npm run build` compila.
5. **El único indicador:** un campo vacío en la UI que un usuario ve y puede (o no) reportar.

**El costo real:** Si el campo eliminado fuera `precioTotal` en vez de `nombre`, el sistema mostraría `0.0` como precio de todos los productos. Los usuarios comprarían a precio cero. No habría `TypeError`. No habría `JsonSyntaxException`. El sistema "funcionaría perfectamente". El descubrimiento llegaría por reporte de cliente o auditoría de ingresos — no por alerta técnica.

**Por qué ninguna herramienta basada en crash lo atrapa:** La diferencia entre `nombre = "Laptop"` (correcto) y `nombre = null` (roto) solo es visible si se compara contra el **contrato esperado**, no contra el comportamiento del sistema. El runtime no sabe qué valor era el "correcto" — solo sabe que recibió `null`.

**Este es exactamente el problema que Sprint 2 resuelve:** el Agente Principal de Bob compara el esquema actual de `backend/src/producto.schema.js` contra los tipos declarados en `mobile/src/main/kotlin/.../model/Producto.kt` y las referencias en `web/app/page.js`, produciendo un reporte de drift *antes* de que el cambio llegue a producción — sin depender de que algo explote.

---

## Estado final — verde confirmado

Contrato v1 restaurado. Todos los consumidores en verde.

```bash
# Backend
curl http://localhost:3001/api/producto
# {"id":1,"nombre":"Laptop","precioTotal":1500}

# Mobile — 5 tests, 0 failures, exit code 0
cd mobile && .\gradlew.bat test
# BUILD SUCCESSFUL
# tests=5 skipped=0 failures=0 errors=0
#   ✅ CONTRATO_V1 deserializa contrato v1 correctamente
#   ✅ CONTRATO_V1 precioTotal se mapea desde el campo precioTotal del JSON
#   ✅ CONTRATO_V1 todos los campos del contrato v1 estan presentes y tipados
#   ✅ ENDPOINT_VIVO deserializa respuesta real del backend
#   ✅ TIPO_JSON los tipos de cada campo del contrato son los esperados

# Web
cd web && npm run build
# ✓ Compiled successfully
```

**La suite de 5 tests ahora DETECTA la ruptura de contrato en los 3 escenarios.**  
Con contrato v1 intacto: exit code 0.  
Con cualquier ruptura: exit code 1.
