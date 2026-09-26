/**
 * server.js — entry point
 *
 * Start with:  node src/server.js
 */

const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes/producto");

const PORT = 3001;
const app = express();

// Enable CORS for all origins so the Next.js frontend (port 3000) can consume this API
app.use(cors());

app.use(express.json());

// Mount all API routes under /api
app.use("/api", apiRoutes);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`  GET http://localhost:${PORT}/api/producto`);
  console.log(`  GET http://localhost:${PORT}/api/health`);
});
