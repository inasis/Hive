import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AssistantProvider } from "../../shared/bridge";
import type { TranscriptResponseGroupDto } from "../../../application/dto/transcript-cache.js";
import { useTranscriptCache } from "../../shared/transcript-cache-context";

const RECENT_RESPONSE_COUNT = 20;
const LOAD_OLDER_RESPONSE_COUNT = 20;
const LOAD_OLDER_WHEN_REMAINING = 10;

type WindowState = { threadKey: string; groups: TranscriptResponseGroupDto[]; hasOlder: boolean; loadingOlder: boolean };
type PendingScrollRestore = { threadKey: string; scrollTop: number; scrollHeight: number };
type LatestFollowingState = { current: boolean };

type Options = {
  threadKey: string;
  target: string;
  provider: AssistantProvider;
  threadId: string;
  chatActive: boolean;
  responseGroups: TranscriptResponseGroupDto[];
  scrollRef: RefObject<HTMLDivElement | null>;
  followingLatestRef: LatestFollowingState;
};

/** Owns cached history paging, its sentinel, and scroll position restoration. */
export function useTranscriptHistoryWindow({
  threadKey,
  target,
  provider,
  threadId,
  chatActive,
  responseGroups,
  scrollRef,
  followingLatestRef,
}: Options) {
  const transcriptCache = useTranscriptCache();
  const [windowState, setWindowState] = useState<WindowState>({ threadKey: "", groups: [], hasOlder: false, loadingOlder: false });
  const loadedGroups = windowState.threadKey === threadKey ? windowState.groups : responseGroups;
  const hasOlder = windowState.threadKey === threadKey && windowState.hasOlder;
  const loadingOlder = windowState.threadKey === threadKey && windowState.loadingOlder;
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);
  const previousThreadKeyRef = useRef("");
  const previousChatActiveRef = useRef(false);
  const previousLatestGroupIdRef = useRef("");
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
      scrollingTowardHistoryRef.current = false;
      loadOlderLockRef.current = false;
      const recentGroups = responseGroups.slice(-RECENT_RESPONSE_COUNT);
      setWindowState({ threadKey, groups: recentGroups, hasOlder: false, loadingOlder: false });
      previousScrollTopRef.current = scroll.scrollTop;
      const oldestGroup = recentGroups[0];
      if (oldestGroup) {
        void transcriptCache.hasOlder(target, provider, threadId, oldestGroup.id).then((cachedHasOlder) => {
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
    previousScrollTopRef.current = scroll.scrollTop;
  }, [chatActive, provider, responseGroups, scrollRef, target, threadId, threadKey, transcriptCache, followingLatestRef]);

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
    let result: Awaited<ReturnType<typeof transcriptCache.readOlder>>;
    try {
      result = await transcriptCache.readOlder(target, provider, threadId, oldestGroup.id, LOAD_OLDER_RESPONSE_COUNT);
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
  }, [hasOlder, loadedGroups, loadingOlder, provider, scrollRef, target, threadId, threadKey, transcriptCache]);

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

  const onHistoryScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (scroll.scrollTop < previousScrollTopRef.current) scrollingTowardHistoryRef.current = true;
    else if (scroll.scrollTop > previousScrollTopRef.current) scrollingTowardHistoryRef.current = false;
    previousScrollTopRef.current = scroll.scrollTop;
  }, [scrollRef]);

  return { visibleGroups: loadedGroups, hasOlder, historySentinelRef, onHistoryScroll };
}

function mergeGroups(current: TranscriptResponseGroupDto[], incoming: TranscriptResponseGroupDto[]): TranscriptResponseGroupDto[] {
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
