/**
 * app/layout.js — root layout (required by Next.js App Router)
 */
export const metadata = {
  title: "Hackathon IBM Bob 2.0 — Producto",
  description: "Sprint 1 — contract consumer demo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
