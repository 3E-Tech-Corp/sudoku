<#
.SYNOPSIS
    Provisions a new IIS site, app pool, SQL Server database, and configuration.
    Called by the provision.yml GitHub Actions workflow.

.DESCRIPTION
    Idempotent - safe to re-run. Checks if resources exist before creating them.

.PARAMETER SiteName
    IIS site name (same as domain, e.g., myapp.3eweb.com)

.PARAMETER Domain
    Domain for IIS host header bindings

.PARAMETER DatabaseName
    SQL Server database name (e.g., my-project_DB)

.PARAMETER ProjectName
    Human-readable project name (used for JWT Issuer/Audience)

.PARAMETER SqlServerInstance
    SQL Server instance name. Default: localhost

.PARAMETER BasePath
    Root path for sites. Default: F:\New_WWW
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteName,

    [Parameter(Mandatory = $true)]
    [string]$Domain,

    [Parameter(Mandatory = $true)]
    [string]$DatabaseName,

    [Parameter(Mandatory = $true)]
    [string]$ProjectName,

    [string]$SqlServerInstance = "localhost",

    [string]$BasePath = "F:\New_WWW"
)

$ErrorActionPreference = "Stop"

# - Paths -----------------------------------
$sitePath      = Join-Path $BasePath $SiteName
$frontendPath  = Join-Path $sitePath "WWW"
$backendPath   = Join-Path $sitePath "API"
$logsPath      = Join-Path $backendPath "logs"
$backupPath    = "F:\deploy-backups\$SiteName"
$appPoolName   = $SiteName

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " IIS Provisioning: $SiteName" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Domain:       $Domain"
Write-Host "  Database:     $DatabaseName"
Write-Host "  Project:      $ProjectName"
Write-Host "  Frontend:     $frontendPath"
Write-Host "  Backend:      $backendPath"
Write-Host "  App Pool:     $appPoolName"
Write-Host "  SQL Instance: $SqlServerInstance"
Write-Host "==========================================================" -ForegroundColor Cyan

$summary = @()

# - 1. Create Directories ---------------------------
Write-Host "`n>> Creating directories..." -ForegroundColor Yellow

foreach ($dir in @($frontendPath, $backendPath, $logsPath, $backupPath)) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "   Created: $dir" -ForegroundColor Green
        $summary += "Created directory: $dir"
    } else {
        Write-Host "   Exists:  $dir" -ForegroundColor Gray
    }
}

# - 2. Create SQL Server Database -----------------------
Write-Host "`n>> Creating database: $DatabaseName ..." -ForegroundColor Yellow

$sqlCheck = @"
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'$DatabaseName')
BEGIN
    CREATE DATABASE [$DatabaseName];
    PRINT 'DATABASE_CREATED';
END
ELSE
BEGIN
    PRINT 'DATABASE_EXISTS';
END
"@

try {
    $result = sqlcmd -S $SqlServerInstance -Q $sqlCheck -h -1 -W 2>&1
    $resultText = ($result | Out-String).Trim()
    if ($resultText -match "DATABASE_CREATED") {
        Write-Host "   Database created: $DatabaseName" -ForegroundColor Green
        $summary += "Created database: $DatabaseName"
    } elseif ($resultText -match "DATABASE_EXISTS") {
        Write-Host "   Database already exists: $DatabaseName" -ForegroundColor Gray
    } else {
        Write-Host "   sqlcmd output: $resultText" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ERROR creating database: $_" -ForegroundColor Red
    throw
}

# - 2b. Grant IIS App Pool access to database -----------------------
Write-Host "`n>> Granting database access to IIS App Pool..." -ForegroundColor Yellow

$appPoolLogin = "IIS APPPOOL\$SiteName"
$sqlGrant = @"
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = N'$appPoolLogin')
BEGIN
    CREATE LOGIN [$appPoolLogin] FROM WINDOWS;
    PRINT 'LOGIN_CREATED';
END
ELSE
BEGIN
    PRINT 'LOGIN_EXISTS';
END

USE [$DatabaseName];

IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'$appPoolLogin')
BEGIN
    CREATE USER [$appPoolLogin] FOR LOGIN [$appPoolLogin];
    PRINT 'USER_CREATED';
END
ELSE
BEGIN
    PRINT 'USER_EXISTS';
END

ALTER ROLE db_datareader ADD MEMBER [$appPoolLogin];
ALTER ROLE db_datawriter ADD MEMBER [$appPoolLogin];
ALTER ROLE db_ddladmin ADD MEMBER [$appPoolLogin];
PRINT 'ROLES_GRANTED';
"@

