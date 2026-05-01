export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  id: string;
  severity: LintSeverity;
  message: string;
  fix?: () => { content?: string; frontmatter?: Record<string, unknown> };
}

/** Known template variables that are valid in prompt content. */
const KNOWN_VARIABLES = new Set(["workingDir", "previousOutput"]);

/** Regex that matches {{variableName}} placeholders. */
const VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

export function lintPrompt(
  content: string,
  frontmatter: Record<string, unknown>,
  _allPrompts: { filename?: string | null }[] = [],
): LintIssue[] {
  const issues: LintIssue[] = [];
  const body = content.trim();

  // ── no-content ─────────────────────────────────────────────────────────────
  if (body.length === 0) {
    issues.push({
      id: "no-content",
      severity: "error",
      message: "Prompt has no content. Add instructions for Claude to execute.",
    });
    return issues;
  }

  // ── prompt-too-short ───────────────────────────────────────────────────────
  if (body.length < 50) {
    issues.push({
      id: "prompt-too-short",
      severity: "warning",
      message: `Prompt is very short (${body.length} chars). Consider adding more detailed instructions.`,
    });
  }

  // ── prompt-too-long ────────────────────────────────────────────────────────
  if (content.length > 5000) {
    issues.push({
      id: "prompt-too-long",
      severity: "warning",
      message: `Prompt is long (${content.length} chars, max recommended 5000). Consider splitting into multiple prompts.`,
    });
  }

  // ── no-frontmatter ─────────────────────────────────────────────────────────
  if (Object.keys(frontmatter).length === 0) {
    issues.push({
      id: "no-frontmatter",
      severity: "info",
      message: "No frontmatter found. Adding configuration like allowedTools is recommended.",
    });
  }

  // ── bypass-no-justification ────────────────────────────────────────────────
  if (frontmatter["permissionMode"] === "bypassPermissions") {
    issues.push({
      id: "bypass-no-justification",
      severity: "warning",
      message:
        'Permission mode is set to "bypassPermissions". Ensure this is intentional and necessary for this step.',
    });
  }

  // ── no-rollback-with-bypass ────────────────────────────────────────────────
  if (
    frontmatter["permissionMode"] === "bypassPermissions" &&
    frontmatter["rollbackOnFail"] === false
  ) {
    issues.push({
      id: "no-rollback-with-bypass",
      severity: "warning",
      message:
        "bypassPermissions is enabled but rollbackOnFail is false. Destructive operations will not be rolled back on failure.",
      fix: () => ({ frontmatter: { ...frontmatter, rollbackOnFail: true } }),
    });
  }

  // ── missing-success-criteria ───────────────────────────────────────────────
  const successKeywords = /criteria|acceptance|validaci[oó]n|criterio|verify/i;
  if (!successKeywords.test(content)) {
    issues.push({
      id: "missing-success-criteria",
      severity: "info",
      message:
        "No success criteria detected. Consider describing what a successful outcome looks like.",
    });
  }

  // ── unknown-variable ───────────────────────────────────────────────────────
  const unknownVars = new Set<string>();
  VARIABLE_REGEX.lastIndex = 0;
  let match = VARIABLE_REGEX.exec(content);
  while (match !== null) {
    const varName = match[1];
    if (varName !== undefined && !KNOWN_VARIABLES.has(varName)) {
      unknownVars.add(varName);
    }
    match = VARIABLE_REGEX.exec(content);
  }

  if (unknownVars.size > 0) {
    const varList = Array.from(unknownVars)
      .map((v) => `{{${v}}}`)
      .join(", ");
    issues.push({
      id: "unknown-variable",
      severity: "warning",
      message: `Unknown template variable(s): ${varList}. Only {{workingDir}} and {{previousOutput}} are supported.`,
    });
  }

  return issues;
}
