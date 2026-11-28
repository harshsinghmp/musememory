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

/**
 * The product name, shown to humans.
 *
 * `PACKAGE_NAME` above is the protocol contract — it is what a client stores
 * in its config and what `npx musememory` resolves. The final product name is
 * the same word, but the two stay separate constants: `PACKAGE_NAME` must never
 * drift from `package.json`, while `PRODUCT_NAME` is copy, served as the MCP
 * `serverInfo.title` and the one-line description beside it. Keeping them
 * separate is what let the interim `aimm` label ship for 3.5.0 without a single
 * tool name, package name or env var moving.
 */
export const PRODUCT_NAME = "musememory";
export const PRODUCT_TAGLINE = "musememory — local-first memory for AI coding agents.";
