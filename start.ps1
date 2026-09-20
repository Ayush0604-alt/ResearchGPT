<#
.SYNOPSIS
    Starts ResearchGPT: the FastAPI backend and the Vite frontend, together.

.DESCRIPTION
    One command to bring the whole app up locally. It checks prerequisites,
    installs anything missing, starts both servers, waits until the API is
    actually healthy, then streams both logs into this one window.

    Ctrl+C stops both. If a run is ever orphaned, '.\start.ps1 -Stop' cleans up.

.PARAMETER Migrate
    Run 'alembic upgrade head' before starting. Off by default on purpose:
    backend/.env points at a cloud Neon database, so migrating is not a
    harmless local-only step. Without this flag the script only warns when the
    database is behind.

.PARAMETER Stop
    Kill servers left running by a previous run, then exit.

.EXAMPLE
    .\start.ps1
.EXAMPLE
    .\start.ps1 -Migrate
.EXAMPLE
    .\start.ps1 -BackendPort 8001 -FrontendPort 5174 -NoBrowser
#>
[CmdletBinding()]
param(
    [int]$BackendPort  = 8000,
    [int]$FrontendPort = 5173,
    [switch]$Migrate,
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root     = $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$LogDir   = Join-Path $Root 'logs'
$PidFile  = Join-Path $LogDir '.start-pids'
$Python     = Join-Path $Backend 'venv\Scripts\python.exe'
$Alembic    = Join-Path $Backend 'venv\Scripts\alembic.exe'
$Watchfiles = Join-Path $Backend 'venv\Scripts\watchfiles.exe'

function Write-Step  ($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok    ($m) { Write-Host "    $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    $m" -ForegroundColor Yellow }
function Write-Err2  ($m) { Write-Host "    $m" -ForegroundColor Red }

# Kill a process and everything it spawned: uvicorn --reload and npm both fork.
function Stop-Tree ($ProcessId) {
    if (-not $ProcessId) { return }
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Stop-Previous {
    if (-not (Test-Path $PidFile)) { return $false }
    $killed = $false
    foreach ($line in (Get-Content $PidFile -ErrorAction SilentlyContinue)) {
        $parts = $line -split '='
        if ($parts.Count -eq 2) {
            $procId = 0
            if ([int]::TryParse($parts[1].Trim(), [ref]$procId)) {
                if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
                    Write-Ok "stopping $($parts[0].Trim()) (pid $procId)"
                    Stop-Tree $procId
                    $killed = $true
                }
            }
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $killed
}

function Test-PortBusy ($Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return ($null -ne $conn)
    } catch {
        # Throws when nothing is listening, and is absent on older hosts.
        $hit = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING"
        return ($null -ne $hit)
    }
}

# Share-read a log file so the server can keep writing while we tail it.
function New-Reader ($Path) {
    if (-not (Test-Path $Path)) { return $null }
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
          [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    return New-Object System.IO.StreamReader($fs)
}

# ------------------------------------------------------------------ -Stop --
if ($Stop) {
    Write-Step 'Stopping ResearchGPT'
    if (Stop-Previous) { Write-Ok 'stopped.' } else { Write-Warn2 'nothing was running.' }
    exit 0
}

Write-Host ''
Write-Host '  ResearchGPT' -ForegroundColor White
Write-Host ''

# -------------------------------------------------------------- preflight --
Write-Step 'Checking prerequisites'

if (-not (Test-Path (Join-Path $Backend '.env'))) {
    Write-Err2 'backend/.env is missing.'
    Write-Err2 'Create it with:  copy backend\.env.example backend\.env'
    Write-Err2 'then set SECRET_KEY, DATABASE_URL and SYNC_DATABASE_URL.'
    exit 1
}
Write-Ok 'backend/.env found'

if (-not (Test-Path $Python)) {
    Write-Warn2 'no venv - creating one and installing dependencies (a few minutes)'
    Push-Location $Backend
    try {
        & python -m venv venv
        if ($LASTEXITCODE -ne 0) { throw 'could not create the virtualenv (is Python 3.11+ on PATH?)' }
        & $Python -m pip install --upgrade pip --quiet
        & $Python -m pip install -r requirements-dev.txt
        if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
    } finally { Pop-Location }
    Write-Ok 'venv ready'
} else {
    Write-Ok 'backend venv ready'
}

if (-not (Test-Path (Join-Path $Frontend 'node_modules'))) {
    Write-Warn2 'no node_modules - running npm ci (a few minutes)'
    Push-Location $Frontend
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    } finally { Pop-Location }
    Write-Ok 'frontend dependencies ready'
} else {
    Write-Ok 'frontend dependencies ready'
}

# ------------------------------------------------------------- migrations --
Write-Step 'Checking database migrations'
Push-Location $Backend
# Alembic logs INFO to stderr. In Windows PowerShell, merging a native command's
# stderr ('2>&1') wraps those lines in ErrorRecords and trips $ErrorActionPreference
# = 'Stop', so keep the streams apart and judge success by the exit code alone.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $current  = (& $Alembic current 2>$null) | Out-String
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Warn2 'could not reach the database - check DATABASE_URL in backend/.env'
    } elseif ($current -match '\(head\)') {
        Write-Ok "database is up to date ($($current.Trim()))"
    } elseif ($Migrate) {
        Write-Warn2 'migrations pending - applying them'
        & $Alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw 'alembic upgrade head failed' }
        Write-Ok 'migrations applied'
    } else {
        Write-Warn2 'migrations are PENDING. The app may misbehave until they run.'
        Write-Warn2 'Apply them with:  .\start.ps1 -Migrate'
        Write-Warn2 '(backend/.env points at a cloud database, so this is not local-only.)'
    }
} finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
}

