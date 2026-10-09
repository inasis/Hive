/** Validate the host portion before passing a workspace target to SSH. */
export function assertSshTarget(target: string): void {
  // Keep this to SSH config aliases, DNS names, IPv4 literals, and user@host.
  // Arbitrary shell text is never accepted as a host target.
  if (!target || target.startsWith("-") || !/^[A-Za-z0-9_.@:-]+$/.test(target)) {
    throw new Error("SSH target must be a host alias or user@host, without shell arguments");
  }
}
