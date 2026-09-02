/**
 * Generalization Engine: Sanitizes project-specific implementation details
 * into universal, cross-project engineering principles before global promotion.
 */

export interface GeneralizationResult {
  original: string;
  generalized: string;
  isGeneralizable: boolean;
  changesMade: string[];
  specificityScore: number;
}

const FILE_PATH_REGEX = /(?:(?:\.{1,2}\/|[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+|\b[a-zA-Z0-9_-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|rb|cpp|c|php|vue|json|yaml|yml)\b)/gi;
const LINE_REF_REGEX = /\b(?:lines?|L)\s*#?\d+(?:\s*[-–to]+\s*\d+)?\b/gi;
const ABS_PATH_REGEX = /(?:\/(?:home|Users|var|tmp|etc|usr|opt)[a-zA-Z0-9_./-]+)/gi;
const SPECIFIC_COMMIT_HASH_REGEX = /\b[0-9a-f]{7,40}\b/gi;

/**
 * Evaluates the specificity of memory content and computes a specificity score [0.0 - 1.0].
 * 0.0 = Completely generic principle
 * 1.0 = Saturated with file paths, commit hashes, and local paths
 */
export function calculateSpecificityScore(content: string, projectName?: string): number {
  if (!content || content.trim().length === 0) return 0;
  
  let score = 0;
  const fileMatches = content.match(FILE_PATH_REGEX) || [];
  score += fileMatches.length * 0.25;

  const lineMatches = content.match(LINE_REF_REGEX) || [];
  score += lineMatches.length * 0.2;

  const absMatches = content.match(ABS_PATH_REGEX) || [];
  score += absMatches.length * 0.35;

  const commitMatches = content.match(SPECIFIC_COMMIT_HASH_REGEX) || [];
  score += commitMatches.length * 0.2;

  if (projectName && content.toLowerCase().includes(projectName.toLowerCase())) {
    score += 0.3;
  }

  return Math.min(1.0, Number(score.toFixed(2)));
}

/**
 * Determines whether the content can be generalized into a reusable principle.
 */
export function isContentGeneralizable(content: string): boolean {
  if (!content || content.trim().length < 15) return false;
  
  // Ephemeral or task-specific operational fragments that cannot be generalized
  const ungeneralizableMarkers = [
    /\btemp fix\b/i,
    /\bquick hack\b/i,
    /\btodo later\b/i,
    /\bdelete after test\b/i,
    /\bcheck back tomorrow\b/i,
    /\bwip\b/i,
  ];

  for (const marker of ungeneralizableMarkers) {
    if (marker.test(content)) return false;
  }

  return true;
}

/**
 * Transforms project-specific implementation patterns into universal principles.
 */
export function generalizeContent(content: string, options: { projectName?: string } = {}): GeneralizationResult {
  const original = content;
  const changesMade: string[] = [];
  let text = content;

  // 1. Strip absolute paths
  const absMatches = text.match(ABS_PATH_REGEX);
  if (absMatches && absMatches.length > 0) {
    text = text.replace(ABS_PATH_REGEX, "the environment directory");
    changesMade.push(`Replaced absolute paths (${absMatches.length} occurrences) with generic environment reference`);
  }

  // 2. Strip specific line references (e.g. line 42, L10-L15)
  const lineMatches = text.match(LINE_REF_REGEX);
  if (lineMatches && lineMatches.length > 0) {
    text = text.replace(LINE_REF_REGEX, "");
    changesMade.push(`Removed line number references (${lineMatches.length} occurrences)`);
  }

  // 3. Strip commit hashes
  const commitMatches = text.match(SPECIFIC_COMMIT_HASH_REGEX);
  if (commitMatches && commitMatches.length > 0) {
    text = text.replace(SPECIFIC_COMMIT_HASH_REGEX, "[commit]");
    changesMade.push(`Abstracted specific commit hashes (${commitMatches.length} occurrences)`);
  }

  // 4. Abstract specific repository file paths into architectural terms
  const fileMatches = text.match(FILE_PATH_REGEX);
  if (fileMatches && fileMatches.length > 0) {
    for (const fm of fileMatches) {
      // Don't replace common tool names or extensions
      if (fm.toLowerCase() === "bun.lockb" || fm.toLowerCase() === "package.json") continue;
      
      let replacement = "the target module";
      const lower = fm.toLowerCase();
      if (lower.includes("test") || lower.includes("spec")) {
        replacement = "the test suite";
      } else if (lower.includes("cache")) {
        replacement = "the caching subsystem";
      } else if (lower.includes("auth") || lower.includes("login")) {
        replacement = "the authentication service";
      } else if (lower.includes("db") || lower.includes("sql") || lower.includes("store")) {
        replacement = "the persistence layer";
      } else if (lower.includes("config") || lower.includes("settings")) {
        replacement = "the configuration layer";
      } else if (lower.includes("api") || lower.includes("route")) {
        replacement = "the API routing layer";
      }
      
      text = text.split(fm).join(replacement);
      changesMade.push(`Abstracted path '${fm}' to '${replacement}'`);
    }
  }

  // 5. Scrub project name if provided
  if (options.projectName && options.projectName.length > 2) {
    const projRegex = new RegExp(`\\b${options.projectName}\\b`, "gi");
    if (projRegex.test(text)) {
      text = text.replace(projRegex, "the application");
      changesMade.push(`Generalized project name '${options.projectName}' to 'the application'`);
    }
  }

  // Clean up excessive whitespace
  text = text.replace(/\s{2,}/g, " ").trim();

  const generalizable = isContentGeneralizable(text);
  const specificityScore = calculateSpecificityScore(text, options.projectName);

  return {
    original,
    generalized: text,
    isGeneralizable: generalizable,
    changesMade,
    specificityScore,
  };
}
