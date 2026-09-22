export class CodecBusyError extends Error {
  constructor() {
    super("The image codec is busy. Retry the request.");
    this.name = "CodecBusyError";
  }
}

// A codec instance keeps its linear memory in the isolate. This token bounds
// all image allocations across interleaved requests; it stores no user data.
let occupied = false;

export async function withCodecCapacity<T>(operation: () => Promise<T>): Promise<T> {
  if (occupied) {
    throw new CodecBusyError();
  }
  occupied = true;
  try {
    return await operation();
  } finally {
    occupied = false;
  }
}
