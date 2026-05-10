param(
  [switch]$SkipDocker,
  [switch]$SkipInstall,
  [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$RootEnv = Join-Path $RepoRoot ".env"
$BackendEnv = Join-Path $BackendDir ".env"
$FrontendEnv = Join-Path $FrontendDir ".env"
$startBackend = $true
$startFrontend = $true
$dbReady = $false
$dbIssue = $null

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Ensure-EnvFile {
  param(
    [string]$Path,
    [string]$ExamplePath
  )

  if (-not (Test-Path $Path)) {
    if (-not (Test-Path $ExamplePath)) {
      throw "Missing env file and template: $Path"
    }
    Copy-Item $ExamplePath $Path
    Write-Host "Created $Path from template."
  }
}

function Get-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Default = ""
  )

  if (-not (Test-Path $Path)) {
    return $Default
  }

  $line = Get-Content $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
  if (-not $line) {
    return $Default
  }

  return ($line -replace "^$Key=", "").Trim()
}

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $content = if (Test-Path $Path) { Get-Content $Path } else { @() }
  $updated = $false

  for ($i = 0; $i -lt $content.Count; $i++) {
    if ($content[$i] -match "^$Key=") {
      $content[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $content += "$Key=$Value"
  }

  Set-Content -Path $Path -Value $content
}

function Test-DockerEngine {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    return $false
  }

  try {
    $null = & docker info 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1500, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($async)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Get-PortOwner {
  param([int]$Port)

  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) {
    return $null
  }

  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  return @{
    Port = $Port
    Pid = $conn.OwningProcess
    ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
  }
}

function Install-NpmDeps {
  param(
    [string]$Dir,
    [string]$Name,
    [string[]]$RequiredPaths
  )

  $nodeModules = Join-Path $Dir "node_modules"
  $healthy = $true
  foreach ($requiredPath in $RequiredPaths) {
    if (-not (Test-Path (Join-Path $Dir $requiredPath))) {
      $healthy = $false
      break
    }
  }

  if ((Test-Path $nodeModules) -and $healthy) {
    Write-Host "$Name dependencies already present. Skipping install."
    return
  }

  if (Test-Path $nodeModules) {
    Write-Warning "$Name node_modules exists but install is incomplete. Reinstalling."
  }

  Write-Host "Installing $Name dependencies..."
  Push-Location $Dir
  try {
    & npm ci
  } catch {
    $message = $_.Exception.Message
    if ($message -match "EPERM|esbuild\.exe") {
      Write-Warning "$Name install blocked by locked file. Close running dev servers, editors, or antivirus lock on node_modules, then rerun."
    }
    throw
  } finally {
    Pop-Location
  }
}

function Test-PlaceholderDatabaseUrl {
  param([string]$DatabaseUrl)
  return $DatabaseUrl -match "://[^:]+:change-me@"
}

function Sync-BackendDatabaseUrl {
  $postgresUser = Get-EnvValue -Path $RootEnv -Key "POSTGRES_USER" -Default "postgres"
  $postgresPassword = Get-EnvValue -Path $RootEnv -Key "POSTGRES_PASSWORD" -Default "change-me"
  $postgresDb = Get-EnvValue -Path $RootEnv -Key "POSTGRES_DB" -Default "eval_atlas"
  $postgresPort = Get-EnvValue -Path $RootEnv -Key "POSTGRES_PORT" -Default "5432"
  $databaseUrl = "postgresql://{0}:{1}@localhost:{2}/{3}" -f $postgresUser, $postgresPassword, $postgresPort, $postgresDb
  Set-EnvValue -Path $BackendEnv -Key "DATABASE_URL" -Value $databaseUrl
  return $databaseUrl
}

function Test-DatabaseAuth {
  param([string]$DatabaseUrl)

  $nodeCheck = @'
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.end())
  .then(() => {
    console.log("DB_OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.code || err.message || "DB_ERROR");
    process.exit(1);
  });
'@

  Push-Location $BackendDir
  try {
    $previousDatabaseUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $DatabaseUrl
    $output = $nodeCheck | node - 2>&1
    if ($LASTEXITCODE -eq 0) {
      return @{ Ok = $true; Message = "ok" }
    }
    $message = ($output | Out-String).Trim()
    return @{ Ok = $false; Message = $message }
  } finally {
    if ($null -eq $previousDatabaseUrl) {
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    } else {
      $env:DATABASE_URL = $previousDatabaseUrl
    }
    Pop-Location
  }
}

Write-Host "Preparing Eval Atlas startup..."

Require-Command "npm"
Require-Command "node"

Ensure-EnvFile -Path $RootEnv -ExamplePath (Join-Path $RepoRoot ".env.example")
Ensure-EnvFile -Path $BackendEnv -ExamplePath (Join-Path $BackendDir ".env.example")
Ensure-EnvFile -Path $FrontendEnv -ExamplePath (Join-Path $FrontendDir ".env.example")

$postgresPort = Get-EnvValue -Path $RootEnv -Key "POSTGRES_PORT" -Default "5432"
$backendPort = [int](Get-EnvValue -Path $BackendEnv -Key "PORT" -Default "3000")
$frontendPort = 5173
$databaseUrl = Sync-BackendDatabaseUrl
$dbReachable = Test-TcpPort -HostName "127.0.0.1" -Port ([int]$postgresPort)

if (-not $SkipDocker) {
  if (Test-DockerEngine) {
    Write-Host "Starting Postgres with docker compose..."
    & docker compose up -d
    $dbReachable = Test-TcpPort -HostName "127.0.0.1" -Port ([int]$postgresPort)
  } else {
    Write-Warning "Docker engine not available. Skipping docker compose. Start Docker Desktop or use -SkipDocker with existing Postgres."
    $SkipDocker = $true
  }
}

if (-not $SkipInstall) {
  Install-NpmDeps -Dir $BackendDir -Name "backend" -RequiredPaths @(
    "node_modules\.bin\tsx.cmd",
    "node_modules\pg\package.json"
  )
  Install-NpmDeps -Dir $FrontendDir -Name "frontend" -RequiredPaths @(
    "node_modules\.bin\vite.cmd",
    "node_modules\.bin\tsc.cmd",
    "node_modules\react\package.json"
  )
}

if (-not $dbReachable) {
  $dbIssue = "Postgres not reachable on localhost:$postgresPort"
} elseif (-not $databaseUrl) {
  $dbIssue = "DATABASE_URL missing in backend/.env"
} elseif (Test-PlaceholderDatabaseUrl -DatabaseUrl $databaseUrl) {
  $dbIssue = "DATABASE_URL still uses placeholder password 'change-me'"
} else {
  $dbCheck = Test-DatabaseAuth -DatabaseUrl $databaseUrl
  if ($dbCheck.Ok) {
    $dbReady = $true
  } else {
    $dbIssue = "Database auth failed: $($dbCheck.Message)"
  }
}

if (-not $dbReady) {
  Write-Warning "$dbIssue. Skipping migrations. Backend will still start in fallback mode and avoid database-backed features."
  $SkipMigrate = $true
}

if (-not $SkipMigrate) {
  Write-Host "Running backend migrations..."
  Push-Location $BackendDir
  try {
    & npm run migrate
  } finally {
    Pop-Location
  }
}

Write-Host "Starting services..."
$backendProc = $null
$existingBackend = Get-PortOwner -Port $backendPort
if ($existingBackend) {
  Write-Warning "Backend port $backendPort already in use by PID $($existingBackend.Pid) ($($existingBackend.ProcessName)). Reusing existing backend."
  $startBackend = $false
}
if ($startBackend) {
  $backendProc = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory $BackendDir -PassThru
} else {
  Write-Host "Backend skipped."
}
$frontendProc = $null
$existingFrontend = Get-PortOwner -Port $frontendPort
if ($existingFrontend) {
  Write-Warning "Frontend port $frontendPort already in use by PID $($existingFrontend.Pid) ($($existingFrontend.ProcessName)). Reusing existing frontend."
  $startFrontend = $false
}
if ($startFrontend) {
  $frontendProc = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev","--","--host","0.0.0.0" -WorkingDirectory $FrontendDir -PassThru
} else {
  Write-Host "Frontend skipped."
}

Write-Host ""
Write-Host "Eval Atlas start launched."
if ($backendProc) {
  Write-Host "Backend PID: $($backendProc.Id)"
} elseif ($existingBackend) {
  Write-Host "Backend PID: $($existingBackend.Pid) (existing)"
}
if ($frontendProc) {
  Write-Host "Frontend PID: $($frontendProc.Id)"
} elseif ($existingFrontend) {
  Write-Host "Frontend PID: $($existingFrontend.Pid) (existing)"
}
Write-Host "Frontend URL: http://localhost:5173"
if ($backendProc -or $existingBackend) {
  Write-Host "Backend URL:  http://localhost:3000"
}
if (-not $dbReady) {
  Write-Host "DB status: $dbIssue"
  Write-Host "Backend fallback mode: running without database persistence."
  Write-Host "Fix: update backend/.env DATABASE_URL with real Postgres password, or start Docker Desktop for repo-managed Postgres."
}
Write-Host ""
if ($backendProc -and $frontendProc) {
  Write-Host "Use Stop-Process -Id $($backendProc.Id),$($frontendProc.Id) to stop them."
} elseif ($backendProc) {
  Write-Host "Use Stop-Process -Id $($backendProc.Id) to stop backend."
} elseif ($frontendProc) {
  Write-Host "Use Stop-Process -Id $($frontendProc.Id) to stop frontend."
} else {
  Write-Host "No new processes started."
}
