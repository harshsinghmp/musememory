import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGlobalMemoryDir } from "./root.ts";
import { scanSecrets } from "./secrets.ts";

export type UserArchetype = "developer" | "designer" | "marketer" | "casual" | "custom";

export const LOCAL_USER_INHERIT_MARKER = "<!-- INHERIT: GLOBAL -->";

export const LOCAL_USER_TEMPLATE = `# Local Project User Profile (USER.md)
> Inherits from global \`~/.memory/USER.md\`. Add local project-specific overrides, role preferences, or rules below.

${LOCAL_USER_INHERIT_MARKER}
`;

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

export interface UserProfileOptions {
  query?: string;
  archetype?: UserArchetype;
  files?: string[];
}

/**
 * Detect the active scope archetype from query intent, keywords, and file hints.
 */
export function detectScopeArchetype(query: string = "", hints: { files?: string[]; task?: string } = {}): UserArchetype {
  const text = `${query} ${hints.task ?? ""} ${(hints.files ?? []).join(" ")}`.toLowerCase();

  // 1. Designer signals
  const designRegex = /\b(ui|ux|css|style|styles|styling|tailwind|scss|sass|figma|animation|animations|gsap|component|components|layout|visual|visuals|design|designer|typography|colors|color|palette|theme|themes|responsive|mobile-first|wcag|a11y|accessibility|wireframe|mockup|interface|canvas|svg|font|fonts|frontend)\b/i;
  const designFileExts = /\.(css|scss|sass|svg|figma|styled\.[jt]sx?)$/i;

  // 2. Marketer signals
  const marketingRegex = /\b(marketing|copy|copywriting|seo|cro|conversion|conversions|landing page|cta|call to action|headline|hook|hooks|pitch|sales|funnel|funnels|growth|campaign|audience|retention|email campaign|ad copy|tagline|positioning|advertisement)\b/i;

  // 3. Casual signals
  const casualRegex = /\b(eli5|explain like i'm 5|explain simply|for beginners|in plain english|simple explanation|non-technical|overview for layman)\b/i;

  if (designRegex.test(text) || (hints.files && hints.files.some((f) => designFileExts.test(f)))) {
    return "designer";
  }

  if (marketingRegex.test(text)) {
    return "marketer";
  }

  if (casualRegex.test(text)) {
    return "casual";
  }

  return "developer";
}

export function userFilePath(memoryDir: string): string {
  return join(memoryDir, "USER.md");
}

export function getDefaultProfile(archetype: UserArchetype = "developer"): string {
  return ARCHETYPE_TEMPLATES[archetype] ?? ARCHETYPE_TEMPLATES.developer;
}

/**
 * Retrieve the active USER.md profile content with dynamic scope auto-selection and local-to-global inheritance.
 */
export function getUserProfile(memoryDir?: string, options: UserProfileOptions = {}): string | null {
  const globalDir = getGlobalMemoryDir();
  const globalPath = userFilePath(globalDir);
  let globalContent = "";

  if (existsSync(globalPath)) {
    try {
      globalContent = readFileSync(globalPath, "utf8").trim();
    } catch {}
  }

  let localContent = "";
  let inheritsFromGlobal = false;

  if (memoryDir) {
    const localPath = userFilePath(memoryDir);
    if (existsSync(localPath)) {
      try {
        localContent = readFileSync(localPath, "utf8").trim();
        if (localContent.includes(LOCAL_USER_INHERIT_MARKER) || localContent.includes("@import")) {
          inheritsFromGlobal = true;
        }
      } catch {}
    }
  }

  // Determine active archetype
  const detectedArchetype = options.archetype ?? (options.query ? detectScopeArchetype(options.query, { files: options.files }) : undefined);

  // If local file exists and is completely standalone (does not inherit)
  if (localContent && !inheritsFromGlobal) {
    // If scope was detected and user wants dynamic scoping overlay
    if (detectedArchetype && detectedArchetype !== "developer") {
      const scopeTemplate = getDefaultProfile(detectedArchetype);
      return `${localContent}\n\n### Active Task Scope Directives (${detectedArchetype.toUpperCase()})\n${scopeTemplate.replace(/^# .*\n+/m, "")}`.trim();
    }
    return localContent;
  }

  // If we inherit or need base profile
  let baseProfile = globalContent;
  if (!baseProfile) {
    baseProfile = getDefaultProfile(detectedArchetype ?? "developer");
  } else if (detectedArchetype) {
    // Check if global content is a standard archetype or custom profile
    const isStandardArchetype = Object.values(ARCHETYPE_TEMPLATES).some((t) => t.trim() === globalContent);
    if (isStandardArchetype) {
      baseProfile = getDefaultProfile(detectedArchetype);
    } else if (detectedArchetype !== "developer") {
      // Overlay detected non-dev scope on custom profile
      const scopeTemplate = getDefaultProfile(detectedArchetype);
      baseProfile = `${baseProfile}\n\n### Active Task Scope Directives (${detectedArchetype.toUpperCase()})\n${scopeTemplate.replace(/^# .*\n+/m, "")}`.trim();
    }
  }

  // If local content has overrides after the inherit marker
  if (localContent && inheritsFromGlobal) {
    const localOverrides = localContent
      .replace(/^# [^\n]*\n+/m, "")
      .replace(/^> [^\n]*\n+/m, "")
      .replace(LOCAL_USER_INHERIT_MARKER, "")
      .trim();

    if (localOverrides.length > 0) {
      return `${baseProfile}\n\n### Local Project Preferences\n${localOverrides}`.trim();
    }
  }

  return baseProfile.trim() || null;
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
 * Initialize USER.md. If isLocal is true, creates a reference pointing to the global profile.
 */
export function initUserProfile(
  memoryDir: string,
  archetype: UserArchetype = "developer",
  overwrite = false,
  isLocal = false
): string {
  const targetPath = userFilePath(memoryDir);
  if (existsSync(targetPath) && !overwrite) {
    const existing = readFileSync(targetPath, "utf8");
    if (!isLocal && existing.trim() === LOCAL_USER_TEMPLATE.trim()) {
      // Proceed to set selected archetype
    } else {
      return existing;
    }
  }

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const content = isLocal ? LOCAL_USER_TEMPLATE : getDefaultProfile(archetype);
  setUserProfile(memoryDir, content);
  return content;
}
