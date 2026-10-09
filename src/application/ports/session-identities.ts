import type { HiveSessionIdentityDto } from "../dto/session-identity.js";

export interface SessionIdentityPort {
  getOrCreate(provider: string, target: string, nativeSessionId: string): Promise<string>;
  /** Resolve both daemon-owned identity fields, using a provider name when one is available. */
  getOrCreateIdentity?(
    provider: string,
    target: string,
    nativeSessionId: string,
    providerSessionName?: string,
  ): Promise<HiveSessionIdentityDto>;
  /** Reserve an identity before asking a provider to create its native session. */
  reserve(): Promise<string>;
  /** Bind a reserved identity to the native session returned by the provider. */
  bind(provider: string, target: string, nativeSessionId: string, hiveSessionId: string, providerSessionName?: string): Promise<string>;
  /** Bind and return both daemon-owned identity fields when supported by the store. */
  bindIdentity?(
    provider: string,
    target: string,
    nativeSessionId: string,
    hiveSessionId: string,
    providerSessionName?: string,
  ): Promise<HiveSessionIdentityDto>;
  release(hiveSessionId: string): void;
}
