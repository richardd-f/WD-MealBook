// HARD phase — authenticated, image browsing + a full cart CRUD cycle.
//
// Per iteration each VU:
//   GET  /menu            (browse, image-heavy)         READ
//   POST /cart/add/{meal} (create a cart item)          CREATE
//   GET  /cart            (read cart, find item id)     READ
//   POST /cart/increment  (qty +1)                      UPDATE
//   POST /cart/decrement  (qty -1)                      UPDATE
//   DEL  /cart/remove     (delete the item)             DELETE  -> self-cleaning
//
// Login happens once per VU (module scope persists across a VU's iterations).

import http from "k6/http";
import { check, group } from "k6";
import {
  scenarioOptions,
  baseUrl,
  makeHandleSummary,
  extractToken,
} from "./lib/common.js";
import { login } from "./lib/session.js";

export const options = scenarioOptions();

const BASE = baseUrl();

let loggedIn = false;

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function writeParams(token) {
  return {
    headers: { "X-CSRF-TOKEN": token, "X-Requested-With": "XMLHttpRequest" },
    redirects: 0, // measure the write endpoint itself, not the redirect target
  };
}

export default function () {
  if (!loggedIn) {
    login();
    loggedIn = true;
  }

  let token = null;
  let mealId = null;

  group("browse menu", function () {
    const res = http.get(`${BASE}/menu`, { tags: { name: "GET /menu" } });
    check(res, { "menu 200": (r) => r.status === 200 });
    const html = res.body || "";
    token = extractToken(html);
    mealId =
      firstMatch(html, /\/cart\/add\/([A-Za-z0-9\-]+)/) ||
      firstMatch(html, /\/menu\/([A-Za-z0-9\-]+)/);
  });

  if (!mealId || !token) {
    // No meals seeded or no token — skip the write cycle but don't fail hard.
    check(null, { "menu had a meal + token": () => false });
    return;
  }

  group("cart CRUD", function () {
    // CREATE
    const add = http.post(
      `${BASE}/cart/add/${mealId}`,
      { _token: token },
      { ...writeParams(token), tags: { name: "POST /cart/add" } }
    );
    check(add, { "add ok": (r) => r.status === 302 || r.status === 200 });

    // READ — find the cart item id we just created.
    const cart = http.get(`${BASE}/cart`, { tags: { name: "GET /cart" } });
    check(cart, { "cart 200": (r) => r.status === 200 });
    const cartHtml = cart.body || "";
    token = extractToken(cartHtml) || token;
    const itemId = firstMatch(
      cartHtml,
      /\/cart\/(?:increment|decrement|remove)\/([A-Za-z0-9\-]+)/
    );
    if (!itemId) {
      check(null, { "found cart item id": () => false });
      return;
    }

    // UPDATE +
    const inc = http.post(
      `${BASE}/cart/increment/${itemId}`,
      { _token: token },
      { ...writeParams(token), tags: { name: "POST /cart/increment" } }
    );
    check(inc, { "increment ok": (r) => r.status === 302 || r.status === 200 });

    // UPDATE -
    const dec = http.post(
      `${BASE}/cart/decrement/${itemId}`,
      { _token: token },
      { ...writeParams(token), tags: { name: "POST /cart/decrement" } }
    );
    check(dec, { "decrement ok": (r) => r.status === 302 || r.status === 200 });

    // DELETE (cleanup so the run is repeatable)
    const del = http.del(
      `${BASE}/cart/remove/${itemId}`,
      JSON.stringify({ _token: token }),
      { ...writeParams(token), tags: { name: "DELETE /cart/remove" } }
    );
    check(del, { "remove ok": (r) => r.status === 302 || r.status === 200 });
  });
}

export const handleSummary = makeHandleSummary("hard");
