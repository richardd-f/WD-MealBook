// Shared k6 config + summary helpers for all MealBook phases.
//
// Two run modes, selected by env:
//
//   RPS mode (the real benchmark) — constant arrival rate, used to read
//   P95 TTFB and to find Max RPS under 500ms:
//     -e RPS=50 -e DURATION=30s
//
//   Iteration mode (quick functional smoke) — default when RPS is unset:
//     -e ITERATIONS=10 -e VUS=10
//
// A p(95)<500ms threshold is always attached so the run is marked
// PASS/FAIL on the 500ms ceiling.

export function scenarioOptions() {
  const RPS = Number(__ENV.RPS || 0);
  const DURATION = __ENV.DURATION || "30s";
  const VUS = Number(__ENV.VUS || 10);

  const thresholds = {
    // Max RPS metric is "highest RPS where p95 stays < 500ms".
    http_req_duration: [{ threshold: "p(95)<500", abortOnFail: false }],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
  };

  if (RPS > 0) {
    const preAlloc = Math.max(VUS, RPS);
    return {
      discardResponseBodies: false,
      thresholds,
      scenarios: {
        load: {
          executor: "constant-arrival-rate",
          rate: RPS,
          timeUnit: "1s",
          duration: DURATION,
          preAllocatedVUs: preAlloc,
          maxVUs: preAlloc * 4,
        },
      },
    };
  }

  const ITERATIONS = Number(__ENV.ITERATIONS || 10);
  return {
    discardResponseBodies: false,
    thresholds,
    scenarios: {
      load: {
        executor: "per-vu-iterations",
        vus: VUS,
        iterations: ITERATIONS,
        maxDuration: "10m",
      },
    },
  };
}

export function baseUrl() {
  return (__ENV.BASE_URL || "http://web").replace(/\/+$/, "");
}

// Returns a handleSummary() that prints a one-line digest and dumps the full
// k6 metrics JSON to /results/<phase>-summary.json. The run-phase script reads
// that JSON to append a CSV row, so we deliberately DON'T append here (a file
// returned from handleSummary is overwritten, not appended).
export function makeHandleSummary(phase) {
  return function (data) {
    const m = data.metrics;
    const get = (name, stat) =>
      m[name] && m[name].values[stat] != null ? m[name].values[stat] : null;

    const rps = get("http_reqs", "rate");
    const ttfb = get("http_req_waiting", "p(95)");
    const dur = get("http_req_duration", "p(95)");
    const failed = get("http_req_failed", "rate");
    const f = (v, d = 2) => (v == null ? "n/a" : v.toFixed(d));

    const line =
      `\n=== ${phase} | target RPS=${__ENV.RPS || "(iter)"} ===\n` +
      `  achieved RPS : ${f(rps)}\n` +
      `  P95 TTFB     : ${f(ttfb)} ms\n` +
      `  P95 duration : ${f(dur)} ms  (PASS<500)\n` +
      `  errors       : ${failed == null ? "n/a" : (failed * 100).toFixed(2) + " %"}\n`;

    const out = { stdout: line };
    out[`/results/${phase}-summary.json`] = JSON.stringify(data);
    return out;
  };
}

// Pull a CSRF token out of a Laravel HTML page: prefer the <meta name="csrf-token">,
// fall back to a hidden <input name="_token">.
export function extractToken(html) {
  let mm = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (mm) return mm[1];
  mm = html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i);
  if (mm) return mm[1];
  return null;
}

// Collect image URLs referenced by a page (src + srcset + url(...) in style).
export function extractImageUrls(html, base) {
  const urls = new Set();
  const push = (u) => {
    if (!u) return;
    if (/^data:/i.test(u)) return;
    if (/^https?:\/\//i.test(u)) urls.add(u);
    else if (u.startsWith("/")) urls.add(base + u);
  };
  let m;
  const reSrc = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = reSrc.exec(html))) push(m[1]);
  const reData = /<img[^>]+data-src=["']([^"']+)["']/gi;
  while ((m = reData.exec(html))) push(m[1]);
  const reCss = /url\((['"]?)([^)'"]+)\1\)/gi;
  while ((m = reCss.exec(html))) {
    if (/\.(png|jpe?g|webp|gif|svg)/i.test(m[2])) push(m[2]);
  }
  return Array.from(urls);
}
