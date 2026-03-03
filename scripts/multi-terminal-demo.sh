#!/bin/bash
echo "Starting multi-terminal demo..."

# Start 3 backend agents
./scripts/start-multi-agents.sh &

# Wait for agents to initialize
sleep 5

# Start 3 frontend instances
./scripts/start-multi-frontends.sh &

echo "Demo environment running. Press Ctrl+C to stop."
wait