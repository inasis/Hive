/** Public request surface shared by the local bridge and the mobile daemon. */
export const DAEMON_API = {
  listProviders: "catalog",
  connect: "provider",
  refresh: "provider",
  createThread: "provider",
  renameThread: "provider",
  deleteThread: "provider",
  openThread: "provider",
  forkSideThread: "provider",
  forkThread: "provider",
  listSkills: "provider",
  listCommands: "provider",
  runCommand: "provider",
  sendPrompt: "provider",
  steerTurn: "provider",
  interruptTurn: "provider",
  updateThreadSettings: "provider",
  disconnect: "provider",
  answerApproval: "provider",
  terminalStart: "workspace",
  terminalInput: "workspace",
  terminalResize: "workspace",
  terminalStop: "workspace",
  listWorkspaceFiles: "workspace",
  readWorkspaceFile: "workspace",
} as const;

export type DaemonApiMethod = keyof typeof DAEMON_API;
export type DaemonApiScope = (typeof DAEMON_API)[DaemonApiMethod];
export type DaemonApiMethodForScope<Scope extends DaemonApiScope> = {
  [Method in DaemonApiMethod]: (typeof DAEMON_API)[Method] extends Scope ? Method : never;
}[DaemonApiMethod];
export type ProviderDaemonApiMethod = DaemonApiMethodForScope<"provider">;
export type SharedDaemonApiMethod = Exclude<DaemonApiMethod, ProviderDaemonApiMethod>;

const DAEMON_API_METHODS: ReadonlySet<string> = new Set(Object.keys(DAEMON_API));
const PROVIDER_DAEMON_API_METHODS: ReadonlySet<string> = new Set(
  Object.entries(DAEMON_API).filter(([, scope]) => scope === "provider").map(([method]) => method),
);

export function isDaemonApiMethod(method: string): method is DaemonApiMethod {
  return DAEMON_API_METHODS.has(method);
}

export function isProviderDaemonApiMethod(method: string): method is ProviderDaemonApiMethod {
  return PROVIDER_DAEMON_API_METHODS.has(method);
}
