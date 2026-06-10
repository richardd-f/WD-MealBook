# Reports deployment size = size of the built Docker image(s) shipped for MealBook.
#
# Usage (from repo root):
#   ./scripts/image-size.ps1

param(
  [string]$Compose = "docker-compose.yml",
  [string[]]$Services = @("app", "web")
)

$ErrorActionPreference = "Stop"
$totalBytes = 0

Write-Host "Deployment image sizes:"
foreach ($svc in $Services) {
  $id = (docker compose -f $Compose images -q $svc 2>$null | Select-Object -First 1)
  if (-not $id) {
    Write-Warning "  $svc : no image (build it first: docker compose -f $Compose build)"
    continue
  }
  $bytes = [int64](docker image inspect $id --format '{{.Size}}')
  $mb = [math]::Round($bytes / 1MB, 1)
  $totalBytes += $bytes
  "{0,-6} {1,8} MB  ({2})" -f $svc, $mb, $id.Substring(0, [math]::Min(19, $id.Length)) | Write-Host
}

$totalMb = [math]::Round($totalBytes / 1MB, 1)
Write-Host ""
Write-Host "deployment_size_mb (total): $totalMb"
