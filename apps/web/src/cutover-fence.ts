// Temporary entrypoint for the existing web Worker during data conversion.
// It must not import application code or read any binding.
export default {
  fetch(_request: Request) {
    return new Response("Visonaut is temporarily unavailable during maintenance.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  },
  scheduled() {},
  queue(batch: MessageBatch<unknown>) {
    // Pause delivery before deployment; preserve any batch already delivered.
    batch.retryAll({ delaySeconds: 60 });
  },
} satisfies ExportedHandler;
