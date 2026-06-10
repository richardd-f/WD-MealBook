// Laravel Breeze login helper for the hard phase.
// k6 keeps a per-VU cookie jar automatically, so once we log in the session
// cookie rides along on every later request from the same VU.

import http from "k6/http";
import { check } from "k6";
import { baseUrl, extractToken } from "./common.js";

const EMAIL = __ENV.AUTH_EMAIL || "frichardo@student.ciputra.ac.id";
const PASSWORD = __ENV.AUTH_PASSWORD || "password";

// Logs the current VU in. Returns the CSRF token to reuse on write requests.
export function login() {
  const base = baseUrl();

  const page = http.get(`${base}/login`, { tags: { name: "GET /login" } });
  check(page, { "login page 200": (r) => r.status === 200 });

  const token = extractToken(page.body);
  if (!token) {
    throw new Error("could not find CSRF token on /login page");
  }

  const res = http.post(
    `${base}/login`,
    { _token: token, email: EMAIL, password: PASSWORD, remember: "on" },
    { tags: { name: "POST /login" }, redirects: 1 }
  );

  // A successful Breeze login redirects (302) away from /login.
  check(res, {
    "login succeeded": (r) =>
      (r.status === 200 || r.status === 302) &&
      !String(r.url).endsWith("/login"),
  });

  return token;
}
