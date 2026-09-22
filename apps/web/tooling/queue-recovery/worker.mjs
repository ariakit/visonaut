import { timingSafeEqual } from "node:crypto";
import {
  claimWork,
  completeWork,
  enqueueWork,
  failWork,
  getWork,
  reconcileWork,
  Service,
} from "../../../../packages/service/src/index.ts";
import { reportComparisonRecovery } from "../../src/operations/comparison-alerts.ts";
import { operationsStatus } from "../../src/api/operations.ts";
const noPublication = { published: [], failed: [] };
const noFinalization = { completed: [], errors: [] };
const context = (env) => ({ database: env.DB, now: Date.now, budget: { tasksPerStep: 20 } });
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function createFixture(env, id, mode = "success") {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ariviso_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,sealed_at,comparison_id,created_at) VALUES(?,'probe',?,1,'pull_request','probe-sha',?,'probe-plan','{}','comparing',?,?,?)",
    ).bind(id, id, id, now, id, now),
    env.DB.prepare(
      "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES(?,?,0,'probe-policy',1,?)",
    ).bind(id, id, now),
    env.DB.prepare(
      "INSERT INTO ariviso_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json) VALUES(?,?,'queue-control','default',0,'{}')",
    ).bind(`${id}:row`, id),
  ]);
  await enqueueWork(env.DB, {
    id: `${id}:row`,
    kind: "compare",
    payload: JSON.stringify({ mode }),
    maxAttempts: 3,
    now,
  });
}
async function delivery(env, message, action) {
  await env.DB.prepare(
    "INSERT INTO probe_deliveries(task_id,message_id,transport_attempt,action,at) VALUES(?,?,?,?,?)",
  )
    .bind(message.body?.taskId ?? null, message.id, message.attempts, action, Date.now())
    .run();
}
export default {
  async fetch(request, env) {
    if (typeof env.PROBE_TOKEN !== "string" || env.PROBE_TOKEN.length < 64)
      return json({ error: "unconfigured" }, 503);
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${env.PROBE_TOKEN}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return json({ error: "unauthorized" }, 401);
    const url = new URL(request.url);
    try {
      if (url.pathname === "/prepare" && request.method === "POST") {
        if (await env.DB.prepare("SELECT id FROM ariviso_projects LIMIT 1").first())
          throw new Error("Probe already prepared");
        await env.DB.prepare(
          "INSERT INTO ariviso_projects(id,repository_id,policy_digest) VALUES('probe','disposable-probe','probe-policy')",
        ).run();
        for (const [id, mode] of [
          ["lost", "success"],
          ["expired", "success"],
          ["bounded", "fail"],
          ["duplicate", "success"],
        ])
          await createFixture(env, id, mode);
        const abandoned = await claimWork(env.DB, {
          id: "expired:row",
          token: "abandoned-owner",
          now: Date.now(),
          leaseMs: 1000,
        });
        if (!abandoned || abandoned.attempts !== 1)
          throw new Error("Expired-lease control was not claimed");
        // Empty inventory is only a control for finalization failure. It proves no visual pixels.
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO ariviso_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,sealed_at,comparison_id,created_at) VALUES('finalization','probe','finalization',1,'pull_request','probe-sha','finalization','probe-plan','{}','comparing',?,'finalization',?)",
          ).bind(Date.now(), Date.now()),
          env.DB.prepare(
            "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES('finalization','finalization',0,'probe-policy',1,?)",
          ).bind(Date.now()),
        ]);
        return json({
          prepared: true,
          workloads: 4,
          abandonedLeaseUntil: abandoned.lease_until,
          finalizationControl: "empty synthetic inventory; no image correctness claim",
        });
      }
      if (url.pathname === "/reconcile" && request.method === "POST") {
        const input = await request.json();
        const publication = await reconcileWork(env.DB, {
          now: Date.now(),
          limit: 20,
          kind: "compare",
          publish: async (taskId) => {
            if (input.failPublication)
              throw new Error("Injected publisher outage before Queue send");
            await env.WORK.send({ taskId });
          },
        });
        await reportComparisonRecovery(context(env), publication, noFinalization);
        return json({
          publication,
          alerts: await operationsStatus({
            database: env.DB,
            projectId: "probe",
            repositoryId: "disposable-probe",
          }),
        });
      }
      if (url.pathname === "/finalize" && request.method === "POST") {
        const input = await request.json();
        const database = {
          prepare: env.DB.prepare.bind(env.DB),
          batch: input.failCommit
            ? async () => {
                throw new Error("Injected finalization batch outage before commit");
              }
            : env.DB.batch.bind(env.DB),
        };
        const finalization = await new Service(database).reconcileComparisons({
          now: Date.now(),
          limit: 20,
        });
        await reportComparisonRecovery(context(env), noPublication, finalization);
        return json({
          finalization,
          alerts: await operationsStatus({
            database: env.DB,
            projectId: "probe",
            repositoryId: "disposable-probe",
          }),
        });
      }
      if (url.pathname === "/duplicates" && request.method === "POST") {
        await env.WORK.sendBatch(
          Array.from({ length: 8 }, () => ({ body: { taskId: "duplicate:row" } })),
        );
        return json({ sent: 8 });
      }
      if (url.pathname === "/poison" && request.method === "POST") {
        await env.WORK.send({ poison: true, id: "transport-poison" });
        return json({ sent: true });
      }
      if (url.pathname === "/recover" && request.method === "POST") {
        await env.DB.prepare(
          "UPDATE ariviso_runs SET active=0,state='superseded' WHERE id='bounded'",
        ).run();
        await createFixture(env, "bounded-replacement", "success");
        await env.WORK.send({ taskId: "bounded-replacement:row" });
        await reportComparisonRecovery(context(env), noPublication, noFinalization);
        return json({ replacement: "bounded-replacement:row" });
      }
      if (url.pathname === "/stale" && request.method === "POST") {
        const accepted = await completeWork(env.DB, {
          id: "expired:row",
          token: "abandoned-owner",
          now: Date.now(),
          result: "stale-overwrite",
        });
        return json({ accepted, task: await getWork(env.DB, "expired:row") });
      }
      if (url.pathname === "/report") {
        await reportComparisonRecovery(context(env), noPublication, noFinalization);
        return json({
          tasks: (
            await env.DB.prepare(
              "SELECT id,kind,state,attempts,max_attempts,result,last_error FROM work_tasks ORDER BY id",
            ).all()
          ).results,
          deliveries: (await env.DB.prepare("SELECT * FROM probe_deliveries ORDER BY id").all())
            .results,
          deadLetters: (await env.DB.prepare("SELECT * FROM probe_dlq ORDER BY id").all()).results,
          events: (await env.DB.prepare("SELECT * FROM operations_events ORDER BY id").all())
            .results,
          privateStatus: await operationsStatus({
            database: env.DB,
            projectId: "probe",
            repositoryId: "disposable-probe",
          }),
          foreignKeys: (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
          checkedAt: Date.now(),
        });
      }
      return json({ error: "unknown" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (batch.queue === env.DEAD_LETTER_QUEUE_NAME) {
        await env.DB.prepare(
          "INSERT INTO probe_dlq(id,transport_attempt,body_json,received_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
          .bind(
            message.body.id ?? message.id,
            message.attempts,
            JSON.stringify(message.body),
            Date.now(),
          )
          .run();
        message.ack();
        continue;
      }
      if (message.body?.poison) {
        await delivery(env, message, "transport-retry");
        message.retry({ delaySeconds: 1 });
        continue;
      }
      const taskId = message.body?.taskId;
      const owner = crypto.randomUUID();
      const task = await claimWork(env.DB, {
        id: taskId,
        token: owner,
        now: Date.now(),
        leaseMs: 30_000,
      });
      if (!task) {
        const state = await getWork(env.DB, taskId);
        if (state?.state === "complete" || state?.state === "dead") {
          await delivery(env, message, "terminal-duplicate");
          message.ack();
        } else {
          await delivery(env, message, "lease-busy");
          message.retry({ delaySeconds: 1 });
        }
        continue;
      }
      if (JSON.parse(task.payload).mode === "fail") {
        await failWork(env.DB, {
          id: taskId,
          token: owner,
          now: Date.now(),
          retryAt: Date.now() + 1000,
          error: "injected-recoverable-storage-outage",
        });
        const failed = await getWork(env.DB, taskId);
        await delivery(env, message, failed.state === "dead" ? "durable-dead" : "durable-retry");
        await reportComparisonRecovery(context(env), noPublication, noFinalization);
        if (failed.state === "dead") message.ack();
        else message.retry({ delaySeconds: 1 });
      } else {
        const committed = await completeWork(env.DB, {
          id: taskId,
          token: owner,
          now: Date.now(),
          result: "queue-control-success",
        });
        if (!committed) throw new Error("Completion lost its lease");
        await delivery(env, message, "committed");
        message.ack();
      }
    }
  },
};
