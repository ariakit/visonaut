---
"@visonaut/web": patch
---

No receipt for a GitHub webhook that starts no work

The service now writes nothing to D1 for a GitHub webhook that can start no work. It checks the signature, the repository, and the installation as before. Then it writes one log line with the event name and the delivery ID, and it answers `202`. In the local D1 fixture, such a webhook needs 1 statement and writes 0 rows. Before, it needed 6 statements and wrote 4 rows.

```json
{
  "event": "webhook-no-work",
  "githubEvent": "check_run",
  "deliveryId": "0f2d4c1e-9a7b-4c3d-8e5f-6a1b2c3d4e5f"
}
```

These webhooks get no receipt:

- A `check_run` event that is not the successful end of the Submit job.
- A `push` event for a ref that is not `refs/heads/main`.
- A `ping` event.
- Each event that the service has no handler for.

The service stores each other webhook as before, with its receipt in the table `github_webhook_delivery`. It deletes no stored receipt.

No D1 row says that a webhook with no work arrived: the log line is its only record.

The delivery recovery no longer needs a receipt as the proof that a delivery arrived. When GitHub lists a delivery as failed, and later lists a successful delivery for the same ID, the recovery sends no more redelivery request for that ID and opens no alert for it. Before, only a receipt stopped the requests.

The Status page text for a delivery with no redelivery request left no longer asks for a receipt. It now says to verify that GitHub lists the new delivery as successful.
