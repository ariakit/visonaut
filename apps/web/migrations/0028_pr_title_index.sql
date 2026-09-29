CREATE INDEX github_webhook_delivery_pr_title
ON github_webhook_delivery (
  CAST(json_extract(payload_json, '$.repository.id') AS TEXT),
  json_extract(payload_json, '$.pull_request.number'),
  received_at DESC
)
WHERE event = 'pull_request';
