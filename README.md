# P2P Connection System - СВЯЗЬ

A decentralized peer-to-peer communication platform with multi-terminal support, built for secure, serverless communication.

## 🚀 Features

- **P2P Communication**: Direct peer-to-peer messaging without central servers
- **Multi-Terminal Support**: Multiple UI instances connecting to the same node
- **Real-time Events**: WebSocket-based event streaming
- **Session Management**: Track and manage multiple terminal sessions
- **File Transfers**: Secure P2P file sharing with resume support
- **Video Calls**: WebRTC-based audio/video calling
- **Auto-Discovery**: mDNS-based peer discovery on local networks
- **End-to-End Encryption**: Secure communication with libp2p

## 🏗️ Architecture

### Backend (Go)
- **libp2p**: P2P networking and protocols
- **WebSocket**: Real-time event streaming
- **mDNS**: Automatic peer discovery
- **Session Management**: Multi-terminal support
- **File Transfer**: Chunked transfer with resume
- **Media Signaling**: WebRTC call coordination

### Frontend (React)
- **React + TypeScript**: Modern UI framework
- **WebSocket Client**: Real-time event handling
- **WebRTC**: Direct media communication
- **Session Hooks**: Terminal session management
- **Responsive Design**: Mobile and desktop support

## 🚀 Quick Start

### Option 1: Multi-Terminal Demo (Recommended)

Start 3 node-agents and 3 frontends with one command:

```bash
# Start everything
./scripts/multi-terminal-demo.sh start

# View access URLs and instructions
./scripts/multi-terminal-demo.sh demo

# Check status
./scripts/multi-terminal-demo.sh status

# Stop everything
./scripts/multi-terminal-demo.sh stop
```

### Option 2: Single Instance

**Start Backend:**
```bash
cd node-agent
go run . -name "MyNode" -http "127.0.0.1:9876"
```

**Start Frontend:**
```bash
npm install
npm run dev
```

Access at: http://localhost:5173

## 🖥️ Multi-Terminal Usage

The system supports multiple terminal sessions connecting to the same node-agent:

### Access URLs
- **Terminal 1**: http://127.0.0.1:5173 → Backend: http://127.0.0.1:9876
- **Terminal 2**: http://127.0.0.1:5174 → Backend: http://127.0.0.1:9877  
- **Terminal 3**: http://127.0.0.1:5175 → Backend: http://127.0.0.1:9878

### Session Features
- **Unique Terminal IDs**: Each UI gets a unique session identifier
- **Real-time Events**: WebSocket-based event streaming
- **Session Monitoring**: View all active sessions in Settings → Sessions
- **Event Broadcasting**: Events sent to specific sessions or all sessions
- **Automatic Cleanup**: Inactive sessions removed after 5 minutes

### Testing Multi-Terminal
1. Open multiple browser tabs with different URLs
2. Register different users in each tab
3. Check peer discovery in Nodes panel
4. Test chat, file transfer, and video calls between terminals
5. Monitor real-time events in Settings → Sessions

## 📡 API Endpoints

### Node Management
- `GET /health` - Node health and uptime
- `GET /identity` - Peer ID and addresses
- `GET /presence` - Self presence information
- `GET /presence/peers` - All discovered peers

### Session Management
- `POST /session/create` - Create new terminal session
- `GET /session/ws` - WebSocket upgrade endpoint
- `GET /sessions` - List all active sessions

### Communication
- `POST /chat/send` - Send message to peer
- `GET /chat/history` - Retrieve message history
- `POST /files/send` - Upload file to peer
- `GET /files/transfers` - List file transfers

### Media (WebRTC)
- `POST /media/call` - Initiate call
- `POST /media/answer` - Accept call
- `POST /media/candidate` - Send ICE candidate
- `POST /media/hangup` - End call
- `GET /media/events` - Poll for events (legacy)

## 🔧 Configuration

### Environment Variables
- `VITE_NODE_AGENT_URL`: Backend URL (default: http://127.0.0.1:9876)

### Node Agent Options
```bash
go run . [options]
  -name string        Display name for the node
  -p2p-port int       P2P listening port (default: 9001)
  -http string        HTTP API address (default: 127.0.0.1:9876)
  -data-dir string    Data directory path (default: ./data)
  -db string          PostgreSQL connection string (optional)
```

## 🛠️ Development

### Prerequisites
- **Go 1.21+**: For node-agent backend
- **Node.js 18+**: For React frontend
- **npm/yarn**: Package manager

### Backend Development
```bash
cd node-agent
go mod tidy
go run . -name "DevNode"
```

### Frontend Development
```bash
npm install
npm run dev
```

### Building
```bash
# Backend
cd node-agent
go build -o node-agent .

# Frontend
npm run build
```

## 📚 Documentation

- **[Multi-Terminal Guide](docs/MULTI_TERMINAL_GUIDE.md)**: Detailed multi-terminal setup and usage
- **[P2P LAN Plan](docs/P2P_LAN_PLAN.md)**: Technical architecture overview
- **[Status](docs/STATUS.md)**: Current implementation status
- **[Work Plan](docs/WORKPLAN.md)**: Development roadmap

## 🔍 Monitoring & Debugging

### Session Diagnostics
- **Settings → Sessions**: View session information and events
- **Browser Console**: WebSocket connection status
- **API Health**: Check `/health` endpoints

### Debug Commands
```bash
# Check all processes
./scripts/multi-terminal-demo.sh status

# Clean up everything
./scripts/multi-terminal-demo.sh clean

# Test API connectivity
curl http://127.0.0.1:9876/sessions
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with multi-terminal setup
5. Submit a pull request

## 📄 License

This project is built for educational purposes as part of NuclearHack МИФИ.

## 🎯 Project Goals

- **Serverless Communication**: No central servers or accounts required
- **Privacy First**: End-to-end encryption and local data storage
- **Multi-Terminal**: Support multiple UI instances per node
- **Real-time**: WebSocket-based event streaming
- **P2P Native**: Direct peer-to-peer connections

---

*"Без серверов. Без аккаунтов. Без компромиссов."*
