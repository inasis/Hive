import { createServer } from "node:net";

export const MANAGED_OPENCODE_HOST = "127.0.0.1";
const DEFAULT_PORT = 4096;

/** Prefer OpenCode's usual port and reserve another loopback port if it is occupied. */
export async function selectManagedOpenCodePort(): Promise<number> {
  if (await isLoopbackPortAvailable(DEFAULT_PORT)) return DEFAULT_PORT;
  return reserveLoopbackPort();
}

function isLoopbackPortAvailable(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    const onError = (): void => resolve(false);
    probe.once("error", onError);
    probe.listen(port, MANAGED_OPENCODE_HOST, () => {
      probe.off("error", onError);
      probe.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

function reserveLoopbackPort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    probe.once("error", onError);
    probe.listen(0, MANAGED_OPENCODE_HOST, () => {
      probe.off("error", onError);
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve an available OpenCode loopback port"));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
