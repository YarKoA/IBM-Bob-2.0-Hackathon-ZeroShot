/**
 * routes/producto.js
 *
 * Route handlers for product-related endpoints.
 * The product data is imported from producto.schema.js — never defined here.
 */

const express = require("express");
const productoSchema = require("../producto.schema");

const router = express.Router();

// GET /api/producto — returns the v1 product contract
router.get("/producto", (req, res) => {
  res.json(productoSchema);
});

// GET /api/health — liveness probe
router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

module.exports = router;
