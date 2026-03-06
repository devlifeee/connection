param(
  [int]$Http1 = 9876,
  [int]$P2P1 = 4001,
  [string]$Data1 = "data",
  [int]$Http2 = 9877,
  [int]$P2P2 = 4002,
  [string]$Data2 = "data1",
  [int]$Http3 = 9878,
  [int]$P2P3 = 4003,
  [string]$Data3 = "data2",
  [int]$PortFE1 = 8080,
  [int]$PortFE2 = 8081,
  [int]$PortFE3 = 8082
)

$scriptDir = Split-Path -Parent $PSCommandPath
$root = Split-Path -Parent $scriptDir
$agentDir = Join-Path $root "node-agent"

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$agentDir`"; if (Test-Path node-agent.exe) { .\node-agent.exe -http 127.0.0.1:$Http1 -p2p-port $P2P1 -data-dir `"$Data1`" } else { go run . -http 127.0.0.1:$Http1 -p2p-port $P2P1 -data-dir `"$Data1`" }"
)
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$agentDir`"; if (Test-Path node-agent.exe) { .\node-agent.exe -http 127.0.0.1:$Http2 -p2p-port $P2P2 -data-dir `"$Data2`" } else { go run . -http 127.0.0.1:$Http2 -p2p-port $P2P2 -data-dir `"$Data2`" }"
)
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$agentDir`"; if (Test-Path node-agent.exe) { .\node-agent.exe -http 127.0.0.1:$Http3 -p2p-port $P2P3 -data-dir `"$Data3`" } else { go run . -http 127.0.0.1:$Http3 -p2p-port $P2P3 -data-dir `"$Data3`" }"
)

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "$env:VITE_NODE_AGENT_URL=`"http://127.0.0.1:$Http1`"; cd `"$root`"; npm run dev -- --port $PortFE1"
)
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "$env:VITE_NODE_AGENT_URL=`"http://127.0.0.1:$Http2`"; cd `"$root`"; npm run dev -- --port $PortFE2"
)
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "$env:VITE_NODE_AGENT_URL=`"http://127.0.0.1:$Http3`"; cd `"$root`"; npm run dev -- --port $PortFE3"
)
