package media

import (
	"encoding/json"
)

// SignalType defines the type of WebRTC signaling message
type SignalType string

const (
	SignalOffer     SignalType = "offer"
	SignalAnswer    SignalType = "answer"
	SignalICECandidate SignalType = "ice-candidate"
	SignalHangup    SignalType = "hangup"
)

// SignalMessage is the envelope for signaling data
type SignalMessage struct {
	Type    SignalType      `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// CallState represents the state of a call
type CallState string

const (
	CallIdle      CallState = "idle"
	CallIncoming  CallState = "incoming"
	CallOutgoing  CallState = "outgoing"
	CallConnected CallState = "connected"
	CallEnded     CallState = "ended"
)

type CallType string

const (
	CallTypeAudio CallType = "audio"
	CallTypeVideo CallType = "video"
)

type Call struct {
	ID        string    `json:"id"`
	PeerID    string    `json:"peer_id"`
	Direction string    `json:"direction"` // "incoming" or "outgoing"
	State     CallState `json:"state"`
	Type      CallType  `json:"type"`      // "audio" or "video"
	StartTime int64     `json:"start_time"`
}

// OfferPayload represents SDP Offer
type OfferPayload struct {
	SDP  string   `json:"sdp"`
	Type CallType `json:"type,omitempty"`
}

// AnswerPayload represents SDP Answer
type AnswerPayload struct {
	SDP string `json:"sdp"`
}

// ICECandidatePayload represents an ICE candidate
type ICECandidatePayload struct {
	Candidate     string `json:"candidate"`
	SDPMid        string `json:"sdpMid,omitempty"`
	SDPMLineIndex int    `json:"sdpMLineIndex,omitempty"`
}
