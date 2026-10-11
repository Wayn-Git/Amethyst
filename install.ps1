# Amethyst Desktop Installer for Windows PowerShell
$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   Amethyst Windows Desktop Installer    " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$Repo = "wayn-wayn/amethyst"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

Write-Host "==> Checking latest release..." -ForegroundColor Yellow
$DownloadUrl = $null
try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -Method Get -TimeoutSec 10
    $Asset = $Release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
    if ($Asset) {
        $DownloadUrl = $Asset.browser_download_url
    }
} catch {
    Write-Host "==> Could not fetch GitHub API, falling back to direct download URL..." -ForegroundColor Gray
}

if (-not $DownloadUrl) {
    $DownloadUrl = "https://github.com/$Repo/releases/latest/download/Amethyst-Setup-0.1.0.exe"
}

$TempExe = Join-Path $env:TEMP "Amethyst-Setup.exe"
Write-Host "==> Downloading Amethyst installer from $DownloadUrl ..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempExe -UseBasicParsing

Write-Host "==> Starting Amethyst Setup..." -ForegroundColor Green
Start-Process -FilePath $TempExe -Wait

Write-Host "==> Amethyst installed successfully!" -ForegroundColor Green
