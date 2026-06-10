# Runs one benchmark phase N times and records the per-run metrics + averages.
#
# For each run it captures:
#   - achieved RPS, P95 TTFB, P95 duration, error rate   (from k6's summary JSON)
#   - peak CPU (cores) and peak RAM (MB)                  (queried from Prometheus)
#
# Results are appended to monitoring/results/<phase>-runs.csv and averaged at the end.
#
# Prereq: the monitoring stack is up:
#   docker compose -f monitoring/docker-compose.monitoring.yml up -d cadvisor prometheus grafana
#
# Usage (from repo root):
#   ./scripts/run-phase.ps1 -Phase light  -Rps 100 -Runs 10
#   ./scripts/run-phase.ps1 -Phase medium -Rps 50  -Runs 10
#   ./scripts/run-phase.ps1 -Phase hard   -Rps 20  -Runs 10 -Duration 30s

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("light", "medium", "hard")]
  [string]$Phase,

  [int]$Runs = 10,
  [int]$Rps = 50,
  [string]$Duration = "30s",
  [string]$BaseUrl = "http://web",
  [string]$Compose = "monitoring/docker-compose.monitoring.yml",
  [string]$PromUrl = "http://localhost:9090",
  [string]$Containers = "mealbook_app|mealbook_web"
)

$ErrorActionPreference = "Stop"
$resultsDir = "monitoring/results"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$csv = Join-Path $resultsDir "$Phase-runs.csv"
if (-not (Test-Path $csv)) {
  "timestamp,phase,target_rps,achieved_rps,p95_ttfb_ms,p95_dur_ms,err_pct,peak_cpu_cores,peak_ram_mb" |
    Out-File -FilePath $csv -Encoding utf8
}

function Query-PromScalar([string]$q) {
  try {
    $r = Invoke-RestMethod -Uri "$PromUrl/api/v1/query" -Body @{ query = $q } -Method Get
    if ($r.status -eq "success" -and $r.data.result.Count -gt 0) {
      return [double]$r.data.result[0].value[1]
    }
  } catch { }
  return $null
}

$runs = @()
for ($i = 1; $i -le $Runs; $i++) {
  Write-Host "=== $Phase run $i/$Runs (RPS=$Rps, $Duration) ==="

  docker compose -f $Compose run --rm `
    -e BASE_URL=$BaseUrl -e RPS=$Rps -e DURATION=$Duration `
    k6 run "/scripts/$Phase.js"

  # k6 wrote the full summary here via handleSummary.
  $summaryPath = Join-Path $resultsDir "$Phase-summary.json"
  if (-not (Test-Path $summaryPath)) {
    Write-Warning "no summary JSON for run $i; skipping"
    continue
  }
  $j = Get-Content $summaryPath -Raw | ConvertFrom-Json
  $achRps = [math]::Round($j.metrics.http_reqs.values.rate, 2)
  $ttfb = [math]::Round($j.metrics.http_req_waiting.values.'p(95)', 2)
  $dur = [math]::Round($j.metrics.http_req_duration.values.'p(95)', 2)
  $errPct = [math]::Round($j.metrics.http_req_failed.values.rate * 100, 2)

  # Peak resource usage over the just-finished run window (subquery length = Duration).
  $cpuQ = "max_over_time(sum(rate(container_cpu_usage_seconds_total{name=~`"$Containers`"}[15s]))[$Duration`:5s])"
  $ramQ = "max_over_time(container_memory_usage_bytes{name=~`"$Containers`"}[$Duration])"
  $peakCpu = Query-PromScalar $cpuQ
  $peakRamBytes = Query-PromScalar $ramQ
  $peakCpu = if ($null -ne $peakCpu) { [math]::Round($peakCpu, 3) } else { "n/a" }
  $peakRam = if ($null -ne $peakRamBytes) { [math]::Round($peakRamBytes / 1MB, 1) } else { "n/a" }

  $ts = (Get-Date).ToString("s")
  "$ts,$Phase,$Rps,$achRps,$ttfb,$dur,$errPct,$peakCpu,$peakRam" |
    Out-File -FilePath $csv -Append -Encoding utf8

  Write-Host ("    RPS={0}  TTFB_p95={1}ms  dur_p95={2}ms  err={3}%  CPU={4}  RAM={5}MB" `
      -f $achRps, $ttfb, $dur, $errPct, $peakCpu, $peakRam)

  $runs += [pscustomobject]@{ rps = $achRps; ttfb = $ttfb; dur = $dur; err = $errPct }
}

if ($runs.Count -gt 0) {
  Write-Host ""
  Write-Host "===== AVERAGE over $($runs.Count) runs ($Phase, target RPS=$Rps) ====="
  Write-Host ("  achieved RPS : {0}" -f [math]::Round(($runs.rps | Measure-Object -Average).Average, 2))
  Write-Host ("  P95 TTFB     : {0} ms" -f [math]::Round(($runs.ttfb | Measure-Object -Average).Average, 2))
  Write-Host ("  P95 duration : {0} ms" -f [math]::Round(($runs.dur | Measure-Object -Average).Average, 2))
  Write-Host ("  error rate   : {0} %" -f [math]::Round(($runs.err | Measure-Object -Average).Average, 2))
  Write-Host ""
  Write-Host "Per-run rows: $csv"
  Write-Host "Note: if P95 duration > 500ms, you're above Max-RPS-under-500ms; lower -Rps and retry."
}
