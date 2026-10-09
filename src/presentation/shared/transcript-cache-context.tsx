import { createContext, useContext, type PropsWithChildren } from "react";
import type { TranscriptCachePort } from "../../application/ports/transcript-cache.js";

const TranscriptCacheContext = createContext<TranscriptCachePort | null>(null);

export function TranscriptCacheProvider({ cache, children }: PropsWithChildren<{ cache: TranscriptCachePort }>) {
  return <TranscriptCacheContext.Provider value={cache}>{children}</TranscriptCacheContext.Provider>;
}

export function useTranscriptCache(): TranscriptCachePort {
  const cache = useContext(TranscriptCacheContext);
  if (!cache) throw new Error("TranscriptCacheProvider is missing");
  return cache;
}
