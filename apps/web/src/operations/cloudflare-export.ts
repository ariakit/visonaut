import type { DatabaseExporter } from "./backups.ts";

interface ExportConfiguration {
  accountId: string;
  databaseId: string;
  apiToken: string;
  maximumMilliseconds: number;
  request?: typeof fetch;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Cloudflare returned an invalid export response.");
  return value as Record<string, unknown>;
}

/** D1 exports are polled without D1 queries, which the export temporarily blocks. */
export function createCloudflareDatabaseExporter(
  configuration: ExportConfiguration,
): DatabaseExporter {
  if (
    !/^[a-f0-9]{32}$/iu.test(configuration.accountId) ||
    !/^[a-f0-9-]{36}$/iu.test(configuration.databaseId) ||
    !configuration.apiToken ||
    !Number.isSafeInteger(configuration.maximumMilliseconds) ||
    configuration.maximumMilliseconds < 1
  )
    throw new Error("Invalid database export configuration.");
  const request = configuration.request ?? fetch;
  return {
    async export() {
      const signal = AbortSignal.timeout(configuration.maximumMilliseconds);
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/d1/database/${configuration.databaseId}/export`;
      let bookmark: string | undefined;
      while (true) {
        const response = await request(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${configuration.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ output_format: "polling", current_bookmark: bookmark }),
          redirect: "manual",
          signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Cloudflare database export failed.");
        }
        const envelope = object(await response.json());
        const result = object(envelope.result);
        if (envelope.success !== true || result.status === "error")
          throw new Error("Cloudflare database export failed.");
        if (result.status === "complete") {
          const details = object(result.result);
          if (typeof details.signed_url !== "string")
            throw new Error("Cloudflare export URL is missing.");
          const url = new URL(details.signed_url);
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error("Cloudflare export URL is invalid.");
          // The authenticated API supplies this one-time URL. No API token follows it.
          const download = await request(url, { redirect: "manual", signal });
          if (!download.ok || !download.body) {
            await download.body?.cancel();
            throw new Error("Cloudflare database download failed.");
          }
          const length = download.headers.get("content-length");
          const encoding = download.headers.get("content-encoding");
          const bytes =
            length && /^\d+$/.test(length) && (!encoding || encoding === "identity")
              ? Number(length)
              : undefined;
          return { body: download.body, bytes: Number.isSafeInteger(bytes) ? bytes : undefined };
        }
        if (typeof result.at_bookmark !== "string" || !result.at_bookmark)
          throw new Error("Cloudflare export bookmark is missing.");
        bookmark = result.at_bookmark;
        await new Promise<void>((resolve, reject) => {
          signal.throwIfAborted();
          const timer = setTimeout(done, 1000);
          function done() {
            signal.removeEventListener("abort", abort);
            resolve();
          }
          function abort() {
            clearTimeout(timer);
            reject(new Error("Database export timed out."));
          }
          signal.addEventListener("abort", abort, { once: true });
        });
      }
    },
  };
}
