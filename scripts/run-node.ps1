param(
  [int]$HttpPort,
  [int]$P2PPort,
  [string]$DataDir,
  [int]$FrontendPort,
  [switch]$Rebuild = $true
)

$ErrorActionPreference = "Stop"

# Ensure we're in the project root
$scriptDir = Split-Path -Parent $PSCommandPath
$root = Split-Path -Parent $scriptDir
Set-Location $root

# Ensure node-agent executable is up to date
$agentExe = ".\node-agent\node-agent.exe"
if ($Rebuild -or -not (Test-Path $agentExe)) {
    Write-Host "Building node-agent..." -ForegroundColor Yellow
    Push-Location "node-agent"
    go build -o node-agent.exe .
    Pop-Location
}

Write-Host "Starting Node Agent on port $HttpPort (P2P: $P2PPort)..." -ForegroundColor Cyan
# Start backend in background but output to this console
$backendProcess = Start-Process -FilePath $agentExe -ArgumentList "-http 127.0.0.1:$HttpPort", "-p2p-port $P2PPort", "-data-dir `"$DataDir`"" -NoNewWindow -PassThru

# Give it a moment to start
Start-Sleep -Seconds 2

# Set environment variable for frontend
$env:VITE_NODE_AGENT_URL = "http://127.0.0.1:$HttpPort"

Write-Host "Starting Frontend on port $FrontendPort..." -ForegroundColor Cyan
# Start frontend (blocking)
try {
    # Use npx vite directly to avoid argument parsing issues with npm run dev
    npx vite --port $FrontendPort
} finally {
    # Kill backend when frontend stops
    Write-Host "Stopping Node Agent..." -ForegroundColor Yellow
    Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
}
