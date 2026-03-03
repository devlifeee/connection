package identity

import (
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"

	"github.com/libp2p/go-libp2p/core/crypto"
)

func LoadOrCreatePrivateKey(path string) (crypto.PrivKey, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		k, err := crypto.UnmarshalPrivateKey(b)
		if err != nil {
			return nil, err
		}
		return k, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	k, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}
	mb, err := crypto.MarshalPrivateKey(k)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, mb, 0o600); err != nil {
		return nil, err
	}
	return k, nil
}
