/**
 * The published package version, read from package.json at build time.
 *
 * Why this exists
 * ---------------
 * The MCP server used to advertise `"version": "1.6.0"` in its `ServerInfo`
 * while the package was at 3.0.0. Clients that surface the server version
 * (Claude Code's MCP inspector, IDE status bars, agent logs) therefore showed
 * a version two majors behind, and the drift was invisible because the
 * string was hand-typed in a second place.
 *
 * Importing package.json makes the number impossible to get wrong: there is
 * exactly one version, and it is the one that is published.
 */
import pkg from "../package.json" with { type: "json" };

export const PACKAGE_VERSION: string = pkg.version;
export const PACKAGE_NAME: string = pkg.name;
