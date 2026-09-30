/** Accept native absolute workspace paths, including Windows paths forwarded over SSH. */
export function isAbsoluteWorkspacePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}
