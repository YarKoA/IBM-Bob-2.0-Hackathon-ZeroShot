package com.hackathon.mobile.model

import com.google.gson.annotations.SerializedName

/**
 * Producto — data class that mirrors the backend contract v1.
 *
 * The @SerializedName annotation is the critical piece:
 * it binds the JSON field name "precioTotal" to this Kotlin property.
 *
 * If the backend renames the field (e.g. precioTotal -> precio_total) and
 * this annotation is NOT updated, Gson silently sets precioTotal to 0.0
 * (the Double default), with no exception — a silent failure.
 *
 * If the backend changes the type (e.g. Number -> String) and this property
 * stays as Double, Gson throws JsonSyntaxException — a loud, visible failure.
 *
 * Both failure modes are documented in docs/RUPTURA.md (Tarea 1.5).
 */
data class Producto(
    val id: Int,
    val nombre: String,
    @SerializedName("precioTotal") val precioTotal: Double
)
