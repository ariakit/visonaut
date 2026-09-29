interface OperationFailure {
  operation: string;
  code: string;
  correlationId: string;
  startedAt: number;
  runId?: string;
  taskId?: string;
}

/** Fixed fields keep credentials, request payloads, and SQL out of Worker logs. */
export function logOperationFailure(input: OperationFailure) {
  console.error(
    JSON.stringify({
      event: "operation-failed",
      operation: input.operation,
      code: input.code,
      correlationId: input.correlationId,
      elapsedMilliseconds: Math.max(0, Date.now() - input.startedAt),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    }),
  );
}
