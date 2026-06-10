// LIGHT phase — static landing page only.
// Measures baseline P95 TTFB / Max RPS for a page with no auth and no DB writes.

import http from "k6/http";
import { check } from "k6";
import { scenarioOptions, baseUrl, makeHandleSummary } from "./lib/common.js";

export const options = scenarioOptions();

const BASE = baseUrl();

export default function () {
  const res = http.get(`${BASE}/`, { tags: { name: "GET /" } });
  check(res, { "home 200": (r) => r.status === 200 });
}

export const handleSummary = makeHandleSummary("light");
