import { defaultHiveSessionName } from "../../domain/session-identity.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";

/** Resolve both identity fields while supporting older in-process stores. */
export async function resolveHiveSessionIdentity(
  identities: SessionIdentityPort,
  provider: string,
  target: string,
  nativeSessionId: string,
  providerSessionName?: string,
): Promise<HiveSessionIdentityDto> {
  if (typeof identities.getOrCreateIdentity === "function") {
    return identities.getOrCreateIdentity(provider, target, nativeSessionId, providerSessionName);
  }
  const hiveSessionId = await identities.getOrCreate(provider, target, nativeSessionId);
  return { hiveSessionId, sessionName: providerSessionName?.trim() || defaultHiveSessionName(hiveSessionId) };
}

/** Bind both identity fields while supporting older in-process stores. */
export async function bindHiveSessionIdentity(
  identities: SessionIdentityPort,
  provider: string,
  target: string,
  nativeSessionId: string,
  hiveSessionId: string,
  providerSessionName?: string,
): Promise<HiveSessionIdentityDto> {
  if (typeof identities.bindIdentity === "function") {
    return identities.bindIdentity(provider, target, nativeSessionId, hiveSessionId, providerSessionName);
  }
  const assignedId = await identities.bind(provider, target, nativeSessionId, hiveSessionId, providerSessionName);
  return { hiveSessionId: assignedId, sessionName: providerSessionName?.trim() || defaultHiveSessionName(assignedId) };
}
