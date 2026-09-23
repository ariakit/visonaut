import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
const endpoint = process.env.VISONAUT_PROBE_ORIGIN;
if (!endpoint || new URL(endpoint).protocol !== "https:")
  throw new Error("Set VISONAUT_PROBE_ORIGIN to the new disposable Worker HTTPS origin");
const token = (await readFile(new URL(".probe-token", import.meta.url), "utf8")).trim();
const root = new URL("results/", import.meta.url);
await mkdir(root, { recursive: true });
async function call(path, body) {
  const startedAt = Date.now();
  const response = await fetch(endpoint + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  await appendFile(
    new URL("events.jsonl", root),
    JSON.stringify({
      path,
      status: response.status,
      startedAt,
      milliseconds: Date.now() - startedAt,
      data,
    }) + "\n",
  );
  if (!response.ok) throw new Error(JSON.stringify({ path, status: response.status, data }));
  return data;
}
const unauthorized = await fetch(endpoint + "/report");
if (unauthorized.status !== 401)
  throw new Error("Private report does not reject unauthenticated access");
await writeFile(
  new URL("access.json", root),
  JSON.stringify({ unauthenticatedStatus: unauthorized.status, at: Date.now() }, null, 2),
);
const prepared = await call("/prepare", {});
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, prepared.abandonedLeaseUntil - Date.now() + 100)),
);
const lost = await call("/reconcile", { failPublication: true });
if (lost.publication.failed.length !== 4 || lost.alerts.events.length !== 4)
  throw new Error("Lost publications were not persisted and exposed privately");
const finalization = await call("/finalize", { failCommit: true });
if (finalization.finalization.errors.length !== 1)
  throw new Error("Injected finalization failure not observed");
const empty = await call("/report");
if (
  empty.tasks.some(
    (task) => task.id === "lost:row" && (task.state !== "queued" || task.attempts !== 0),
  )
)
  throw new Error("Lost work did not remain durable");
await call("/reconcile", { failPublication: false });
await call("/duplicates", {});
await call("/poison", {});
const started = Date.now();
let terminal;
while (Date.now() - started < 180000) {
  const report = await call("/report");
  if (
    report.tasks.filter((t) => t.state === "complete").length === 3 &&
    report.tasks.find((t) => t.id === "bounded:row")?.state === "dead" &&
    report.deadLetters.length === 1
  ) {
    terminal = report;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!terminal) throw new Error("Queue controls did not converge in three minutes");
const exhausted = terminal.tasks.find((task) => task.id === "bounded:row");
if (exhausted.attempts !== 3) throw new Error("Durable retry bound differs");
if (terminal.tasks.find((task) => task.id === "expired:row")?.attempts !== 2)
  throw new Error("Expired lease did not recover exactly once");
if (terminal.tasks.find((task) => task.id === "duplicate:row")?.attempts !== 1)
  throw new Error("Duplicate delivery changed work ownership");
if (
  !terminal.privateStatus.events.some(
    (e) => e.kind === "comparison-task" && e.subject === "bounded",
  )
)
  throw new Error("Exhausted task has no private escalation");
if (terminal.deliveries.filter((d) => d.action === "transport-retry").length !== 3)
  throw new Error("Transport retry bound differs");
const stale = await call("/stale", {});
if (stale.accepted || stale.task.result !== "queue-control-success")
  throw new Error("Stale result changed durable work");
await writeFile(new URL("before-recovery.json", root), JSON.stringify(terminal, null, 2));
const finalized = await call("/finalize", { failCommit: false });
if (!finalized.finalization.completed.includes("finalization"))
  throw new Error("Finalization gap was not recovered");
await call("/recover", {});
let recovered;
while (Date.now() - started < 240000) {
  const report = await call("/report");
  if (
    report.tasks.find((t) => t.id === "bounded-replacement:row")?.state === "complete" &&
    report.privateStatus.events.length === 0
  ) {
    recovered = report;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!recovered || recovered.foreignKeys.length)
  throw new Error("Recovery failed or lost integrity");
await writeFile(
  new URL("result.json", root),
  JSON.stringify(
    {
      startedAt: started,
      completedAt: Date.now(),
      milliseconds: Date.now() - started,
      limitations: [
        "Controlled queue work and empty-inventory finalization fixture; no comparator/capture correctness claim.",
        "Injected publisher and batch failures occur before external send/commit; durable state and real Queue/D1 delivery are measured.",
        "Diagnostic Queue retries1s/max_retries2 and durableworkmaxAttempts3; production delay/lease policy differs.",
        "Explicit fixture supersession creates new replacement work; no production task is silently reactivated.",
      ],
      recovered,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    complete: true,
    tasks: recovered.tasks.map(({ id, state, attempts }) => ({ id, state, attempts })),
    deadLetters: recovered.deadLetters.length,
    events: recovered.privateStatus.events.length,
  }),
);
