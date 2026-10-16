export type AsyncWriteWorker = () => Promise<void>;

const registeredWorkers = new Set<AsyncWriteWorker>();
let isJoining = false;

/**
 * T-056: Registers an asynchronous write worker for bounded graceful join on exit.
 * Returns an unregister function.
 */
export function registerWriteWorker(worker: AsyncWriteWorker): () => void {
  registeredWorkers.add(worker);
  return () => {
    registeredWorkers.delete(worker);
  };
}

export function getActiveWorkerCount(): number {
  return registeredWorkers.size;
}

/**
 * T-056: Bounded join across all active write workers.
 * Drains all registered in-flight write workers within `timeoutMs` (default 5000ms),
 * preventing process exits from terminating writes prematurely or hanging indefinitely.
 */
export async function drainWriteWorkers(timeoutMs = 5000): Promise<{ completed: number; timedOut: boolean }> {
  if (registeredWorkers.size === 0) return { completed: 0, timedOut: false };
  if (isJoining) return { completed: 0, timedOut: false };

  isJoining = true;
  const workers = Array.from(registeredWorkers);
  const total = workers.length;

  try {
    const drainPromise = Promise.all(
      workers.map(async (w) => {
        try {
          await w();
        } catch {}
      }),
    );

    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), timeoutMs),
    );

    const result = await Promise.race([
      drainPromise.then(() => ({ timedOut: false })),
      timeoutPromise,
    ]);

    registeredWorkers.clear();
    return { completed: total, timedOut: result.timedOut };
  } finally {
    isJoining = false;
  }
}

// Register beforeExit hook to automatically drain workers on graceful exit
if (typeof process !== "undefined" && process.on) {
  process.on("beforeExit", async () => {
    if (registeredWorkers.size > 0) {
      await drainWriteWorkers(5000);
    }
  });
}
