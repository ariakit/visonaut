CREATE TABLE ariviso_capture_profiles (
  digest TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json) AND json_type(profile_json) = 'object')
);
CREATE INDEX ariviso_captures_profile_digest ON ariviso_captures(profile_digest);
-- Dictionary cleanup and capture insertion serialize in D1. A removed staging
-- profile forces the upload retry to register it again before linking a capture.
CREATE TRIGGER ariviso_capture_profile_insert BEFORE INSERT ON ariviso_captures WHEN json_type(NEW.metadata_json,'$.profile.$arivisoProfileDigest') IS NOT NULL AND (json_type(NEW.metadata_json,'$.profile.$arivisoProfileDigest')<>'text' OR json_extract(NEW.metadata_json,'$.profile.$arivisoProfileDigest')<>NEW.profile_digest OR NOT EXISTS(SELECT 1 FROM ariviso_capture_profiles WHERE digest=NEW.profile_digest)) BEGIN SELECT RAISE(ABORT,'Capture profile reference unavailable'); END;
CREATE TRIGGER ariviso_capture_profile_update BEFORE UPDATE OF metadata_json,profile_digest ON ariviso_captures WHEN json_type(NEW.metadata_json,'$.profile.$arivisoProfileDigest') IS NOT NULL AND (json_type(NEW.metadata_json,'$.profile.$arivisoProfileDigest')<>'text' OR json_extract(NEW.metadata_json,'$.profile.$arivisoProfileDigest')<>NEW.profile_digest OR NOT EXISTS(SELECT 1 FROM ariviso_capture_profiles WHERE digest=NEW.profile_digest)) BEGIN SELECT RAISE(ABORT,'Capture profile reference unavailable'); END;
