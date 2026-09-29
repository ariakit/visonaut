import { ImageValidationError } from "@visonaut/compare";
import {
  ConflictError,
  IncompleteError,
  recoverDeadLetteredComparison,
  reportComparisonPublication,
  Service,
} from "@visonaut/service";
import { codecsReady } from "./codecs.ts";
import { processComparisonTask } from "./process.ts";
import { CodecBusyError, withCodecCapacity } from "./capacity.ts";
import { validateRequest } from "./validate.ts";

interface ComparisonMessage {
  taskId: string;
  publicationAttempt?: number;
}

function validMessage(value: unknown): value is ComparisonMessage {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "taskId")) return false;
  return (
    "taskId" in value &&
    typeof value.taskId === "string" &&
    value.taskId.length > 0 &&
    value.taskId.length < 512 &&
    (!("publicationAttempt" in value) ||
      (typeof value.publicationAttempt === "number" &&
        Number.isSafeInteger(value.publicationAttempt) &&
        value.publicationAttempt > 0))
  );
}

async function recoverDeadLetter(message: Message<unknown>, env: Env) {
  if (!validMessage(message.body) || !message.body.publicationAttempt) {
    const taskId =
      message.body &&
      typeof message.body === "object" &&
      "taskId" in message.body &&
      typeof message.body.taskId === "string" &&
      message.body.taskId.length > 0 &&
      message.body.taskId.length < 512
        ? message.body.taskId
        : null;
    if (taskId) {
      await reportComparisonPublication(env.DB, { published: [], failed: [taskId] }, Date.now());
    }
    console.error(JSON.stringify({ event: "comparison-invalid-dead-letter", taskId }));
    message.ack();
    return;
  }
  const { taskId, publicationAttempt } = message.body;
  const result = await recoverDeadLetteredComparison(env.DB, {
    taskId,
    publicationAttempt,
    now: Date.now(),
  });
  console.info(JSON.stringify({ event: "comparison-dead-letter-receipt", taskId, result }));
  if (result === "deferred") {
    message.retry({ delaySeconds: 60 });
    return;
  }
  message.ack();
}

async function finishComparison(
  service: Service,
  comparisonId: string,
  operations: Env["OPERATIONS"],
) {
  let reviewReadyTransitioned: boolean;
  try {
    ({ reviewReadyTransitioned } = await service.finalizeComparison({
      comparisonId,
      now: Date.now(),
    }));
  } catch (error) {
    if (error instanceof IncompleteError || error instanceof ConflictError) return;
    throw error;
  }
  if (!reviewReadyTransitioned) return;
  try {
    await operations.send({ kind: "status", comparisonId });
  } catch {
    // The status outbox remains available to the five-minute scheduler.
    console.error(JSON.stringify({ event: "comparison-status-wakeup-failed", comparisonId }));
  }
}

async function consume(message: Message<unknown>, env: Env) {
  if (!validMessage(message.body)) {
    console.error(JSON.stringify({ event: "comparison-invalid-message" }));
    message.retry({ delaySeconds: 60 });
    return;
  }
  const service = new Service(env.DB);
  const taskId = message.body.taskId;
  const owner = crypto.randomUUID();
  try {
    const task = await service.claimComparisonTask({
      taskId,
      owner,
      now: Date.now(),
      leaseMilliseconds: 120_000,
    });
    if (!task) {
      const state = await service.getComparisonTaskState(taskId);
      if (state?.state === "complete") {
        const completedTask = await service.getComparisonTask(taskId);
        await finishComparison(service, completedTask.comparisonId, env.OPERATIONS);
      }
      if (state?.state === "complete" || state?.state === "dead" || state?.state === "superseded") {
        message.ack();
      } else {
        message.retry({ delaySeconds: 60 });
      }
      return;
    }
    const { result, artifacts } = await processComparisonTask({
      task,
      images: env.IMAGES,
      codecs: await codecsReady,
    });
    await service.commitComparisonResult({
      taskId,
      leaseOwner: owner,
      now: Date.now(),
      result,
      artifacts,
    });
    await finishComparison(service, task.comparisonId, env.OPERATIONS);
    message.ack();
  } catch (error) {
    const code =
      error instanceof ImageValidationError
        ? error.code
        : error instanceof Error
          ? error.name
          : "Error";
    console.error(JSON.stringify({ event: "comparison-task-failed", taskId, code }));
    await service.failComparisonTask({
      taskId,
      owner,
      now: Date.now(),
      retryAt: Date.now() + 60_000,
      error: code,
    });
    const state = await service.getComparisonTaskState(taskId);
    if (state?.state === "dead" || state?.state === "superseded") {
      message.ack();
      return;
    }
    message.retry({ delaySeconds: 60 });
  }
}

export default {
  async fetch(request: Request) {
    return validateRequest(request, await codecsReady);
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    if (batch.queue === env.VISONAUT_COMPARISON_DEAD_LETTER_QUEUE) {
      for (const message of batch.messages) {
        await recoverDeadLetter(message, env);
      }
      return;
    }
    for (const message of batch.messages) {
      try {
        await withCodecCapacity(() => consume(message, env), 120_000);
      } catch (error) {
        if (!(error instanceof CodecBusyError)) {
          throw error;
        }
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
