#!/bin/bash

# Script to start multiple frontend instances connected to different node-agent backends
# Each frontend will run on different ports and connect to different node-agent instances

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting multiple frontend instances...${NC}"

cd "$PROJECT_ROOT"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found in $PROJECT_ROOT${NC}"
    exit 1
fi

# Function to start a frontend instance
start_frontend() {
    local instance_num=$1
    local frontend_port=$((5173 + instance_num - 1))
    local backend_port=$((9876 + instance_num - 1))
    local backend_url="http://127.0.0.1:$backend_port"
    
    echo -e "${GREEN}Starting Frontend $instance_num:${NC}"
    echo -e "  Frontend Port: $frontend_port"
    echo -e "  Backend URL: $backend_url"
    echo ""
    
    # Set environment variables and start Vite dev server
    VITE_NODE_AGENT_URL="$backend_url" \
    PORT="$frontend_port" \
    npm run dev -- --port "$frontend_port" --host 127.0.0.1 &
    
    local pid=$!
    echo -e "${BLUE}Started Frontend $instance_num with PID $pid${NC}"
    echo "$pid" > "frontend$instance_num.pid"
    
    return $pid
}

# Function to stop all frontends
stop_frontends() {
    echo -e "${YELLOW}Stopping all frontend instances...${NC}"
    
    for i in {1..3}; do
        local pid_file="frontend$i.pid"
        
        if [ -f "$pid_file" ]; then
            local pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${YELLOW}Stopping Frontend $i (PID: $pid)${NC}"
                kill "$pid"
                rm -f "$pid_file"
            else
                echo -e "${RED}Frontend $i (PID: $pid) not running${NC}"
                rm -f "$pid_file"
            fi
        fi
    done
    
    echo -e "${GREEN}All frontends stopped${NC}"
}

# Handle Ctrl+C
trap stop_frontends EXIT INT TERM

# Check command line arguments
case "${1:-start}" in
    "start")
        echo -e "${BLUE}Starting 3 frontend instances...${NC}"
        echo ""
        
        # Check if node_modules exists
        if [ ! -d "node_modules" ]; then
            echo -e "${YELLOW}Installing dependencies...${NC}"
            npm install
        fi
        
        # Start 3 instances
        start_frontend 1
        sleep 3
        start_frontend 2
        sleep 3
        start_frontend 3
        
        echo ""
        echo -e "${GREEN}All frontends started!${NC}"
        echo ""
        echo -e "${BLUE}Access URLs:${NC}"
        echo -e "  Frontend 1 → Backend 1: http://127.0.0.1:5173 → http://127.0.0.1:9876"
        echo -e "  Frontend 2 → Backend 2: http://127.0.0.1:5174 → http://127.0.0.1:9877"
        echo -e "  Frontend 3 → Backend 3: http://127.0.0.1:5175 → http://127.0.0.1:9878"
        echo ""
        echo -e "${YELLOW}Each frontend connects to its corresponding node-agent backend${NC}"
        echo -e "${BLUE}Press Ctrl+C to stop all frontends${NC}"
        
        # Wait for all background processes
        wait
        ;;
        
    "stop")
        stop_frontends
        ;;
        
    "status")
        echo -e "${BLUE}Frontend Status:${NC}"
        echo ""
        
        for i in {1..3}; do
            local pid_file="frontend$i.pid"
            local frontend_port=$((5173 + i - 1))
            local backend_port=$((9876 + i - 1))
            
            if [ -f "$pid_file" ]; then
                local pid=$(cat "$pid_file")
                if kill -0 "$pid" 2>/dev/null; then
                    echo -e "${GREEN}Frontend $i: Running (PID: $pid, Port: $frontend_port → Backend: $backend_port)${NC}"
                else
                    echo -e "${RED}Frontend $i: Not running (stale PID: $pid)${NC}"
                    rm -f "$pid_file"
                fi
            else
                echo -e "${RED}Frontend $i: Not running${NC}"
            fi
        done
        ;;
        
    "clean")
        stop_frontends
        echo -e "${YELLOW}Cleaning up PID files...${NC}"
        rm -f frontend*.pid
        echo -e "${GREEN}Cleanup complete${NC}"
        ;;
        
    *)
        echo -e "${BLUE}Usage: $0 [start|stop|status|clean]${NC}"
        echo ""
        echo -e "${YELLOW}Commands:${NC}"
        echo -e "  start   - Start 3 frontend instances (default)"
        echo -e "  stop    - Stop all running instances"
        echo -e "  status  - Show status of all instances"
        echo -e "  clean   - Stop frontends and clean PID files"
        echo ""
        echo -e "${BLUE}Note: Make sure node-agent backends are running first!${NC}"
        echo -e "Run: ./scripts/start-multi-agents.sh"
        exit 1
        ;;
esac