package com.hackathon.mobile

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.hackathon.mobile.model.Producto
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * ProductoDeserializationTest
 *
 * Tres grupos de tests:
 *
 * GRUPO 1 — Contrato v1 congelado (JSON hardcodeado)
 *   Documenta el estado correcto del contrato v1. Estos tests SIEMPRE pasan
 *   mientras la data class y sus tipos no cambien. Sirven como especificacion
 *   historica del contrato.
 *
 * GRUPO 2 — Endpoint vivo (HTTP GET a localhost:3001)
 *   Lee la respuesta REAL del backend en cada ejecucion. Si el backend rompio
 *   el contrato, estos tests detectan el fallo de VALOR (campo incorrecto o nulo).
 *   REQUIERE el backend levantado: node backend/src/server.js
 *   Si el backend no responde, el test FALLA — no se saltea.
 *
 * GRUPO 3 — Tipos JSON (analisis de esquema del endpoint vivo)
 *   Parsea el JSON crudo como arbol y verifica el TIPO de cada campo,
 *   independientemente de su valor. Detecta el Escenario B (cambio de tipo)
 *   que el Grupo 2 NO detecta porque Gson coerciona String -> Double.
 *   Este es el hallazgo central del proyecto: hace falta analisis de esquema,
 *   no solo deserializacion.
 *
 * Run with:  .\gradlew test
 */
class ProductoDeserializationTest {

    private val gson = Gson()

    /** JSON congelado del contrato v1 — nunca cambia en este archivo. */
    private val contratoV1Json = """{"id":1,"nombre":"Laptop","precioTotal":1500}"""

    // -------------------------------------------------------------------------
    // GRUPO 1 — Contrato v1 congelado
    // -------------------------------------------------------------------------

    @Test
    fun `CONTRATO_V1 deserializa contrato v1 correctamente`() {
        val producto = gson.fromJson(contratoV1Json, Producto::class.java)

        assertNotNull(producto, "Gson no debe retornar null")
        assertEquals(1, producto.id, "id debe ser 1")
        assertEquals("Laptop", producto.nombre, "nombre debe ser 'Laptop'")
        assertEquals(1500.0, producto.precioTotal, "precioTotal debe ser 1500.0")
    }

    @Test
    fun `CONTRATO_V1 precioTotal se mapea desde el campo precioTotal del JSON`() {
        // @SerializedName("precioTotal") ata el campo JSON al campo Kotlin.
        // Si el backend renombra el campo, Gson devuelve 0.0 silenciosamente.
        val producto = gson.fromJson(contratoV1Json, Producto::class.java)

        assertEquals(
            1500.0,
            producto.precioTotal,
            "Si falla con 0.0: campo renombrado en JSON, @SerializedName no actualizado " +
            "(fallo silencioso — ver RUPTURA.md Escenario A)"
        )
    }

    @Test
    fun `CONTRATO_V1 todos los campos del contrato v1 estan presentes y tipados`() {
        val producto = gson.fromJson(contratoV1Json, Producto::class.java)

        assertEquals(1, producto.id)
        assertEquals("Laptop", producto.nombre)
        assertEquals(1500.0, producto.precioTotal)
    }

    // -------------------------------------------------------------------------
    // GRUPO 2 — Endpoint vivo: verificacion de VALOR
    // -------------------------------------------------------------------------

    /**
     * Hace HTTP GET al backend real. Si el backend no responde, el test FALLA
     * con un mensaje claro — no se saltea, porque un "skip" ocultaria la ruptura.
     */
    private fun fetchEndpointBody(): String {
        val client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build()
        val request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:3001/api/producto"))
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build()

        return try {
            val response = client.send(request, BodyHandlers.ofString())
            if (response.statusCode() != 200) {
                fail("Backend respondio con HTTP ${response.statusCode()} — se esperaba 200")
            }
            response.body()
        } catch (e: java.net.ConnectException) {
            fail(
                "Backend no disponible en localhost:3001. " +
                "Levanta el servidor antes de correr este test: node backend/src/server.js"
            )
        } catch (e: java.net.http.HttpTimeoutException) {
            fail("Timeout conectando a localhost:3001 — backend no disponible o bloqueado")
        }
    }

