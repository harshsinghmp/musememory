import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGlobalMemoryDir } from "./root.ts";
import { scanSecrets } from "./secrets.ts";

export type UserArchetype = "developer" | "designer" | "marketer" | "casual" | "custom";

export const ARCHETYPE_TEMPLATES: Record<UserArchetype, string> = {
  developer: `# User Profile & Preferences (USER.md)

- **Role**: Software Engineer / Developer
- **Communication Style**: Direct, concise, code-first, minimal filler text.
- **Preferences**:
  - Provide complete, runnable code diffs or snippets.
  - Explain non-obvious architecture decisions and potential edge cases.
  - Prefer modern toolchains, strict types, and automated verification before completion.
  - Fail fast and avoid swallowing errors.
`,

  designer: `# User Profile & Preferences (USER.md)

- **Role**: UI/UX Designer & Creative Technologist
- **Communication Style**: Visual, structured, empathetic, design-system oriented.
- **Preferences**:
  - Focus on visual hierarchy, accessibility (WCAG), micro-interactions, and aesthetics.
  - Prefer semantic components, Tailwind CSS / modern layout patterns, and responsive behavior.
  - Keep typography, color tokens, and spacing consistent.
  - Deliver polished, production-ready interfaces without placeholders.
`,

  marketer: `# User Profile & Preferences (USER.md)

- **Role**: Growth & Marketing Strategist
- **Communication Style**: Action-oriented, persuasive, high-conversion, audience-centric.
- **Preferences**:
  - Emphasize clear value propositions, engaging headlines, and strong calls-to-action (CTAs).
  - Structure content with punchy hooks, bullet points, and data-backed positioning.
  - Optimize for SEO keywords, readability, and conversion rate optimization (CRO).
  - Maintain a compelling, brand-aligned voice.
`,

  casual: `# User Profile & Preferences (USER.md)

- **Role**: General User / Problem Solver
- **Communication Style**: Friendly, plain English, jargon-free, straightforward.
- **Preferences**:
  - Give the direct answer first, followed by clear step-by-step guidance.
  - Avoid unnecessary technical complexity unless explicitly asked.
  - Provide helpful context and intuitive examples.
`,

  custom: `# User Profile & Preferences (USER.md)

- **Name**: [Your Name / Alias]
- **Role**: [Your Role / Title]
- **Communication Style**: [Preferred Tone: e.g. Concise / Detailed / Step-by-Step]
- **Key Preferences**:
  - [Preference 1: Toolchain / Language / Framework preferences]
  - [Preference 2: Formatting / Structure / Deliverable format]
`,
};

export function userFilePath(memoryDir: string): string {
  return join(memoryDir, "USER.md");
}

export function getDefaultProfile(archetype: UserArchetype = "developer"): string {
  return ARCHETYPE_TEMPLATES[archetype] ?? ARCHETYPE_TEMPLATES.developer;
}

/**
 * Retrieve the active USER.md profile content.
 * Checks the provided memoryDir first (local workspace), then falls back to global (~/.memory/USER.md).
 */
export function getUserProfile(memoryDir?: string): string | null {
  if (memoryDir) {
    const localPath = userFilePath(memoryDir);
    if (existsSync(localPath)) {
      try {
        const content = readFileSync(localPath, "utf8").trim();
        if (content.length > 0) return content;
      } catch {}
    }
  }

  const globalDir = getGlobalMemoryDir();
  const globalPath = userFilePath(globalDir);
  if (existsSync(globalPath)) {
    try {
      const content = readFileSync(globalPath, "utf8").trim();
      if (content.length > 0) return content;
    } catch {}
  }

  return null;
}

/**
 * Save or update USER.md profile with inline Vibeguard secret inspection.
 */
export function setUserProfile(memoryDir: string, content: string): void {
  const secrets = scanSecrets(content);
  if (secrets.length > 0) {
    throw new Error(`Secret detected in USER.md: ${secrets.join(", ")}`);
  }

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const targetPath = userFilePath(memoryDir);
  writeFileSync(targetPath, content.trim() + "\n", "utf8");
}

/**
 * Initialize USER.md from an archetype if not already present.
 */
export function initUserProfile(
  memoryDir: string,
  archetype: UserArchetype = "developer",
  overwrite = false
): string {
  const targetPath = userFilePath(memoryDir);
  if (existsSync(targetPath) && !overwrite) {
    return readFileSync(targetPath, "utf8");
  }

  const template = getDefaultProfile(archetype);
  setUserProfile(memoryDir, template);
  return template;
}
