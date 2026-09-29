import type { ObjectStorage } from "./context.ts";

interface NativeTestStorage extends Omit<ObjectStorage, "get"> {
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

/** Bridge Miniflare's proxy stream declarations in tests that do not measure streaming. */
export function nativeTestStorage(store: NativeTestStorage): ObjectStorage {
  return {
    async get(key) {
      const stored = await store.get(key);
      if (!stored) return null;
      const bytes = await stored.arrayBuffer();
      const body = new Response(bytes).body;
      if (!body) throw new Error("The test object body is unavailable.");
      return {
        size: stored.size,
        body,
        async arrayBuffer() {
          return bytes;
        },
      };
    },
    head: (key) => store.head(key),
    list: (options) => store.list(options),
    put: (key, value, options) => store.put(key, value, options),
    delete: (key) => store.delete(key),
  };
}
