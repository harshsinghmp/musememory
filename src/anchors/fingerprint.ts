import { createHash } from "node:crypto";

/**
 * Normalizes code by stripping comments, normalizing structural punctuation, and collapsing whitespace.
 * Ensures the structural hash is immune to line shifts, comment edits, and formatting changes.
 */
export function normalizeStructuralCode(code: string): string {
  if (!code) return "";
  
  // 1. Remove single-line comments (// ... and # ...)
  let stripped = code.replace(/(?:^|[^\\])\/\/.*$/gm, "").replace(/(?:^|[^\\])#.*$/gm, "");

  // 2. Remove multi-line block comments (/* ... */)
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

  // 3. Normalize all whitespace sequences to a single space
  let collapsed = stripped.replace(/\s+/g, " ").trim();

  // 4. Normalize spaces around structural punctuation
  collapsed = collapsed.replace(/\s*([(){}[\];,])\s*/g, "$1");

  return collapsed;
}

/**
 * Computes a deterministic SHA-256 hash of structurally normalized code.
 */
export function computeStructuralHash(code: string): string {
  const normalized = normalizeStructuralCode(code);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Extracts a symbol's declaration signature and body from source code using lightweight regex and balanced brace parsing.
 */
export function extractSymbolBody(
  fileContent: string,
  symbolName: string
): { found: boolean; signature?: string; body?: string } {
  if (!fileContent || !symbolName) return { found: false };

  // Match function, class, interface, type, const, def, fn, func
  const symbolRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:function\\s+|class\\s+|interface\\s+|type\\s+|const\\s+|let\\s+|var\\s+|def\\s+|fn\\s+|func\\s+)` +
      `(${symbolName})` +
      `\\b`,
    "m"
  );

  const match = symbolRegex.exec(fileContent);
  if (!match) {
    // Fallback: check if symbol appears as a class method with optional return type: method(...) [ : ReturnType ] {
    const methodRegex = new RegExp(`(?:async\\s+)?(${symbolName})\\s*\\([^)]*\\)(?:\\s*:[^{]+)?\\s*\\{`, "m");
    const methodMatch = methodRegex.exec(fileContent);
    if (!methodMatch) return { found: false };

    const startIndex = methodMatch.index;
    const braceIndex = fileContent.indexOf("{", startIndex);
    if (braceIndex === -1) return { found: true, signature: methodMatch[0].trim() };

    const body = extractBalancedBlock(fileContent, braceIndex);
    return {
      found: true,
      signature: fileContent.slice(startIndex, braceIndex).trim(),
      body,
    };
  }

  const startIndex = match.index;
  const lineEnd = fileContent.indexOf("\n", startIndex);
  const signatureLine = lineEnd !== -1 ? fileContent.slice(startIndex, lineEnd).trim() : fileContent.slice(startIndex).trim();

  // Find opening brace for body
  const braceIndex = fileContent.indexOf("{", startIndex);
  if (braceIndex !== -1 && braceIndex - startIndex < 300) {
    const body = extractBalancedBlock(fileContent, braceIndex);
    return {
      found: true,
      signature: fileContent.slice(startIndex, braceIndex).trim(),
      body,
    };
  }

  // For python or non-brace languages, extract block by indentation or line
  const lines = fileContent.slice(startIndex).split("\n");
  const blockLines = [lines[0]];
  for (let i = 1; i < Math.min(lines.length, 50); i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      blockLines.push(line);
    } else {
      break;
    }
  }

  return {
    found: true,
    signature: signatureLine,
    body: blockLines.join("\n"),
  };
}

/**
 * Extracts a block enclosed by balanced curly braces { ... }.
 */
function extractBalancedBlock(text: string, openBraceIndex: number): string {
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = openBraceIndex; i < text.length; i++) {
    const char = text[i];
    const prev = i > 0 ? text[i - 1] : "";

    if ((char === '"' || char === "'" || char === "`") && prev !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (stringChar === char) {
        inString = false;
      }
      continue;
    }

    if (!inString) {
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(openBraceIndex, i + 1);
        }
      }
    }
  }

  return text.slice(openBraceIndex);
}
