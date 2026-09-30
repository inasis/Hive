import { timingSafeEqual } from "node:crypto";

/** Compare mobile pairing tokens without a content-dependent early exit. */
export function verifyMobileToken(candidate: string, expected: string): boolean {
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
