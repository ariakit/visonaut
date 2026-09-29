export class CodecBusyError extends Error {
  constructor() {
    super("The image codec is busy. Retry the request.");
    this.name = "CodecBusyError";
  }
}

// A codec instance keeps its linear memory in the isolate. This token bounds
// all image allocations across interleaved requests; the release signal stores no user data.
let occupied = false;
let released = Promise.resolve();

export async function withCodecCapacity<T>(
  operation: () => Promise<T>,
  waitMilliseconds = 0,
): Promise<T> {
  if (occupied) {
    if (waitMilliseconds <= 0) {
      throw new CodecBusyError();
    }
    const { promise, reject } = Promise.withResolvers<never>();
    const timeout = setTimeout(() => reject(new CodecBusyError()), waitMilliseconds);
    try {
      while (occupied) {
        await Promise.race([released, promise]);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  occupied = true;
  const { promise, resolve } = Promise.withResolvers<void>();
  released = promise;
  try {
    return await operation();
  } finally {
    occupied = false;
    resolve();
  }
}
