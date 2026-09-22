-- Run only against ariviso-preview and ariviso-diagnostics after public routes close.
INSERT OR IGNORE INTO auth_audit (id,user_id,action,created_at)
SELECT 'cutover:nonproduction-auth-disabled:' || id,id,'environment_disabled',
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM "user";
DELETE FROM session;
DELETE FROM verification;
DELETE FROM ingest_review_sessions;
UPDATE account SET accessToken=NULL,refreshToken=NULL,idToken=NULL,
                   accessTokenExpiresAt=NULL,refreshTokenExpiresAt=NULL
WHERE providerId='github';
