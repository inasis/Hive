import { useRef, type MutableRefObject } from "react";
import { ThreadViewStore } from "./thread-view-store";

export function useThreadViewStore(): MutableRefObject<ThreadViewStore> {
  const store = useRef<ThreadViewStore | null>(null);
  if (!store.current) store.current = new ThreadViewStore();
  return store as MutableRefObject<ThreadViewStore>;
}
