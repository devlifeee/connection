#!/bin/bash
# Start 3 instances of node-agent on different ports
echo "Starting Node Agent 1 (Port 8080, P2P 9001)..."
./node-agent/node-agent -port 8080 -p2p 9001 -data ./node-agent/data1 &

echo "Starting Node Agent 2 (Port 8081, P2P 9002)..."
./node-agent/node-agent -port 8081 -p2p 9002 -data ./node-agent/data2 &

echo "Starting Node Agent 3 (Port 8082, P2P 9003)..."
./node-agent/node-agent -port 8082 -p2p 9003 -data ./node-agent/data3 &

wait