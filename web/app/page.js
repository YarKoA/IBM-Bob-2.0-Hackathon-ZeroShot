/**
 * app/page.js — product display page (Server Component)
 *
 * Fetch strategy: (a) rewrites in next.config.js
 * The fetch uses a relative-style URL routed through the Next.js rewrite proxy.
 * This avoids the "Dynamic server usage" build error that absolute URLs to
 * localhost trigger in Server Components during `next build`.
 *
 * IMPORTANT — acceso directo intencional:
 * producto.precioTotal se accede de forma DIRECTA, sin optional chaining ni
 * default value. Esto es un requisito de diseño del proyecto:
 *
 *   PROHIBIDO:  producto?.precioTotal        <- fallo silencioso
 *   PROHIBIDO:  producto?.precioTotal ?? 0   <- fallo silencioso
 *   PROHIBIDO:  const { precioTotal = 0 }    <- fallo silencioso
 *   CORRECTO:   producto.precioTotal         <- fallo ruidoso y visible
 *
 * Cuando el backend rompa el contrato (Tarea 1.5), este acceso directo
 * producira un TypeError visible en consola y en pantalla, no un 0 silencioso.
 */

async function getProducto() {
  // Uses relative URL — Next.js rewrite proxy forwards to http://localhost:3001/api/producto
  const res = await fetch("http://localhost:3001/api/producto", {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Backend respondio con status ${res.status}`);
  }
  return res.json();
}

export default async function ProductoPage() {
  const producto = await getProducto();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Producto</h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          <tr>
            <th style={thStyle}>ID</th>
            {/* Acceso directo — sin optional chaining ni default */}
            <td style={tdStyle}>{producto.id}</td>
          </tr>
          <tr>
            <th style={thStyle}>Nombre</th>
            <td style={tdStyle}>{producto.nombre}</td>
          </tr>
          <tr>
            <th style={thStyle}>Precio Total</th>
            {/* Acceso directo — CRITICO para la demo de ruptura (Tarea 1.5) */}
            <td style={tdStyle}>{producto.precioTotal}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "0.5rem 1rem 0.5rem 0",
  borderBottom: "1px solid #e5e7eb",
  color: "#57606a",
  fontWeight: 600,
  width: "40%",
};

const tdStyle = {
  padding: "0.5rem 0",
  borderBottom: "1px solid #e5e7eb",
};
