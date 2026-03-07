CREATE TABLE IF NOT EXISTS media_blobs (
    id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL REFERENCES peers(peer_id),
    transfer_id TEXT NOT NULL REFERENCES file_transfers(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('sender','receiver')),
    mime_type TEXT,
    size BIGINT NOT NULL,
    bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_peer ON media_blobs(peer_id);
CREATE INDEX IF NOT EXISTS idx_media_mime ON media_blobs(mime_type);

