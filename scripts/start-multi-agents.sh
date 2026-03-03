#!/bin/bash

# Script to start multiple node-agent instances for testing multi-terminal support
# Each instance will run on different ports with different data directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NODE_AGENT_DIR="$PROJECT_ROOT/node-agent"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting multiple node-agent instances...${NC}"

# Check if node-agent directory exists
if [ ! -d "$NODE_AGENT_DIR" ]; then
    echo -e "${RED}Error: node-agent directory not found at $NODE_AGENT_DIR${NC}"
    exit 1
fi

cd "$NODE_AGENT_DIR"

# Build the binary if it doesn't exist
if [ ! -f "node-agent" ]; then
    echo -e "${YELLOW}Building node-agent binary...${NC}"
    go build -o node-agent .
fi

# Function to start a node-agent instance
start_agent() {
    local instance_num=$1
    local p2p_port=$((9000 + instance_num))
    local http_port=$((9876 + instance_num))
    local data_dir="data$instance_num"
    local name="Node-$instance_num"
    
    echo -e "${GREEN}Starting Node Agent $instance_num:${NC}"
    echo -e "  P2P Port: $p2p_port"
    echo -e "  HTTP Port: $http_port"
    echo -e "  Data Dir: $data_dir"
    echo -e "  Name: $name"
    echo ""
    
    # Create data directory if it doesn't exist
    mkdir -p "$data_dir"
    
    # Start the agent
    ./node-agent \
        -name "$name" \
        -p2p-port $p2p_port \
        -http "127.0.0.1:$http_port" \
        -data-dir "$data_dir" &
    
    local pid=$!
    echo -e "${BLUE}Started Node Agent $instance_num with PID $pid${NC}"
    echo "$pid" > "$data_dir/agent.pid"
    
    return $pid
}

# Function to stop all agents
stop_agents() {
    echo -e "${YELLOW}Stopping all node-agent instances...${NC}"
    
    for i in {1..3}; do
        local data_dir="data$i"
        local pid_file="$data_dir/agent.pid"
        
        if [ -f "$pid_file" ]; then
            local pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${YELLOW}Stopping Node Agent $i (PID: $pid)${NC}"
                kill "$pid"
                rm -f "$pid_file"
            else
                echo -e "${RED}Node Agent $i (PID: $pid) not running${NC}"
                rm -f "$pid_file"
            fi
        fi
    done
    
    echo -e "${GREEN}All agents stopped${NC}"
}

# Handle Ctrl+C
trap stop_agents EXIT INT TERM

# Check command line arguments
case "${1:-start}" in
    "start")
        echo -e "${BLUE}Starting 3 node-agent instances...${NC}"
        echo ""
        
        # Start 3 instances
        start_agent 1
        sleep 2
        start_agent 2
        sleep 2
        start_agent 3
        
        echo ""
        echo -e "${GREEN}All agents started!${NC}"
        echo ""
        echo -e "${BLUE}Access URLs:${NC}"
        echo -e "  Node 1: http://127.0.0.1:9876"
        echo -e "  Node 2: http://127.0.0.1:9877"
        echo -e "  Node 3: http://127.0.0.1:9878"
        echo ""
        echo -e "${YELLOW}Frontend URLs (set VITE_NODE_AGENT_URL):${NC}"
        echo -e "  VITE_NODE_AGENT_URL=http://127.0.0.1:9876 npm run dev"
        echo -e "  VITE_NODE_AGENT_URL=http://127.0.0.1:9877 npm run dev"
        echo -e "  VITE_NODE_AGENT_URL=http://127.0.0.1:9878 npm run dev"
        echo ""
        echo -e "${BLUE}Press Ctrl+C to stop all agents${NC}"
        
        # Wait for all background processes
        wait
        ;;
        
    "stop")
        stop_agents
        ;;
        
    "status")
        echo -e "${BLUE}Node Agent Status:${NC}"
        echo ""
        
        for i in {1..3}; do
            local data_dir="data$i"
            local pid_file="$data_dir/agent.pid"
            local http_port=$((9876 + i))
            
            if [ -f "$pid_file" ]; then
                local pid=$(cat "$pid_file")
                if kill -0 "$pid" 2>/dev/null; then
                    echo -e "${GREEN}Node Agent $i: Running (PID: $pid, Port: $http_port)${NC}"
                    # Try to get health status
                    if command -v curl >/dev/null 2>&1; then
                        local health=$(curl -s "http://127.0.0.1:$http_port/health" 2>/dev/null || echo "unreachable")
                        echo -e "  Health: $health"
                    fi
                else
                    echo -e "${RED}Node Agent $i: Not running (stale PID: $pid)${NC}"
                    rm -f "$pid_file"
                fi
            else
                echo -e "${RED}Node Agent $i: Not running${NC}"
            fi
        done
        ;;
        
    "clean")
        stop_agents
        echo -e "${YELLOW}Cleaning up data directories...${NC}"
        rm -rf data1 data2 data3
        echo -e "${GREEN}Cleanup complete${NC}"
        ;;
        
    *)
        echo -e "${BLUE}Usage: $0 [start|stop|status|clean]${NC}"
        echo ""
        echo -e "${YELLOW}Commands:${NC}"
        echo -e "  start   - Start 3 node-agent instances (default)"
        echo -e "  stop    - Stop all running instances"
        echo -e "  status  - Show status of all instances"
        echo -e "  clean   - Stop agents and clean data directories"
        exit 1
        ;;
esac