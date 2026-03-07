package media

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

const ProtocolID = protocol.ID("/nhex/media-signal/1.0.0")

type SignalHandler interface {
	OnIncomingCall(call *Call, sdp string)
	OnCallAccepted(call *Call, sdp string)
	OnICECandidate(callID string, candidate ICECandidatePayload)
	OnHangup(callID string)
}

type Manager struct {
	host     host.Host
	calls    map[string]*Call
	streams  map[string]network.Stream // Active signaling streams
	mu       sync.RWMutex
 	handler  SignalHandler // Callback to API/Frontend
	acceptOffer func(peerID string, callType CallType) bool
}

func NewManager(h host.Host) *Manager {
	return &Manager{
		host:    h,
		calls:   make(map[string]*Call),
		streams: make(map[string]network.Stream),
	}
}

func (m *Manager) SetHandler(h SignalHandler) {
	m.handler = h
}

func (m *Manager) SetAcceptOfferFilter(fn func(peerID string, callType CallType) bool) {
	m.acceptOffer = fn
}

func (m *Manager) Start() {
	m.host.SetStreamHandler(ProtocolID, m.handleStream)
}

func (m *Manager) GetCalls() []*Call {
	m.mu.RLock()
	defer m.mu.RUnlock()
	calls := make([]*Call, 0, len(m.calls))
	for _, c := range m.calls {
		val := *c
		calls = append(calls, &val)
	}
	return calls
}

// GetCall returns a copy of the call by id
func (m *Manager) GetCall(id string) *Call {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if c, ok := m.calls[id]; ok && c != nil {
		val := *c
		return &val
	}
	return nil
}

// InitiateCall starts an outgoing call
func (m *Manager) InitiateCall(ctx context.Context, peerID string, offerSDP string, callType CallType) (*Call, error) {
	pid, err := peer.Decode(peerID)
	if err != nil {
		return nil, err
	}

	stream, err := m.host.NewStream(ctx, pid, ProtocolID)
	if err != nil {
		return nil, err
	}

	callID := uuid.New().String()
	call := &Call{
		ID:        callID,
		PeerID:    peerID,
		Direction: "outgoing",
		State:     CallOutgoing,
		Type:      callType,
		StartTime: time.Now().Unix(),
	}

	m.mu.Lock()
	m.calls[callID] = call
	m.streams[callID] = stream
	m.mu.Unlock()

	// Send Offer
	offer := OfferPayload{SDP: offerSDP, Type: callType}
	payload, _ := json.Marshal(offer)
	msg := SignalMessage{Type: SignalOffer, Payload: payload}

	if err := writeJSON(stream, msg); err != nil {
		m.EndCall(callID)
		return nil, err
	}

	// Start reading loop for this stream
	go m.readLoop(stream, callID)

	return call, nil
}

// AcceptCall sends an answer to an incoming call
func (m *Manager) AcceptCall(callID string, answerSDP string) error {
	m.mu.RLock()
	stream, ok := m.streams[callID]
	call, callOk := m.calls[callID]
	m.mu.RUnlock()

	if !ok || !callOk {
		return log.Output(1, "call not found") // simplify error
	}

	answer := AnswerPayload{SDP: answerSDP}
	payload, _ := json.Marshal(answer)
	msg := SignalMessage{Type: SignalAnswer, Payload: payload}

	if err := writeJSON(stream, msg); err != nil {
		return err
	}

	m.mu.Lock()
	call.State = CallConnected
	m.mu.Unlock()

	return nil
}

// SendCandidate sends an ICE candidate
func (m *Manager) SendCandidate(callID string, candidate ICECandidatePayload) error {
	m.mu.RLock()
	stream, ok := m.streams[callID]
	m.mu.RUnlock()

	if !ok {
		return nil
	}

	payload, _ := json.Marshal(candidate)
	msg := SignalMessage{Type: SignalICECandidate, Payload: payload}
	return writeJSON(stream, msg)
}

// EndCall terminates a call
func (m *Manager) EndCall(callID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if stream, ok := m.streams[callID]; ok {
		// Send hangup best effort
		msg := SignalMessage{Type: SignalHangup}
		writeJSON(stream, msg)
		stream.Close()
		delete(m.streams, callID)
	}

	if call, ok := m.calls[callID]; ok {
		call.State = CallEnded
	}
}

func (m *Manager) handleStream(stream network.Stream) {
	// Incoming call (Offer)
	rw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))
	
	// Read first message which MUST be Offer
	line, err := rw.ReadBytes('\n')
	if err != nil {
		stream.Close()
		return
	}

	var msg SignalMessage
	if err := json.Unmarshal(line, &msg); err != nil || msg.Type != SignalOffer {
		stream.Close()
		return
	}

	var offer OfferPayload
	if err := json.Unmarshal(msg.Payload, &offer); err != nil {
		stream.Close()
		return
	}

	peerID := stream.Conn().RemotePeer().String()
	callType := offer.Type
	if callType == "" {
		callType = CallTypeAudio
	}
	if m.acceptOffer != nil && !m.acceptOffer(peerID, callType) {
		_ = stream.Close()
		return
	}

	callID := uuid.New().String() // In real world, offer should contain ID or we generate one
	// But since stream is 1:1 for call, we can generate local ID mapping.
	// Actually, let's keep it simple.

	// peerID and callType computed above

	call := &Call{
		ID:        callID,
		PeerID:    peerID,
		Direction: "incoming",
		State:     CallIncoming,
		Type:      callType,
		StartTime: time.Now().Unix(),
	}

	m.mu.Lock()
	m.calls[callID] = call
	m.streams[callID] = stream
	m.mu.Unlock()

	if m.handler != nil {
		m.handler.OnIncomingCall(call, offer.SDP)
	}
	
	go m.readLoop(stream, callID)
}

func (m *Manager) readLoop(stream network.Stream, callID string) {
	defer m.EndCall(callID)
	r := bufio.NewReader(stream)

	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			return
		}

		var msg SignalMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case SignalAnswer:
			var answer AnswerPayload
			if err := json.Unmarshal(msg.Payload, &answer); err == nil {
				m.mu.Lock()
				call := m.calls[callID]
				if call != nil {
					call.State = CallConnected
				}
				m.mu.Unlock()
				if m.handler != nil {
					if call != nil {
						m.handler.OnCallAccepted(call, answer.SDP)
					}
				}
			}
		case SignalICECandidate:
			var ice ICECandidatePayload
			if err := json.Unmarshal(msg.Payload, &ice); err == nil {
				if m.handler != nil {
					m.handler.OnICECandidate(callID, ice)
				}
			}
		case SignalHangup:
			if m.handler != nil {
				m.handler.OnHangup(callID)
			}
			return // Close loop
		}
	}
}

func writeJSON(s network.Stream, msg interface{}) error {
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = s.Write(append(b, '\n'))
	return err
}
