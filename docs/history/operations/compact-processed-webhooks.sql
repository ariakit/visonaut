UPDATE github_webhook_delivery
SET payload_json = '{}'
WHERE delivery_id IN (
  SELECT delivery_id
  FROM github_webhook_delivery
  WHERE processed_at IS NOT NULL AND event != 'pull_request' AND payload_json != '{}'
  ORDER BY delivery_id
  LIMIT 250
);
