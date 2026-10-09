/** A daemon-owned stable identity for one provider-native session. */
export type HiveSessionIdentity = {
  hiveSessionId: string;
  sessionName: string;
};

export function defaultHiveSessionName(hiveSessionId: string): string {
  const suffix = hiveSessionId.replaceAll("-", "").slice(0, 8);
  return `Hive 세션 ${suffix || "미지정"}`;
}

export function isHiveSessionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
