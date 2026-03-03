package runtime

import "time"

type Config struct {
	DataDir           string
	DisplayName       string
	Version           string
	Capabilities      []string
	ServiceName       string
	ListenPort        int
	HTTPAddr          string
	PresenceInterval  time.Duration
	ProtocolChat      string
	ProtocolFile      string
	ProtocolMediaSign string
	ProtocolPresence  string
}

func DefaultConfig() Config {
	return Config{
		DataDir:           "./data",
		DisplayName:       "node",
		Version:           "0.1.0",
		Capabilities:      []string{"chat", "file", "media"},
		ServiceName:       "nhex",
		ListenPort:        0,
		HTTPAddr:          "127.0.0.1:9876",
		PresenceInterval:  2 * time.Second,
		ProtocolChat:      "/nhex/chat/1.0.0",
		ProtocolFile:      "/nhex/file/1.0.0",
		ProtocolMediaSign: "/nhex/media-signal/1.0.0",
		ProtocolPresence:  "/nhex/presence/1.0.0",
	}
}
