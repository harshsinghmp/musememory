import { createInterface } from "node:readline";

export interface SelectOption<T = string> {
  id: T;
  label: string;
  hint?: string;
  category?: string;
  selected?: boolean;
}

/**
 * Pure parser for user selection inputs (numbers, comma lists, ranges, aliases, all, cancel).
 */
export function parseSelectionInput<T extends string>(
  rawInput: string,
  options: SelectOption<T>[],
  defaultAll = true
): T[] {
  const trimmed = rawInput.trim().toLowerCase();

  if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
    return [];
  }

  if (trimmed === "") {
    return defaultAll ? options.map((o) => o.id) : [];
  }

  if (trimmed === "a" || trimmed === "all") {
    return options.map((o) => o.id);
  }

  const selectedIds: T[] = [];
  const parts = trimmed.split(/[\s,]+/);

  for (const part of parts) {
    if (!part) continue;
    // Range support: "1-3"
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= options.length) {
        for (let i = start; i <= end; i++) {
          selectedIds.push(options[i - 1].id);
        }
      }
      continue;
    }

    // Single index: "1", "2"
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      selectedIds.push(options[num - 1].id);
      continue;
    }

    // Match by ID or Name: "claude", "cursor", "hermes"
    const matched = options.find((o) => o.id.toLowerCase() === part || o.label.toLowerCase().includes(part));
    if (matched) {
      selectedIds.push(matched.id);
    }
  }

  return Array.from(new Set(selectedIds));
}

/**
 * Prompt user to select one or more options from a numbered list.
 * Supports numbers ("1,2,5"), ranges ("1-4"), "all", "a", or direct names.
 */
export async function promptMultiSelect<T extends string>(
  title: string,
  options: SelectOption<T>[],
  defaultAll = true,
  isInteractive = Boolean(process.stdin.isTTY && process.env.NODE_ENV !== "test" && !process.env.CI)
): Promise<T[]> {
  if (options.length === 0) return [];
  if (!isInteractive) {
    // Non-interactive / CI / Test fallback
    return defaultAll ? options.map((o) => o.id) : [];
  }

  console.log(`\n${title}`);
  console.log(`------------------------------------------------`);
  options.forEach((opt, idx) => {
    const num = `[${idx + 1}]`.padEnd(5);
    const hint = opt.hint ? ` (${opt.hint})` : "";
    const cat = opt.category ? ` [${opt.category}]` : "";
    console.log(`  ${num} ${opt.label}${cat}${hint}`);
  });
  console.log(`  [a]   Select All (Recommended)`);
  console.log(`  [q]   Cancel\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`Enter selection (e.g. "1,3" or "all") [default: ${defaultAll ? "all" : "none"}]: `, (answer) => {
      rl.close();
      const result = parseSelectionInput(answer, options, defaultAll);
      if (answer.trim().toLowerCase().startsWith("q")) {
        console.log("Operation cancelled.");
      }
      resolve(result);
    });
  });
}
