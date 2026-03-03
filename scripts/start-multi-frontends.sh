#!/bin/bash
# Start 3 frontend instances connected to different agents
echo "Starting Frontend 1 (Port 3000 -> Agent 8080)..."
VITE_AGENT_PORT=8080 npm run dev -- --port 3000 &

echo "Starting Frontend 2 (Port 3001 -> Agent 8081)..."
VITE_AGENT_PORT=8081 npm run dev -- --port 3001 &

echo "Starting Frontend 3 (Port 3002 -> Agent 8082)..."
VITE_AGENT_PORT=8082 npm run dev -- --port 3002 &

wait