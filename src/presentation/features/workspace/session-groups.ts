import { threadUpdatedAt, timestampMillis } from "../../shared/provider-thread-state";
import { basename } from "../../shared/path-name";
import type { RemoteThread } from "../../shared/bridge";

export type Project = { key: string; name: string; path: string; sessions: RemoteThread[] };

export function groupThreads(threads: RemoteThread[]): Project[] {
  const groups = new Map<string, Project>();
  for (const thread of threads) {
    const path = thread.cwd || "";
    const key = path ? `cwd:${path}` : "unknown-workspace";
    const group = groups.get(key) ?? { key, name: path ? basename(path) : "원격 경로 없음", path, sessions: [] };
    group.sessions.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, sessions: group.sessions.sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a)) }))
    .sort((a, b) => threadUpdatedAt(b.sessions[0]) - threadUpdatedAt(a.sessions[0]));
}

export function formatAge(value: string | number | null): string {
  if (value === null) return "시간 정보 없음";
  const timestamp = timestampMillis(value);
  if (Number.isNaN(timestamp)) return "시간 정보 없음";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}일 전` : new Date(timestamp).toLocaleDateString();
}
