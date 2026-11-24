/**
 * Network boundary predicates shared by the CLI startup gate and the HTTP MCP
 * transport guard.
 *
 * Kept dependency-free on purpose: `src/cli/ecosystem.ts` imports it on every
 * CLI invocation and must not pull the MCP SDK in just to classify a host.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * True only for the three documented loopback spellings (`127.0.0.1`, `::1`,
 * `localhost`), with optional IPv6 brackets and surrounding whitespace ignored.
 *
 * Anything else — `0.0.0.0`, a LAN address, a DNS name, `127.0.0.2` — is a
 * non-loopback bind and is treated as reachable by other machines. Callers use
 * that answer to decide whether authentication may be skipped.
 */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  return LOOPBACK_HOSTS.has(normalized);
}
