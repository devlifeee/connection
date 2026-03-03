#!/bin/bash

# Main script to demonstrate multi-terminal support
# Manages both node-agent backends and frontend instances

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${PURPLE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    MULTI-TERMINAL DEMO                      ║"
    echo "║              P2P Node Agent + WebSocket Support             ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_help() {
    echo -e "${BLUE}Usage: $0 [command]${NC}"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}start${NC}     - Start all backends and frontends"
    echo -e "  ${GREEN}stop${NC}      - Stop all running instances"
    echo -e "  ${GREEN}restart${NC}   - Restart all instances"
    echo -e "  ${GREEN}status${NC}    - Show status of all instances"
    echo -e "  ${GREEN}clean${NC}     - Stop all and clean up data"
    echo -e "  ${GREEN}backends${NC}  - Manage only node-agent backends"
    echo -e "  ${GREEN}frontends${NC} - Manage only frontend instances"
    echo -e "  ${GREEN}demo${NC}      - Show demo instructions"
    echo ""
    echo -e "${CYAN}Examples:${NC}"
    echo -e "  $0 start          # Start everything"
    echo -e "  $0 backends start # Start only backends"
    echo -e "  $0 frontends stop # Stop only frontends"
    echo -e "  $0 status         # Check all statuses"
}

start_all() {
    print_banner
    echo -e "${BLUE}Starting complete multi-terminal demo...${NC}"
    echo ""
    
    echo -e "${YELLOW}Step 1: Starting node-agent backends...${NC}"
    "$SCRIPT_DIR/start-multi-agents.sh" start &
    BACKENDS_PID=$!
    
    # Wait for backends to start
    echo -e "${YELLOW}Waiting for backends to initialize...${NC}"
    sleep 8
    
    echo -e "${YELLOW}Step 2: Starting frontend instances...${NC}"
    "$SCRIPT_DIR/start-multi-frontends.sh" start &
    FRONTENDS_PID=$!
    
    # Wait for frontends to start
    echo -e "${YELLOW}Waiting for frontends to initialize...${NC}"
    sleep 5
    
    echo ""
    echo -e "${GREEN}🚀 Multi-terminal demo is now running!${NC}"
    echo ""
    show_demo_info
    
    # Handle cleanup on exit
    cleanup() {
        echo -e "\n${YELLOW}Shutting down demo...${NC}"
        if [ ! -z "$FRONTENDS_PID" ] && kill -0 "$FRONTENDS_PID" 2>/dev/null; then
            kill "$FRONTENDS_PID"
        fi
        if [ ! -z "$BACKENDS_PID" ] && kill -0 "$BACKENDS_PID" 2>/dev/null; then
            kill "$BACKENDS_PID"
        fi
        "$SCRIPT_DIR/start-multi-frontends.sh" stop
        "$SCRIPT_DIR/start-multi-agents.sh" stop
        echo -e "${GREEN}Demo stopped${NC}"
    }
    
    trap cleanup EXIT INT TERM
    
    echo -e "${BLUE}Press Ctrl+C to stop the demo${NC}"
    wait
}

stop_all() {
    echo -e "${YELLOW}Stopping all instances...${NC}"
    "$SCRIPT_DIR/start-multi-frontends.sh" stop
    "$SCRIPT_DIR/start-multi-agents.sh" stop
    echo -e "${GREEN}All instances stopped${NC}"
}

status_all() {
    print_banner
    echo -e "${BLUE}System Status${NC}"
    echo ""
    
    echo -e "${YELLOW}Node Agent Backends:${NC}"
    "$SCRIPT_DIR/start-multi-agents.sh" status
    echo ""
    
    echo -e "${YELLOW}Frontend Instances:${NC}"
    "$SCRIPT_DIR/start-multi-frontends.sh" status
    echo ""
}

show_demo_info() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                        DEMO ACCESS                          ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}🌐 Frontend URLs:${NC}"
    echo -e "  Terminal 1: ${BLUE}http://127.0.0.1:5173${NC} → Backend: http://127.0.0.1:9876"
    echo -e "  Terminal 2: ${BLUE}http://127.0.0.1:5174${NC} → Backend: http://127.0.0.1:9877"
    echo -e "  Terminal 3: ${BLUE}http://127.0.0.1:5175${NC} → Backend: http://127.0.0.1:9878"
    echo ""
    echo -e "${GREEN}🔧 Backend APIs:${NC}"
    echo -e "  Node 1: ${BLUE}http://127.0.0.1:9876/health${NC}"
    echo -e "  Node 2: ${BLUE}http://127.0.0.1:9877/health${NC}"
    echo -e "  Node 3: ${BLUE}http://127.0.0.1:9878/health${NC}"
    echo ""
    echo -e "${GREEN}📡 WebSocket Endpoints:${NC}"
    echo -e "  Node 1: ${BLUE}ws://127.0.0.1:9876/session/ws${NC}"
    echo -e "  Node 2: ${BLUE}ws://127.0.0.1:9877/session/ws${NC}"
    echo -e "  Node 3: ${BLUE}ws://127.0.0.1:9878/session/ws${NC}"
    echo ""
    echo -e "${YELLOW}💡 Demo Features:${NC}"
    echo -e "  • Each frontend creates a unique session with terminal ID"
    echo -e "  • Real-time events via WebSocket connections"
    echo -e "  • Session management and monitoring"
    echo -e "  • Multi-terminal chat, file transfer, and video calls"
    echo -e "  • P2P discovery between all node instances"
    echo ""
    echo -e "${PURPLE}🎯 Testing Instructions:${NC}"
    echo -e "  1. Open all 3 frontend URLs in different browser tabs"
    echo -e "  2. Register different users in each tab"
    echo -e "  3. Check 'Nodes' panel to see peer discovery"
    echo -e "  4. Go to 'Settings' → 'Sessions' to see session info"
    echo -e "  5. Test chat, file transfer, and video calls between nodes"
    echo -e "  6. Monitor WebSocket events in real-time"
    echo ""
}

# Main command handling
case "${1:-help}" in
    "start")
        start_all
        ;;
        
    "stop")
        stop_all
        ;;
        
    "restart")
        echo -e "${YELLOW}Restarting all instances...${NC}"
        stop_all
        sleep 2
        start_all
        ;;
        
    "status")
        status_all
        ;;
        
    "clean")
        echo -e "${YELLOW}Cleaning up all data...${NC}"
        stop_all
        "$SCRIPT_DIR/start-multi-agents.sh" clean
        "$SCRIPT_DIR/start-multi-frontends.sh" clean
        echo -e "${GREEN}Cleanup complete${NC}"
        ;;
        
    "backends")
        shift
        "$SCRIPT_DIR/start-multi-agents.sh" "$@"
        ;;
        
    "frontends")
        shift
        "$SCRIPT_DIR/start-multi-frontends.sh" "$@"
        ;;
        
    "demo")
        print_banner
        show_demo_info
        ;;
        
    "help"|*)
        print_banner
        print_help
        ;;
esac