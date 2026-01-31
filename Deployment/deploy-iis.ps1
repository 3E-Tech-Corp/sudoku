param(
    [Parameter(Mandatory=$true)]
    [string]$SiteName,

    [Parameter(Mandatory=$true)]
    [string]$BackendSource,

    [Parameter(Mandatory=$true)]
    [string]$FrontendSource
)

$ErrorActionPreference = "Stop"

$basePath = "F:\New_WWW\$SiteName"
$frontendPath = "$basePath\WWW"
$backendPath = "$basePath\API"
$backupBase = "F:\deploy-backups\$SiteName"
$appPoolName = $SiteName

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying $SiteName" -ForegroundColor Cyan
Write-Host "Frontend: $frontendPath" -ForegroundColor Gray
Write-Host "Backend:  $backendPath" -ForegroundColor Gray
Write-Host "App Pool: $appPoolName" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

# Import IIS module
Import-Module WebAdministration -ErrorAction Stop

# Stop App Pool
Write-Host "`n>> Stopping App Pool: $appPoolName" -ForegroundColor Yellow
try {
    if ((Get-WebAppPoolState -Name $appPoolName).Value -eq "Started") {
        Stop-WebAppPool -Name $appPoolName
        Write-Host "   App pool stopped" -ForegroundColor Green
    } else {
        Write-Host "   App pool already stopped" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Warning: Could not stop app pool - $_" -ForegroundColor Yellow
}

# Wait for pool to fully stop
Start-Sleep -Seconds 3

# Backup current deployment
Write-Host "`n>> Creating backup..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $backupBase $timestamp

if (!(Test-Path $backupBase)) {
    New-Item -ItemType Directory -Path $backupBase -Force | Out-Null
}

if ((Test-Path $backendPath) -and (Get-ChildItem $backendPath -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    $backupApi = Join-Path $backupDir "API"
    New-Item -ItemType Directory -Path $backupApi -Force | Out-Null
    Copy-Item -Path "$backendPath\*" -Destination $backupApi -Recurse -Force
    Write-Host "   Backend backed up to: $backupApi" -ForegroundColor Green
}

if ((Test-Path $frontendPath) -and (Get-ChildItem $frontendPath -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    $backupWww = Join-Path $backupDir "WWW"
    New-Item -ItemType Directory -Path $backupWww -Force | Out-Null
    Copy-Item -Path "$frontendPath\*" -Destination $backupWww -Recurse -Force
    Write-Host "   Frontend backed up to: $backupWww" -ForegroundColor Green
}

# Clean old backups (keep last 5)
$allBackups = Get-ChildItem $backupBase -Directory | Sort-Object Name -Descending | Select-Object -Skip 5
foreach ($old in $allBackups) {
    Remove-Item $old.FullName -Recurse -Force
    Write-Host "   Cleaned old backup: $($old.Name)" -ForegroundColor Gray
}

# Deploy Frontend
Write-Host "`n>> Deploying Frontend" -ForegroundColor Yellow
if (!(Test-Path $frontendPath)) {
    New-Item -ItemType Directory -Path $frontendPath -Force | Out-Null
}
Copy-Item -Path "$FrontendSource\*" -Destination $frontendPath -Recurse -Force
Write-Host "   Frontend deployed" -ForegroundColor Green

# Deploy Backend (preserve appsettings.Production.json)
Write-Host "`n>> Deploying Backend" -ForegroundColor Yellow
if (!(Test-Path $backendPath)) {
    New-Item -ItemType Directory -Path $backendPath -Force | Out-Null
}

# Preserve production config files
$preserveFiles = @("appsettings.Production.json")
$tempDir = Join-Path $env:TEMP "deploy-preserve-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

foreach ($file in $preserveFiles) {
    $src = Join-Path $backendPath $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $tempDir $file)
        Write-Host "   Preserved: $file" -ForegroundColor Gray
    }
}

Copy-Item -Path "$BackendSource\*" -Destination $backendPath -Recurse -Force

foreach ($file in $preserveFiles) {
    $src = Join-Path $tempDir $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $backendPath $file) -Force
        Write-Host "   Restored: $file" -ForegroundColor Gray
    }
}

Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "   Backend deployed" -ForegroundColor Green

# Start App Pool
Write-Host "`n>> Starting App Pool: $appPoolName" -ForegroundColor Yellow
try {
    Start-WebAppPool -Name $appPoolName
    Write-Host "   App pool started" -ForegroundColor Green
} catch {
    Write-Host "   Error starting app pool: $_" -ForegroundColor Red
    throw
}

# Health check (use Host header since site uses host header bindings)
Write-Host "`n>> Running health check..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
try {
    $response = Invoke-WebRequest -Uri "http://localhost/api/health" `
        -Headers @{ Host = $SiteName } `
        -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -eq 200) {
        Write-Host "   Health check passed!" -ForegroundColor Green
        Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
    } else {
        Write-Host "   Health check returned: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   Health check failed (non-critical): $_" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
