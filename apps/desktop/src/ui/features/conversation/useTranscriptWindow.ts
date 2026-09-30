import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AssistantProvider, TranscriptEntry } from "../../../shared/bridge";
import { hiveTranscriptCache } from "../../shared/hive-transcript-cache";
import { groupTranscriptResponses, type TranscriptResponseGroup } from "../../shared/transcript-groups";

const RECENT_RESPONSE_COUNT = 20;
const LOAD_OLDER_RESPONSE_COUNT = 20;
const LOAD_OLDER_WHEN_REMAINING = 10;

type WindowState = { threadKey: string; groups: TranscriptResponseGroup[]; hasOlder: boolean; loadingOlder: boolean };
type PendingScrollRestore = { threadKey: string; scrollTop: number; scrollHeight: number };

/** Keep only recent groups mounted and fetch older response groups from Hive's local cache on demand. */
export function useTranscriptWindow(
  threadKey: string,
  target: string,
  provider: AssistantProvider,
  threadId: string,
  chatActive: boolean,
  entries: TranscriptEntry[],
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const responseGroups = useMemo(() => groupTranscriptResponses(entries), [entries]);
  const [windowState, setWindowState] = useState<WindowState>({ threadKey: "", groups: [], hasOlder: false, loadingOlder: false });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const loadedGroups = windowState.threadKey === threadKey ? windowState.groups : responseGroups;
  const hasOlder = windowState.threadKey === threadKey && windowState.hasOlder;
  const loadingOlder = windowState.threadKey === threadKey && windowState.loadingOlder;
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);
  const previousThreadKeyRef = useRef("");
  const previousChatActiveRef = useRef(false);
  const previousLatestGroupIdRef = useRef("");
  const followingLatestRef = useRef(true);
  const scrollingTowardHistoryRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const loadOlderLockRef = useRef(false);

  useLayoutEffect(() => {
    if (!chatActive) {
      previousChatActiveRef.current = false;
      return;
    }
    const scroll = scrollRef.current;
    if (!scroll) return;

    const returningToChat = !previousChatActiveRef.current;
    previousChatActiveRef.current = true;
    if (previousThreadKeyRef.current !== threadKey || returningToChat) {
      previousThreadKeyRef.current = threadKey;
      previousLatestGroupIdRef.current = responseGroups.at(-1)?.id ?? "";
      pendingScrollRestoreRef.current = null;
      followingLatestRef.current = true;
      setShowJumpToLatest(false);
      scrollingTowardHistoryRef.current = false;
      loadOlderLockRef.current = false;
      const recentGroups = responseGroups.slice(-RECENT_RESPONSE_COUNT);
      setWindowState({ threadKey, groups: recentGroups, hasOlder: false, loadingOlder: false });
      scroll.scrollTop = scroll.scrollHeight;
      previousScrollTopRef.current = scroll.scrollTop;
      const oldestGroup = recentGroups[0];
      if (oldestGroup) {
        void hiveTranscriptCache.hasOlder(target, provider, threadId, oldestGroup.id).then((cachedHasOlder) => {
          setWindowState((current) => current.threadKey === threadKey ? { ...current, hasOlder: cachedHasOlder } : current);
        }).catch(() => undefined);
      }
      return;
    }

    const latestGroupId = responseGroups.at(-1)?.id ?? "";
    const startedAnotherResponse = Boolean(latestGroupId && latestGroupId !== previousLatestGroupIdRef.current);
    previousLatestGroupIdRef.current = latestGroupId;
    setWindowState((current) => {
      if (current.threadKey !== threadKey) return current;
      if (startedAnotherResponse && followingLatestRef.current) {
        return { ...current, groups: responseGroups.slice(-RECENT_RESPONSE_COUNT), loadingOlder: false };
      }
      return { ...current, groups: mergeGroups(current.groups, responseGroups), loadingOlder: false };
    });
    if (followingLatestRef.current) scroll.scrollTop = scroll.scrollHeight;
    previousScrollTopRef.current = scroll.scrollTop;
  }, [chatActive, entries, provider, responseGroups, scrollRef, target, threadId, threadKey]);

  useLayoutEffect(() => {
    const pendingRestore = pendingScrollRestoreRef.current;
    if (!pendingRestore || pendingRestore.threadKey !== threadKey) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = pendingRestore.scrollTop + scroll.scrollHeight - pendingRestore.scrollHeight;
    pendingScrollRestoreRef.current = null;
    previousScrollTopRef.current = scroll.scrollTop;
    scrollingTowardHistoryRef.current = false;
    loadOlderLockRef.current = false;
  }, [loadedGroups, scrollRef, threadKey]);

  const loadOlder = useCallback(async () => {
    if (!hasOlder || loadingOlder || loadOlderLockRef.current) return;
    const scroll = scrollRef.current;
    const oldestGroup = loadedGroups[0];
    if (!scroll || !oldestGroup) return;
    loadOlderLockRef.current = true;
    setWindowState((current) => current.threadKey === threadKey ? { ...current, loadingOlder: true } : current);
    let result: Awaited<ReturnType<typeof hiveTranscriptCache.readOlder>>;
    try {
      result = await hiveTranscriptCache.readOlder(target, provider, threadId, oldestGroup.id, LOAD_OLDER_RESPONSE_COUNT);
    } catch {
      setWindowState((current) => current.threadKey === threadKey ? { ...current, loadingOlder: false } : current);
      loadOlderLockRef.current = false;
      return;
    }
    if (!result.groups.length) {
      setWindowState((current) => current.threadKey === threadKey ? { ...current, hasOlder: false, loadingOlder: false } : current);
      loadOlderLockRef.current = false;
      return;
    }
    pendingScrollRestoreRef.current = { threadKey, scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight };
    setWindowState((current) => current.threadKey === threadKey
      ? { ...current, groups: mergeGroups(result.groups, current.groups), hasOlder: result.hasOlder, loadingOlder: false }
      : current);
  }, [hasOlder, loadedGroups, loadingOlder, provider, scrollRef, target, threadId, threadKey]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = historySentinelRef.current;
    if (!root || !sentinel || !hasOlder || loadingOlder || loadedGroups.length <= LOAD_OLDER_WHEN_REMAINING) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((observations) => {
      if (scrollingTowardHistoryRef.current && observations.some((observation) => observation.isIntersecting)) void loadOlder();
    }, { root, threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder, loadedGroups.length, loadingOlder, scrollRef, threadKey]);

  useEffect(() => {
    const content = scrollRef.current?.firstElementChild;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      followingLatestRef.current = isAtLatest(scroll);
      setShowJumpToLatest(!followingLatestRef.current);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatActive, scrollRef, threadKey]);

  const onScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (scroll.scrollTop < previousScrollTopRef.current) scrollingTowardHistoryRef.current = true;
    else if (scroll.scrollTop > previousScrollTopRef.current) scrollingTowardHistoryRef.current = false;
    previousScrollTopRef.current = scroll.scrollTop;
    followingLatestRef.current = isAtLatest(scroll);
    setShowJumpToLatest(!followingLatestRef.current);
  }, [scrollRef]);

  const jumpToLatest = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    followingLatestRef.current = true;
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
  }, [scrollRef]);

  return { visibleGroups: loadedGroups, hasOlder, historySentinelRef, onScroll, showJumpToLatest, jumpToLatest };
}

function isAtLatest(scroll: HTMLDivElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 48;
}

function mergeGroups(current: TranscriptResponseGroup[], incoming: TranscriptResponseGroup[]): TranscriptResponseGroup[] {
  const result = [...current];
  const positions = new Map(result.map((group, index) => [group.id, index]));
  for (const group of incoming) {
    const index = positions.get(group.id);
    if (index === undefined) {
      positions.set(group.id, result.length);
      result.push(group);
    } else {
      result[index] = group;
    }
  }
  return result;
}
