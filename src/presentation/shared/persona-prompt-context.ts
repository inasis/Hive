const LEGACY_PERSONA_CONTEXT_PREFIX = "[[HIVE_PERSONA_CONTEXT_V1:";
const LEGACY_PERSONA_CONTEXT_SUFFIX = "\n[[/HIVE_PERSONA_CONTEXT]]\n\n";

/** Hide an earlier client-prefixed persona block if it remains in a provider's stored history. */
export function removeLegacyPersonaPromptContext(text: string): string {
  const markerIndex = text.indexOf(LEGACY_PERSONA_CONTEXT_PREFIX);
  if (markerIndex < 0) return text;

  const header = /^\[\[HIVE_PERSONA_CONTEXT_V1:(\d+)\]\]\n/.exec(text.slice(markerIndex));
  if (!header) return text;

  const contextEnd = markerIndex + header[0].length + Number(header[1]);
  if (!Number.isSafeInteger(contextEnd) || contextEnd > text.length || !text.startsWith(LEGACY_PERSONA_CONTEXT_SUFFIX, contextEnd)) {
    return text;
  }
  return `${text.slice(0, markerIndex)}${text.slice(contextEnd + LEGACY_PERSONA_CONTEXT_SUFFIX.length)}`;
}
