/**
 * Vibeguard Autonomous Secret Defense Engine (Pure TypeScript, Zero-Dependency)
 * Intercepts credentials, private keys, API tokens, and database connection strings before write.
 */

export interface SecretMatch {
  pattern: string;
  matched: string;
}

export const SECRET_RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "OpenAI / Anthropic / Generic AI API Key",
    pattern: /(?:sk-(?:proj-|ant-|live-)?[a-zA-Z0-9_-]{20,})/,
  },
  {
    name: "GitHub Token",
    pattern: /(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{50,})/,
  },
  {
    name: "NPM Access Token",
    pattern: /(?:npm_[a-zA-Z0-9]{36,})/,
  },
  {
    name: "AWS Access Key ID",
    pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    name: "Private Key Block",
    pattern: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP|ENCRYPTED|PRIVATE)? ?KEY|PRIVATE KEY/i,
  },
  {
    name: "Slack Token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/,
  },
  {
    name: "Database Connection String with Credentials",
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis|amqp)(?:\+srv)?:\/\/[^\s@:]+:[^\s@]+@[^\s/]+/i,
  },
  {
    name: "Generic Credential Assignment",
    pattern: /(?:password|passwd|secret_key|api_key|apikey|auth_token|bearer_token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-\.]{8,}['"]?/i,
  },
];

/**
 * Scans a given text string for secret signatures.
 * Returns an array of matched rule names.
 */
export function scanSecrets(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches: string[] = [];
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(text)) {
      matches.push(rule.name);
    }
  }
  return matches;
}

/**
 * Returns true if the text contains any secret signatures.
 */
export function hasSecret(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return SECRET_RULES.some((rule) => rule.pattern.test(text));
}

/**
 * Safely masks detected secrets in text strings for reporting.
 * Preserves regex flags (such as case-insensitivity 'i') when constructing global matchers.
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const rule of SECRET_RULES) {
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
    result = result.replace(new RegExp(rule.pattern.source, flags), "[REDACTED_SECRET]");
  }
  return result;
}
