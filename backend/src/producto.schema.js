/**
 * producto.schema.js
 *
 * Source of truth for the /api/producto contract (v1).
 * Sprint 2: the Bob Principal Agent reads THIS file to extract the expected
 * JSON shape and detect contract drift between backend and consumers.
 *
 * NEVER hardcode the product literal directly in a route handler.
 * Import this module wherever the product data is needed.
 *
 * Contract v1 fields:
 *   id          {number}  — unique product identifier
 *   nombre      {string}  — product display name
 *   precioTotal {number}  — total price (integer, no tax breakdown)
 */

/** @type {{ id: number, nombre: string, precioTotal: number }} */
const productoSchema = {
  id: 1,
  nombre: "Laptop",
  precioTotal: 1500,
};

module.exports = productoSchema;
