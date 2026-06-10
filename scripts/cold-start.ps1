# Measures cold start = time from a fresh container start to the first HTTP 200.
#
# Note: php-fpm is a long-running process, so this is a container-restart cold
# start (stop -> recreate -> first served request), not a serverless cold start.
#
# Usage (from repo root):
#   ./scripts/cold-start.ps1
#   ./scripts/cold-start.ps1 -Runs 10 -Url http://web/ -Network npm_default

param(
  [string]$Compose = "docker-compose.yml",
  [string]$Url = "http://web/",
  [string]$Network = "npm_default",
  [int]$Runs = 1,
  [int]$TimeoutSec = 120,
  [string]$Curl = "curlimages/curl:8.8.0"
)

$ErrorActionPreference = "Stop"
$results = @()

for ($i = 1; $i -le $Runs; $i++) {
  Write-Host "[$i/$Runs] stopping app + web..."
  docker compose -f $Compose stop app web | Out-Null

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  docker compose -f $Compose up -d --force-recreate app web | Out-Null

  $ready = $false
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    $code = docker run --rm --network $Network $Curl `
      -s -o /dev/null -w "%{http_code}" --max-time 3 $Url 2>$null
    if ($code -eq "200") { $ready = $true; break }
    Start-Sleep -Milliseconds 200
  }
  $sw.Stop()

  if ($ready) {
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 3)
    Write-Host "    cold start: $secs s"
    $results += $secs
  } else {
    Write-Warning "    timed out after $TimeoutSec s (no 200 from $Url)"
  }
}

if ($results.Count -gt 0) {
  $avg = [math]::Round(($results | Measure-Object -Average).Average, 3)
  Write-Host ""
  Write-Host "cold_start_seconds (avg of $($results.Count)): $avg"
}
