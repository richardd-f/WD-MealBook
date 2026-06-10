// MEDIUM phase — image-heavy browsing.
// Loads the public menu page, then fetches every image it references (like a
// browser pulling sub-resources). Exercises static/image delivery under load.

import http from "k6/http";
import { check, group } from "k6";
import {
  scenarioOptions,
  baseUrl,
  makeHandleSummary,
  extractImageUrls,
} from "./lib/common.js";

// Medium phase does parallel batch requests per iteration (safe to allow more VUs).
export const options = scenarioOptions({ maxVUs: 30 });

const BASE = baseUrl();
// Cap images fetched per iteration so one fat page can't dominate the run.
const MAX_IMAGES = Number(__ENV.MAX_IMAGES || 12);

export default function () {
  let html = "";
  group("menu page", function () {
    const res = http.get(`${BASE}/menu`, { tags: { name: "GET /menu" } });
    check(res, { "menu 200": (r) => r.status === 200 });
    html = res.body || "";
  });

  group("images", function () {
    const imgs = extractImageUrls(html, BASE).slice(0, MAX_IMAGES);
    if (imgs.length === 0) return;
    // batch() fetches them concurrently, the way a browser would.
    const reqs = imgs.map((u) => ["GET", u, null, { tags: { name: "image" } }]);
    const responses = http.batch(reqs);
    responses.forEach((r) =>
      check(r, { "image ok": (x) => x.status === 200 || x.status === 304 })
    );
  });
}

export const handleSummary = makeHandleSummary("medium");
