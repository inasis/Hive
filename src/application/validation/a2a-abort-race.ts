import { runtimeFault } from "./a2a-runtime-errors.js";

/** Race asynchronous work against task cancellation while preserving timeout classification. */
export async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal, didTimeout: () => boolean): Promise<T> {
  if (signal.aborted) throw didTimeout() ? runtimeFault("TIMEOUT", "", "Task timed out", true) : runtimeFault("PROCESS_EXITED", "", "Task was cancelled");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(didTimeout()
      ? runtimeFault("TIMEOUT", "", "Task timed out", true)
      : runtimeFault("PROCESS_EXITED", "", "Task was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
