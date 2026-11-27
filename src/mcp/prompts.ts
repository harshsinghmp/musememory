/**
 * MCP **prompts** (issue #494).
 *
 * Prompts are the server's ready-made, parameterised instructions: instead of a
 * client re-typing the morning standup boilerplate, it calls `prompts/get` with
 * the day's arguments and gets back a filled user message.
 *
 * The catalogue is `BUILTIN_PROMPTS` from `src/prompts.ts`, and rendering goes
 * through that module's `renderPrompt` so an MCP prompt, `memory_prompt_run`
 * and the CLI all produce the same text for the same arguments.
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { BUILTIN_PROMPTS, getPrompt, renderPrompt } from "../prompts.ts";
import { DOCUMENT_MAX_BYTES, wrapAgentContext } from "../security/context_sanitizer.ts";

export interface McpPromptArgument {
  name: string;
  description?: string;
  required: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
}

/** The `prompts/get` payload, typed by the SDK's own schema. */
export type McpPromptResult = GetPromptResult;

/** Any `{{var}}` the template still carries after the shared renderer ran. */
const LEFTOVER_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * A line whose whole content is a bare `Label:` — the shape a single-placeholder
 * line collapses to when its variable had no value. Dropping it keeps an
 * unfilled optional field out of the rendered prompt instead of leaving a
 * dangling heading for the model to fill in itself.
 */
const EMPTY_LABEL_LINE = /^[A-Za-z][A-Za-z0-9 _&/()'’.-]*:\s*$/;

/**
 * Finish a rendered template: unknown variables become empty strings, lines left
 * as a bare label are omitted, trailing whitespace is trimmed and blank-line runs
 * are collapsed.
 */
export function finishPromptRendering(template: string, args: Record<string, string>): string {
  const filled = template.replace(LEFTOVER_PLACEHOLDER, (_match, key: string) => args[key] ?? "");
  const out: string[] = [];
  for (const raw of filled.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (EMPTY_LABEL_LINE.test(line)) continue;
    if (line === "" && out.length > 0 && out[out.length - 1] === "") continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Every builtin prompt, with its variables advertised as optional arguments. */
export function listMcpPrompts(): McpPromptDescriptor[] {
  return BUILTIN_PROMPTS.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    arguments: (prompt.variables ?? []).map((variable) => ({ name: variable, required: false })),
  }));
}

/**
 * Render one builtin prompt with the supplied arguments.
 *
 * Throws `McpError(-32602)` for a name this server does not serve, so a client
 * gets a protocol-level rejection rather than an empty message.
 */
export function getMcpPrompt(
  memoryDir: string | undefined,
  name: string,
  args: Record<string, string> = {},
): McpPromptResult {
  const prompt = getPrompt(memoryDir, name);
  if (!prompt) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown prompt '${name}'. Available prompts: ${BUILTIN_PROMPTS.map((p) => p.name).join(", ")}.`,
    );
  }

  const normalizedArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null) continue;
    normalizedArgs[key] = String(value);
  }

  const rendered = finishPromptRendering(renderPrompt(memoryDir, name, normalizedArgs), normalizedArgs);
  // #514: `renderPrompt` substitutes CURRENT.md into the template verbatim, and
  // a memory is data — a constraint containing `</muse-memory>` or `<system>`
  // would otherwise close the fence and keep talking with the server's voice.
  // Substitution itself is untouched: the fence goes on after rendering, so
  // every `{{var}}` still resolves exactly as it did.
  const text = wrapAgentContext(rendered, DOCUMENT_MAX_BYTES);
  return {
    description: prompt.description,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}
