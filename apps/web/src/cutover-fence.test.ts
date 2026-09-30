import { expect, test, vi } from "vitest";
import fence from "./cutover-fence.ts";

test("the temporary fence denies every HTTP path, including inward service requests", async () => {
  for (const origin of ["https://visonaut.com", "https://inward-service.test"]) {
    for (const [path, method] of [
      ["/api/auth/get-session", "GET"],
      ["/api/exports/retained-export", "GET"],
      ["/v1/webhooks", "POST"],
      ["/webhooks/github", "POST"],
      ["/v1/uploads/old-capability", "PUT"],
      ["/", "GET"],
    ]) {
      const response = fence.fetch(new Request(`${origin}${path}`, { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Retry-After")).toBe("60");
    }
  }
});

test("the temporary fence does no scheduled work", () => {
  expect(fence.scheduled()).toBeUndefined();
});

test("the temporary fence preserves delivered messages without acknowledgement", () => {
  const ackAll = vi.fn();
  const retryAll = vi.fn();
  const batch: MessageBatch<unknown> = {
    queue: "visonaut-production-operations",
    messages: [],
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll,
    retryAll,
  };
  fence.queue(batch);
  expect(retryAll).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
  expect(ackAll).not.toHaveBeenCalled();
});