    @Test
    fun `ENDPOINT_VIVO deserializa respuesta real del backend`() {
        val cuerpo = fetchEndpointBody()
        val producto = gson.fromJson(cuerpo, Producto::class.java)

        assertNotNull(producto, "La respuesta del backend no debe deserializar a null")
        assertEquals(
            1, producto.id,
            "id esperado: 1. Recibido en JSON: $cuerpo"
        )
        assertEquals(
            "Laptop", producto.nombre,
            "nombre esperado: 'Laptop'. Recibido: '${producto.nombre}'. JSON: $cuerpo"
        )
        assertEquals(
            1500.0, producto.precioTotal,
            "precioTotal esperado: 1500.0. Recibido: ${producto.precioTotal}. " +
            "Si es 0.0: el campo fue renombrado (Esc. A). JSON: $cuerpo"
        )
    }

    // -------------------------------------------------------------------------
    // GRUPO 3 — Endpoint vivo: verificacion de TIPO JSON (analisis de esquema)
    //
    // Este grupo detecta el ESCENARIO B que el Grupo 2 no puede detectar.
    // Cuando el backend manda precioTotal:"1500" (String) en vez de 1500 (Number),
    // Gson coerciona el valor a 1500.0 y el test de valor PASA.
    // Pero isNumber() devuelve false y ESTE test FALLA.
    //
    // La coexistencia de "test de valor PASA + test de tipo FALLA" en el mismo
    // escenario es el hallazgo central del proyecto: demuestra que la
    // deserializacion exitosa NO garantiza el cumplimiento del contrato de tipos.
    // -------------------------------------------------------------------------

    @Test
    fun `TIPO_JSON los tipos de cada campo del contrato son los esperados`() {
        val cuerpo = fetchEndpointBody()
        val tree = JsonParser.parseString(cuerpo).asJsonObject

        // --- id: debe ser NUMBER ---
        val nodoId = tree.get("id")
            ?: fail("Campo 'id' AUSENTE en el JSON del endpoint. JSON: $cuerpo")
        assertTrue(
            nodoId.isJsonPrimitive && nodoId.asJsonPrimitive.isNumber,
            "TIPO INCORRECTO: 'id' debe ser NUMBER en el JSON. " +
            "Tipo encontrado: ${tipoLegible(nodoId)}. JSON: $cuerpo"
        )

        // --- nombre: debe ser STRING ---
        val nodoNombre = tree.get("nombre")
            ?: fail("Campo 'nombre' AUSENTE en el JSON del endpoint. JSON: $cuerpo")
        assertTrue(
            nodoNombre.isJsonPrimitive && nodoNombre.asJsonPrimitive.isString,
            "TIPO INCORRECTO: 'nombre' debe ser STRING en el JSON. " +
            "Tipo encontrado: ${tipoLegible(nodoNombre)}. JSON: $cuerpo"
        )

        // --- precioTotal: debe ser NUMBER ---
        // PUNTO CRITICO: si el backend manda "1500" (string), isNumber() == false.
        // Gson coerciona String->Double al deserializar, por eso el test de valor
        // pasa — pero el TIPO del JSON es incorrecto y este assert lo detecta.
        val nodoPrecio = tree.get("precioTotal")
            ?: fail("Campo 'precioTotal' AUSENTE en el JSON del endpoint. JSON: $cuerpo")
        assertTrue(
            nodoPrecio.isJsonPrimitive && nodoPrecio.asJsonPrimitive.isNumber,
            "TIPO INCORRECTO: 'precioTotal' debe ser NUMBER en el JSON. " +
            "Tipo encontrado: ${tipoLegible(nodoPrecio)}. " +
            "Nota: Gson coerciona String->Double silenciosamente — el test de valor " +
            "puede PASAR aunque el tipo sea String. Este es el Escenario B. JSON: $cuerpo"
        )
    }

    /** Devuelve una descripcion legible del tipo de un JsonElement para mensajes de error. */
    private fun tipoLegible(el: com.google.gson.JsonElement): String = when {
        el.isJsonNull -> "NULL"
        el.isJsonArray -> "ARRAY"
        el.isJsonObject -> "OBJECT"
        el.isJsonPrimitive -> {
            val p = el.asJsonPrimitive
            when {
                p.isNumber -> "NUMBER (${p.asString})"
                p.isString -> "STRING (\"${p.asString}\")"
                p.isBoolean -> "BOOLEAN (${p.asBoolean})"
                else -> "PRIMITIVE"
            }
        }
        else -> "UNKNOWN"
    }
}
