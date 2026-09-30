export function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path || "Workspace";
}
