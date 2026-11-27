/**
 * Wire shape shared by every MCP tool handler.
 *
 * Extracted from `src/mcp.ts` so both the request wiring (profile gating in
 * `createServer`) and the dispatch table in `src/mcp/dispatch.ts` can build
 * responses without importing each other.
 *
 * #495: a tool that publishes an `outputSchema` also returns the payload as
 * `structuredContent`, next to the unchanged text block. `toolResult()` is left
 * exactly as it was, so a text-only tool's response is byte-identical.
 */
export type ToolResultLike = {
  content: Array<{ type: "text"; text: string }>;
  /** #495: the same object the text block serialises, for tools with an `outputSchema`. */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Serialise a tool payload as the single JSON text block MCP clients expect. */
export function toolResult(content: unknown): ToolResultLike {
  return {
    content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
  };
}

/**
 * Serialise a payload that the tool also advertises an `outputSchema` for.
 *
 * The object is built **once** by the handler and handed to both channels: the
 * text block is `JSON.stringify(payload)` exactly as `toolResult()` would have
 * produced it, and `structuredContent` is that same object — not a re-derived
 * copy — so the two cannot disagree. A client that ignores `structuredContent`
 * sees the identical response it saw before #495.
 */
export function toolResultStructured(payload: object): ToolResultLike {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/** Return a tool error; the message is passed through verbatim. */
export function toolError(message: string): ToolResultLike {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
