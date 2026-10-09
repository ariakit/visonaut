// Measures when the bytes of the document arrive, against the time of the run
// list. It needs the local backend with the route of `probe.patch`. See the
// README of this folder.
const [origin, delay = "1500", encoding = "identity"] = process.argv.slice(2);
if (!origin) {
  throw new Error("Usage: node probe.mjs <origin> [added wait in ms] [Accept-Encoding]");
}

// The local backend gives the signed session of the local maintainer here.
const signIn = await fetch(`${origin}/local/sign-in`, { redirect: "manual" });
const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
if (!cookie) {
  throw new Error("The local sign-in route gave no session cookie.");
}

async function load(session) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const response = await fetch(`${origin}/?delay=${delay}`, {
    headers: { "accept-encoding": encoding, ...(session ? { cookie } : {}) },
  });
  const headersMs = elapsed();
  if (!response.body) {
    throw new Error("The document has no body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let firstByteMs = null;
  let firstBytes = null;
  let listMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    firstByteMs ??= elapsed();
    firstBytes ??= value.length;
    // The patched loader puts this marker into its answer.
    if (listMs == null && text.includes("RUN_LIST_PROBE")) {
      listMs = elapsed();
    }
  }
  const read = /readMs:(\d+)/.exec(text)?.[1];
  return {
    session,
    encoding,
    addedWaitMs: Number(delay),
    status: response.status,
    headersMs,
    firstByteMs,
    firstBytes,
    listMs,
    endMs: elapsed(),
    serverReadMs: read == null ? null : Number(read),
    bytes: text.length,
  };
}

for (const session of [true, false]) {
  for (let round = 0; round < 3; round++) {
    console.log(JSON.stringify(await load(session)));
  }
}
