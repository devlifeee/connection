# Script to connect two running node-agent instances

Write-Host "Connecting nodes..."

# Get identities
try {
    $NODE1_IDENTITY = Invoke-RestMethod -Uri "http://127.0.0.1:9876/identity" -Method Get
    $NODE2_IDENTITY = Invoke-RestMethod -Uri "http://127.0.0.1:9877/identity" -Method Get
} catch {
    Write-Host "Error: Could not connect to nodes. Make sure they are running." -ForegroundColor Red
    exit 1
}

# Extract peer IDs and addresses
$NODE1_PEER_ID = $NODE1_IDENTITY.peer_id
$NODE1_ADDR = $NODE1_IDENTITY.addrs[0]

$NODE2_PEER_ID = $NODE2_IDENTITY.peer_id
$NODE2_ADDR = $NODE2_IDENTITY.addrs[0]

Write-Host "Node 1: $NODE1_PEER_ID at $NODE1_ADDR"
Write-Host "Node 2: $NODE2_PEER_ID at $NODE2_ADDR"

# Connect Node 1 to Node 2
Write-Host "Connecting Node 1 to Node 2..."
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:9876/connect" -Method Post -ContentType "application/json" -Body (@{
        addr = "$NODE2_ADDR/p2p/$NODE2_PEER_ID"
    } | ConvertTo-Json)
} catch {
    Write-Host "Failed to connect Node 1 to Node 2: $_" -ForegroundColor Yellow
}

Write-Host ""

# Connect Node 2 to Node 1
Write-Host "Connecting Node 2 to Node 1..."
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:9877/connect" -Method Post -ContentType "application/json" -Body (@{
        addr = "$NODE1_ADDR/p2p/$NODE1_PEER_ID"
    } | ConvertTo-Json)
} catch {
    Write-Host "Failed to connect Node 2 to Node 1: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Nodes connected!"

# Wait a bit for presence exchange
Start-Sleep -Seconds 2

# Check presence peers
Write-Host ""
Write-Host "Node 1 presence peers:"
try {
    $peers1 = Invoke-RestMethod -Uri "http://127.0.0.1:9876/presence/peers" -Method Get
    $peers1.peers | ForEach-Object { $_.payload.display_name }
} catch {
    Write-Host "Failed to get peers for Node 1" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Node 2 presence peers:"
try {
    $peers2 = Invoke-RestMethod -Uri "http://127.0.0.1:9877/presence/peers" -Method Get
    $peers2.peers | ForEach-Object { $_.payload.display_name }
} catch {
    Write-Host "Failed to get peers for Node 2" -ForegroundColor Yellow
}
