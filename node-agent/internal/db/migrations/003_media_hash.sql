ALTER TABLE media_blobs ADD COLUMN IF NOT EXISTS file_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_media_file_hash ON media_blobs(file_hash);