try {
    $result = sqlcmd -S $SqlServerInstance -Q $sqlGrant -h -1 -W 2>&1
    $resultText = ($result | Out-String).Trim()
    Write-Host "   $resultText" -ForegroundColor Green
    $summary += "Granted DB access to $appPoolLogin"
} catch {
    Write-Host "   ERROR granting DB access: $_" -ForegroundColor Red
    throw
}

# - 3. Generate appsettings.Production.json ------------------
Write-Host "`n>> Generating appsettings.Production.json ..." -ForegroundColor Yellow

$appsettingsPath = Join-Path $backendPath "appsettings.Production.json"

if (!(Test-Path $appsettingsPath)) {
    # Generate a random 32-byte base64 JWT key
    $jwtKey = [System.Convert]::ToBase64String(
        (1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]
    )

    $connectionString = "Server=$SqlServerInstance;Database=$DatabaseName;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True"

    $appsettings = @{
        ConnectionStrings = @{
            DefaultConnection = $connectionString
        }
        Jwt = @{
            Key          = $jwtKey
            Issuer       = $ProjectName
            Audience     = $ProjectName
            ExpiryHours  = 24
        }
        Cors = @{
            Origins = "https://$Domain"
        }
        Logging = @{
            LogLevel = @{
                Default              = "Information"
                "Microsoft.AspNetCore" = "Warning"
            }
        }
    }

    $appsettings | ConvertTo-Json -Depth 5 | Set-Content -Path $appsettingsPath -Encoding UTF8
    Write-Host "   Created: $appsettingsPath" -ForegroundColor Green
    $summary += "Created appsettings.Production.json"
} else {
    Write-Host "   Exists:  $appsettingsPath (not overwritten)" -ForegroundColor Gray
}

# - 4. Import IIS Module ---------------------------
Import-Module WebAdministration -ErrorAction Stop

# - 5. Create App Pool ----------------------------
Write-Host "`n>> Creating App Pool: $appPoolName ..." -ForegroundColor Yellow

if (!(Test-Path "IIS:\AppPools\$appPoolName")) {
    $pool = New-WebAppPool -Name $appPoolName
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name managedRuntimeVersion -Value ""   # No Managed Code (.NET 8)
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name managedPipelineMode -Value "Integrated"
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name autoStart -Value $true
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name startMode -Value "AlwaysRunning"
    Write-Host "   App pool created: $appPoolName (No Managed Code, Integrated, AlwaysRunning)" -ForegroundColor Green
    $summary += "Created app pool: $appPoolName"
} else {
    Write-Host "   App pool exists: $appPoolName" -ForegroundColor Gray
    # Ensure correct settings even if pool already exists
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name managedRuntimeVersion -Value ""
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name managedPipelineMode -Value "Integrated"
}

# - 6. Create IIS Site ----------------------------
Write-Host "`n>> Creating IIS Site: $SiteName ..." -ForegroundColor Yellow

