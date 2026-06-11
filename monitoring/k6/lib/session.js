import http from "k6/http";
import { check } from "k6";
import { baseUrl } from "./common.js";

const EMAIL = __ENV.AUTH_EMAIL || "frichardo@student.ciputra.ac.id";
const PASSWORD = __ENV.AUTH_PASSWORD || "password";

// Read the current XSRF-TOKEN cookie from k6's cookie jar for a given base URL.
// Laravel accepts this as X-XSRF-TOKEN header for CSRF verification on any request.
// This avoids fragile HTML parsing of the _token hidden input.
export function xsrfToken(base) {
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(base + "/");
  const vals = cookies["XSRF-TOKEN"];
  if (!vals || vals.length === 0) return null;
  try { return decodeURIComponent(vals[0]); } catch (_) { return vals[0]; }
}

export function login() {
  const base = baseUrl();

  // GET /login to establish a session and receive the XSRF-TOKEN cookie.
  const page = http.get(`${base}/login`, { tags: { name: "GET /login" } });
  check(page, { "login page 200": (r) => r.status === 200 });

  const token = xsrfToken(base);
  if (!token) {
    throw new Error("XSRF-TOKEN cookie not found after GET /login");
  }

  // POST credentials using X-XSRF-TOKEN header (Laravel SPA CSRF mechanism).
  // redirects: 5 handles HTTP->HTTPS + success/failure redirect chain.
  const res = http.post(
    `${base}/login`,
    { email: EMAIL, password: PASSWORD, remember: "on" },
    {
      tags: { name: "POST /login" },
      redirects: 5,
      headers: { "X-XSRF-TOKEN": token },
    }
  );

  check(res, {
    "login succeeded": (r) =>
      r.status === 200 && !String(r.url).endsWith("/login"),
  });
}
