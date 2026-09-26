/** @type {import('next').NextConfig} */

/**
 * Fetch strategy: (a) rewrites — PREFERRED
 *
 * All requests from the Next.js app to /api/* are proxied to the backend at
 * http://localhost:3001. The app never issues an absolute cross-origin URL,
 * so there is no "Dynamic server usage" error during `next build` and no
 * CORS preflight issues in the browser.
 *
 * This is the cleanest solution: the frontend is decoupled from the backend
 * host/port, and the build succeeds without `force-dynamic` or client-side
 * useEffect workarounds.
 */
const nextConfig = {
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: "http://localhost:3001/api/:path*",
    },
  ],
};

module.exports = nextConfig;
