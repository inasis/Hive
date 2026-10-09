import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { TranscriptResponseGroupDto } from "../../../application/dto/transcript-cache.js";

type Options = {
  threadKey: string;
  chatActive: boolean;
  responseGroups: TranscriptResponseGroupDto[];
  scrollRef: RefObject<HTMLDivElement | null>;
};

/** Owns latest-viewport following, resize tracking, and the jump-to-latest action. */
export function useTranscriptViewport({ threadKey, chatActive, responseGroups, scrollRef }: Options) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const previousThreadKeyRef = useRef("");
  const previousChatActiveRef = useRef(false);
  const followingLatestRef = useRef(true);

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
      followingLatestRef.current = true;
      setShowJumpToLatest(false);
      scroll.scrollTop = scroll.scrollHeight;
      return;
    }

    if (followingLatestRef.current) scroll.scrollTop = scroll.scrollHeight;
  }, [chatActive, responseGroups, scrollRef, threadKey]);

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

  const onViewportScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    followingLatestRef.current = isAtLatest(scroll);
    setShowJumpToLatest(!followingLatestRef.current);
  }, [scrollRef]);

  const jumpToLatest = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    followingLatestRef.current = true;
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
  }, [scrollRef]);

  return { followingLatestRef, onViewportScroll, showJumpToLatest, jumpToLatest };
}

function isAtLatest(scroll: HTMLDivElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 48;
}
