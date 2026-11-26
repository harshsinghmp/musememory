/**
 * Wire shape shared by every MCP tool handler.
 *
 * Extracted from `src/mcp.ts` so both the request wiring (profile gating in
 * `createServer`) and the dispatch table in `src/mcp/dispatch.ts` can build
 * responses without importing each other.
 */
export type ToolResultLike = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Serialise a tool payload as the single JSON text block MCP clients expect. */
export function toolResult(content: unknown): ToolResultLike {
  return {
    content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
  };
}

/** Return a tool error; the message is passed through verbatim. */
export function toolError(message: string): ToolResultLike {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
