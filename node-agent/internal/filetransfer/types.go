package filetransfer

import (
	"time"
)

// TransferStatus represents the current state of a file transfer
type TransferStatus string

const (
	StatusPending   TransferStatus = "pending"
	StatusSending   TransferStatus = "sending"
	StatusReceiving TransferStatus = "receiving"
	StatusCompleted TransferStatus = "completed"
	StatusFailed    TransferStatus = "failed"
	StatusCancelled TransferStatus = "cancelled"
)

// Metadata contains information about the file being transferred
type Metadata struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	MimeType string `json:"mime_type,omitempty"`
	Hash     string `json:"hash,omitempty"` // SHA-256 hash of the file content
	Sender   string `json:"sender"`         // PeerID of the sender
}

// MessageType defines the type of protocol message
type MessageType string

const (
	MsgOffer    MessageType = "offer"
	MsgAccept   MessageType = "accept"
	MsgReject   MessageType = "reject"
	MsgChunk    MessageType = "chunk"
	MsgAck      MessageType = "ack"
	MsgError    MessageType = "error"
	MsgComplete MessageType = "complete"
)

// BaseMessage is a wrapper for all protocol messages
type BaseMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload"`
}

// OfferPayload is sent by sender to propose a transfer
type OfferPayload struct {
	Metadata Metadata `json:"metadata"`
}

// AcceptPayload is sent by receiver to accept transfer
type AcceptPayload struct {
	TransferID string `json:"transfer_id"`
	Offset     int64  `json:"offset"` // Resume offset
}

// RejectPayload is sent by receiver to decline transfer
type RejectPayload struct {
	TransferID string `json:"transfer_id"`
	Reason     string `json:"reason"`
}

// ChunkPayload carries a part of file data
type ChunkPayload struct {
	TransferID string `json:"transfer_id"`
	Offset     int64  `json:"offset"`
	Data       []byte `json:"data"` // Will be base64 encoded in JSON
}

// AckPayload confirms receipt of data
type AckPayload struct {
	TransferID string `json:"transfer_id"`
	Offset     int64  `json:"offset"` // Next expected byte offset
}

// ErrorPayload indicates a protocol or transfer error
type ErrorPayload struct {
	TransferID string `json:"transfer_id"`
	Message    string `json:"message"`
}

// CompletePayload indicates transfer completion
type CompletePayload struct {
	TransferID string `json:"transfer_id"`
	Hash       string `json:"hash,omitempty"` // Final hash verification
}

// Transfer represents the internal state of a file transfer
type Transfer struct {
	ID             string         `json:"id"`
	PeerID         string         `json:"peer_id"` // Remote peer ID
	Role           string         `json:"role"`    // "sender" or "receiver"
	Metadata       Metadata       `json:"metadata"`
	Status         TransferStatus `json:"status"`
	LocalPath      string         `json:"local_path"` // Path on disk
	Offset         int64          `json:"offset"`     // Bytes transferred so far
	TotalSize      int64          `json:"total_size"`
	Error          string         `json:"error,omitempty"`
	StartTime      time.Time      `json:"start_time"`
	EndTime        time.Time      `json:"end_time,omitempty"`
}
