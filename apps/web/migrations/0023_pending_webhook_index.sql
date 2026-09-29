CREATE INDEX github_webhook_delivery_pending
ON github_webhook_delivery(last_attempt_at, received_at)
WHERE processed_at IS NULL;
