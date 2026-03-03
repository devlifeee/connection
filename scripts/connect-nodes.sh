#!/bin/bash

# Script to connect two running node-agent instances

echo "Connecting nodes..."

# Get identities
NODE1_IDENTITY=$(curl -s http://127.0.0.1:9876/identity)
NODE2_IDENTITY=$(curl -s http://127.0.0.1:9877/identity)

# Extract peer IDs and addresses
NODE1_PEER_ID=$(echo $NODE1_IDENTITY | jq -r '.peer_id')
NODE1_ADDR=$(echo $NODE1_IDENTITY | jq -r '.addrs[0]')

NODE2_PEER_ID=$(echo $NODE2_IDENTITY | jq -r '.peer_id')
NODE2_ADDR=$(echo $NODE2_IDENTITY | jq -r '.addrs[0]')

echo "Node 1: $NODE1_PEER_ID at $NODE1_ADDR"
echo "Node 2: $NODE2_PEER_ID at $NODE2_ADDR"

# Connect Node 1 to Node 2
echo "Connecting Node 1 to Node 2..."
curl -X POST http://127.0.0.1:9876/connect \
  -H "Content-Type: application/json" \
  -d "{\"addr\": \"$NODE2_ADDR/p2p/$NODE2_PEER_ID\"}"

echo ""

# Connect Node 2 to Node 1  
echo "Connecting Node 2 to Node 1..."
curl -X POST http://127.0.0.1:9877/connect \
  -H "Content-Type: application/json" \
  -d "{\"addr\": \"$NODE1_ADDR/p2p/$NODE1_PEER_ID\"}"

echo ""
echo "Nodes connected!"

# Wait a bit for presence exchange
sleep 2

# Check presence peers
echo ""
echo "Node 1 presence peers:"
curl -s http://127.0.0.1:9876/presence/peers | jq '.peers[].payload.display_name'

echo ""
echo "Node 2 presence peers:"
curl -s http://127.0.0.1:9877/presence/peers | jq '.peers[].payload.display_name'