# ------------------------------------------------------------------ ports --
Stop-Previous | Out-Null

foreach ($port in @($BackendPort, $FrontendPort)) {
    if (Test-PortBusy $port) {
        Write-Err2 "Port $port is already in use."
        Write-Err2 "Free it, or pick others: .\start.ps1 -BackendPort 8001 -FrontendPort 5174"
        exit 1
    }
}

# ----------------------------------------------------------------- launch --
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$BackendLog  = Join-Path $LogDir 'backend.log'
$FrontendLog = Join-Path $LogDir 'frontend.log'
$BackendErr  = Join-Path $LogDir 'backend.err.log'
$FrontendErr = Join-Path $LogDir 'frontend.err.log'

$backendProc  = $null
$frontendProc = $null
$readers      = @()
$ctrlCAsInput = $false

try {
    Write-Step "Starting backend on http://localhost:$BackendPort"
    # Reload through watchfiles rather than uvicorn's own --reload. On Windows
    # uvicorn restarts its worker with os.kill(pid, CTRL_C_EVENT), which needs a
    # console; this script redirects the output streams, so the signal is
    # accepted but never delivered, the process.join() after it waits forever,
    # and no replacement worker starts. The server then goes on serving the code
    # you just edited, with nothing in the log to say so. watchfiles restarts the
    # command by terminating it, which needs no console.
    # Its Scripts directory goes on PATH so 'uvicorn' in the command below
    # resolves to the venv's, not whatever python is first on the system PATH.
    $env:PATH = "$(Join-Path $Backend 'venv\Scripts');$env:PATH"
    if (Test-Path $Watchfiles) {
        $serverExe = $Watchfiles
        # The command is one argument, so it carries its own quotes:
        # -ArgumentList joins the array with spaces and quotes nothing itself.
        $serverArgs = @(
            '--filter', 'python', '--sigint-timeout', '2', '--sigkill-timeout', '3',
            "`"uvicorn main:app --port $BackendPort`"", '.'
        )
    } else {
        # uvicorn[standard] ships watchfiles, so this is only reached on a venv
        # built from plain uvicorn. Fall back rather than refuse to start, and say
        # why, because --reload will not actually apply edits here.
        Write-Warn2 'watchfiles is missing: falling back to uvicorn --reload,'
        Write-Warn2 'which on Windows detects edits but does not apply them.'
        Write-Warn2 'Fix with:  backend\venv\Scripts\pip install "uvicorn[standard]"'
        $serverExe = $Python
        $serverArgs = @('-m', 'uvicorn', 'main:app', '--reload', '--port', $BackendPort)
    }
    $backendProc = Start-Process -FilePath $serverExe -ArgumentList $serverArgs `
        -WorkingDirectory $Backend -NoNewWindow -PassThru `
        -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErr

    # Vite reads this to decide where to proxy /api; the child inherits it.
    $env:API_PROXY_TARGET = "http://127.0.0.1:$BackendPort"

    Write-Step "Starting frontend on http://localhost:$FrontendPort"
    $frontendProc = Start-Process -FilePath 'npm.cmd' `
        -ArgumentList 'run', 'dev', '--', '--port', $FrontendPort `
        -WorkingDirectory $Frontend -NoNewWindow -PassThru `
        -RedirectStandardOutput $FrontendLog -RedirectStandardError $FrontendErr

    # ASCII, not utf8: Windows PowerShell would prefix a BOM onto the first line.
    Set-Content -Path $PidFile -Encoding ASCII -Value @(
        "backend=$($backendProc.Id)",
        "frontend=$($frontendProc.Id)"
    )

    # Wait for the API to answer, so we never claim "ready" before it is.
    Write-Step 'Waiting for the API'
    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($backendProc.HasExited) { break }
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" `
                        -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { $healthy = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }

    if ($healthy) {
        Write-Ok 'API healthy, database up'
    } elseif ($backendProc.HasExited) {
        Write-Err2 'The backend exited during startup. Last lines:'
        Get-Content $BackendErr -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
        Get-Content $BackendLog -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
        exit 1
    } else {
        Write-Warn2 'API did not answer /health in 30s - streaming logs anyway'
    }

    Write-Host ''
    Write-Host "  Open  http://localhost:$FrontendPort" -ForegroundColor White
    Write-Host "  API   http://localhost:$BackendPort  (docs at /docs)" -ForegroundColor DarkGray
    Write-Host '  Paste your LLM key in Settings - it stays in your browser.' -ForegroundColor DarkGray
    Write-Host '  Ctrl+C stops both.' -ForegroundColor DarkGray
    Write-Host ''

    if (-not $NoBrowser) { Start-Process "http://localhost:$FrontendPort" | Out-Null }

    # ------------------------------------------------------- stream logs ---
    $sources = @(
        @{ Path = $BackendLog;  Tag = 'api'; Color = 'Cyan' },
        @{ Path = $BackendErr;  Tag = 'api'; Color = 'Cyan' },
        @{ Path = $FrontendLog; Tag = 'web'; Color = 'Magenta' },
        @{ Path = $FrontendErr; Tag = 'web'; Color = 'Magenta' }
    )
    foreach ($src in $sources) {
        $reader = New-Reader $src.Path
        if ($reader) { $readers += @{ Reader = $reader; Tag = $src.Tag; Color = $src.Color } }
    }

    # Let the tail loop see Ctrl+C as a keypress, so cleanup is deterministic.
    if ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected) {
        [Console]::TreatControlCAsInput = $true
        $ctrlCAsInput = $true
    }

    while ($true) {
        if ($backendProc.HasExited -and $frontendProc.HasExited) {
            Write-Host ''
            Write-Warn2 'Both servers exited.'
            break
        }

        $sawOutput = $false
        foreach ($entry in $readers) {
            while ($true) {
                $line = $entry.Reader.ReadLine()
                if ($null -eq $line) { break }
                $sawOutput = $true
                Write-Host ("[{0}] " -f $entry.Tag) -ForegroundColor $entry.Color -NoNewline
                Write-Host $line
            }
        }

        if ($ctrlCAsInput -and [Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if (($key.Modifiers -band [ConsoleModifiers]::Control) -and $key.Key -eq 'C') {
                Write-Host ''
                Write-Step 'Shutting down'
                break
            }
        }

        if (-not $sawOutput) { Start-Sleep -Milliseconds 200 }
    }
}
finally {
    if ($ctrlCAsInput) { [Console]::TreatControlCAsInput = $false }
    foreach ($entry in $readers) {
        if ($entry.Reader) { $entry.Reader.Dispose() }
    }
    if ($frontendProc) { Stop-Tree $frontendProc.Id }
    if ($backendProc)  { Stop-Tree $backendProc.Id }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host '    both servers stopped.' -ForegroundColor Green
    Write-Host ''
}