if (!(Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
    New-Website -Name $SiteName `
                -PhysicalPath $frontendPath `
                -ApplicationPool $appPoolName `
                -HostHeader $Domain `
                -Port 80 `
                -Force | Out-Null
    Write-Host "   Site created: $SiteName -> $frontendPath (port 80, host: $Domain)" -ForegroundColor Green
    $summary += "Created IIS site: $SiteName"
} else {
    Write-Host "   Site exists: $SiteName" -ForegroundColor Gray
}

# - 7. Add HTTPS binding if wildcard cert is available -------------
Write-Host "`n>> Checking for SSL certificate..." -ForegroundColor Yellow

$certDomain = "*.3eweb.com"
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object {
    $_.Subject -match [regex]::Escape($certDomain) -or
    ($_.Extensions | Where-Object { $_.Oid.FriendlyName -eq "Subject Alternative Name" } |
     ForEach-Object { $_.Format($false) }) -match [regex]::Escape($certDomain)
} | Sort-Object NotAfter -Descending | Select-Object -First 1

if ($cert) {
    $existingHttps = Get-WebBinding -Name $SiteName -Protocol "https" -ErrorAction SilentlyContinue
    if (!$existingHttps) {
        New-WebBinding -Name $SiteName -Protocol "https" -Port 443 -HostHeader $Domain -SslFlags 1
        # Assign the certificate
        $binding = Get-WebBinding -Name $SiteName -Protocol "https" -Port 443
        $binding.AddSslCertificate($cert.Thumbprint, "My")
        Write-Host "   HTTPS binding added with cert: $($cert.Thumbprint.Substring(0,8))..." -ForegroundColor Green
        $summary += "Added HTTPS binding with wildcard cert"
    } else {
        Write-Host "   HTTPS binding already exists" -ForegroundColor Gray
    }
} else {
    Write-Host "   No wildcard cert found for $certDomain - HTTP only" -ForegroundColor Yellow
    $summary += "No SSL cert found - HTTP only (add manually later)"
}

# - 8. Create /api Virtual Application --------------------
Write-Host "`n>> Creating /api virtual application..." -ForegroundColor Yellow

$existingApp = Get-WebApplication -Site $SiteName -Name "api" -ErrorAction SilentlyContinue
if (!$existingApp) {
    New-WebApplication -Site $SiteName `
                       -Name "api" `
                       -PhysicalPath $backendPath `
                       -ApplicationPool $appPoolName | Out-Null
    Write-Host "   Virtual app created: /$SiteName/api -> $backendPath" -ForegroundColor Green
    $summary += "Created virtual application: /api"
} else {
    Write-Host "   Virtual app /api already exists" -ForegroundColor Gray
}

# - 9. Set Folder Permissions -------------------------
Write-Host "`n>> Setting folder permissions..." -ForegroundColor Yellow

$appPoolIdentity = "IIS AppPool\$appPoolName"

try {
    # IIS_IUSRS - read/execute on both frontend and backend
    $acl = Get-Acl $frontendPath
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "IIS_IUSRS", "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $frontendPath -AclObject $acl

    $acl = Get-Acl $backendPath
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "IIS_IUSRS", "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $backendPath -AclObject $acl

    # App pool identity - write to API/logs
    $acl = Get-Acl $logsPath
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $appPoolIdentity, "Modify", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $logsPath -AclObject $acl

    # App pool identity - read on API folder (for appsettings, etc.)
    $acl = Get-Acl $backendPath
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $appPoolIdentity, "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $backendPath -AclObject $acl

    Write-Host "   Permissions set for IIS_IUSRS and $appPoolIdentity" -ForegroundColor Green
    $summary += "Set folder permissions"
} catch {
    Write-Host "   Warning: Error setting permissions - $_" -ForegroundColor Yellow
    $summary += "WARNING: Permission setting had errors"
}

# - 10. Start App Pool ----------------------------
Write-Host "`n>> Starting App Pool..." -ForegroundColor Yellow

try {
    $poolState = (Get-WebAppPoolState -Name $appPoolName).Value
    if ($poolState -ne "Started") {
        Start-WebAppPool -Name $appPoolName
        Write-Host "   App pool started" -ForegroundColor Green
    } else {
        Write-Host "   App pool already running" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Warning: Could not start app pool - $_" -ForegroundColor Yellow
}

# - 11. Create default index.html placeholder -----------------
$indexPath = Join-Path $frontendPath "index.html"
if (!(Test-Path $indexPath)) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC"
    $indexHtml = "<!DOCTYPE html><html><head><title>$ProjectName</title></head><body><h1>$ProjectName</h1><p>Site provisioned successfully. Awaiting first deployment.</p><p><small>$timestamp</small></p></body></html>"
    Set-Content -Path $indexPath -Value $indexHtml -Encoding UTF8
    Write-Host "`n>> Created placeholder index.html" -ForegroundColor Green
}

# - Summary -
Write-Host ""
Write-Host "========== Provisioning Complete! ==========" -ForegroundColor Green
Write-Host "Site Name:    $SiteName"
Write-Host "Domain:       $Domain"
Write-Host "App Pool:     $appPoolName"
Write-Host "Database:     $DatabaseName"
Write-Host "Frontend:     $frontendPath"
Write-Host "Backend:      $backendPath"
Write-Host "Backups:      $backupPath"
Write-Host ""
Write-Host "Actions taken:" -ForegroundColor Yellow
foreach ($item in $summary) {
    Write-Host "  - $item" -ForegroundColor Green
}
Write-Host ""
Write-Host "URLs:" -ForegroundColor Yellow
Write-Host "  http://$Domain"
Write-Host "  http://$Domain/api/health"
if ($cert) {
    Write-Host "  https://$Domain"
    Write-Host "  https://$Domain/api/health"
}
Write-Host "============================================" -ForegroundColor Green
