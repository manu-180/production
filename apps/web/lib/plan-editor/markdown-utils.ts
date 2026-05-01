export interface ParsedFrontmatter {
  [key: string]: unknown;
}

interface ParseResult {
  frontmatter: ParsedFrontmatter;
  body: string;
}

/** Match the opening --- and closing --- delimiters at the start of the string. */
const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Parse a simple YAML-like key: value block.
 * Handles strings, booleans, numbers, and arrays (flow `[a, b]` and block `- item`).
 */
function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes(".") ? Number.parseFloat(trimmed) : Number.parseInt(trimmed, 10);
  }

  // Flow array: [item1, item2]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((s) => {
      const v = s.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      return parseYamlValue(v);
    });
  }

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Parse frontmatter and body from a markdown string.
 * Returns empty frontmatter and the full content as body if no --- block is found.
 */
export function parseFrontmatter(content: string): ParseResult {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = match[1] ?? "";
  const body = content.slice(match[0].length);
  const frontmatter: ParsedFrontmatter = {};

  const lines = yamlBlock.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    // Block array: next lines that start with "  - "
    if (rawValue === "") {
      const items: unknown[] = [];
      i++;
      while (i < lines.length && /^\s+-\s/.test(lines[i] ?? "")) {
        const rawItem = (lines[i] ?? "").replace(/^\s+-\s/, "").trim();
        if (
          (rawItem.startsWith('"') && rawItem.endsWith('"')) ||
          (rawItem.startsWith("'") && rawItem.endsWith("'"))
        ) {
          items.push(rawItem.slice(1, -1));
        } else {
          items.push(parseYamlValue(rawItem));
        }
        i++;
      }
      frontmatter[key] = items;
      continue;
    }

    frontmatter[key] = parseYamlValue(rawValue);
    i++;
  }

  return { frontmatter, body };
}

/** Serialize a value to a YAML scalar or flow collection. */
function serializeYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => {
      if (typeof v === "string") return `"${v}"`;
      return serializeYamlValue(v);
    });
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "string") {
    const needsQuoting =
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      /^[-\d]/.test(value) ||
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n");
    return needsQuoting ? `"${value.replace(/"/g, '\\"')}"` : value;
  }
  return JSON.stringify(value);
}

/**
 * Serialize a frontmatter object and body back to a complete markdown string.
 * Output format: "---\nkey: value\n---\n\nbody"
 */
export function serializeFrontmatter(fm: ParsedFrontmatter, body: string): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return body;

  const lines: string[] = ["---"];
  for (const key of keys) {
    const value = fm[key];
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          if (typeof item === "string") {
            lines.push(`  - "${item}"`);
          } else {
            lines.push(`  - ${serializeYamlValue(item)}`);
          }
        }
      }
    } else {
      lines.push(`${key}: ${serializeYamlValue(value)}`);
    }
  }
  lines.push("---");

  const trimmedBody = body.startsWith("\n") ? body : `\n${body}`;
  return lines.join("\n") + trimmedBody;
}

/**
 * Strip the frontmatter block from a markdown string and return only the body.
 */
export function stripFrontmatter(content: string): string {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return content;
  return content.slice(match[0].length);
}

/**
 * Extract a display title from a markdown string.
 * Checks frontmatter `title` field first, then the first # Heading in the body.
 * Falls back to the provided fallback string, or "Untitled" if none given.
 */
export function extractTitle(content: string, fallback?: string): string {
  const { frontmatter, body } = parseFrontmatter(content);

  const fmTitle = frontmatter["title"];
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) {
    return fmTitle.trim();
  }

  const headingMatch = /^#{1,2}\s+(.+)$/m.exec(body);
  if (headingMatch) {
    const heading = headingMatch[1];
    if (heading !== undefined) return heading.trim();
  }

  return fallback ?? "Untitled";
}
