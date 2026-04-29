import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Logger, createLogger } from "../logger.js";

/**
 * Result of injecting Guardian guidelines into a prompt.
 */
export interface InjectionResult {
  /** Original prompt with the `[GUARDIAN GUIDELINES]` block appended. */
  prompt: string;
  /** Whether the default block or a user-provided one was used. */
  guidelinesUsed: "default" | "custom";
  /** Path to the custom guidelines file when one was loaded. */
  customPath?: string;
}

interface SystemPromptInjectorConfig {
  /**
   * Override path for the custom guidelines file. When omitted, the injector
   * looks at `~/.conductor/guidelines.md`.
   */
  guidelinesPath?: string;
}

interface LoadedGuidelines {
  /** Raw guideline text (without the `[GUARDIAN GUIDELINES]` wrapper). */
  body: string;
  source: "default" | "custom";
  customPath?: string;
}

const DEFAULT_GUIDELINES_BODY = `- NO hagas preguntas. Decidí siempre con criterio de buenas prácticas y escalabilidad.
- Si encontrás ambigüedad, elegí la opción más mantenible y documentala como comentario en el código (// DECISION: ...).
- Stack del proyecto (no proponer alternativas):
  - Web: Next.js 15 + TypeScript strict + Tailwind + shadcn/ui
  - Mobile: Flutter + Riverpod
  - DB: Supabase (Postgres + RLS + Realtime + Storage)
  - Tests: Vitest (unit) + Playwright (E2E)
- Convenciones: kebab-case files, PascalCase components, camelCase utils
- Preferí: composición > herencia, async/await > promises chained, tipos explícitos > inferencia agresiva
- En caso de error: loggea con contexto, fail loud, no swallow
- Trabajamos en \`main\` directo, sin branches.`;

const GUIDELINES_HEADER = "[GUARDIAN GUIDELINES]";
const GUIDELINES_FOOTER = "[/GUARDIAN GUIDELINES]";

/**
 * Appends a `[GUARDIAN GUIDELINES]` block to every prompt before the run is
 * dispatched to the Claude CLI. The block can be customised by writing to
 * `~/.conductor/guidelines.md`; otherwise a hardcoded default is used.
 *
 * The custom file is read lazily on the first call and cached for subsequent
 * calls. Read failures other than ENOENT are logged and degrade gracefully to
 * the default block.
 */
export class SystemPromptInjector {
  private readonly logger: Logger;
  private readonly guidelinesPath: string;
  private cached: LoadedGuidelines | null = null;

  constructor(config?: SystemPromptInjectorConfig) {
    this.logger = createLogger("guardian:system-prompt-injector");
    this.guidelinesPath = config?.guidelinesPath ?? defaultGuidelinesPath();
  }

  /**
   * Append the Guardian guidelines block to `originalPrompt`. The block is
   * separated from the original prompt by a blank line so it reads cleanly
   * regardless of how the caller terminated their prompt.
   */
  inject(originalPrompt: string): InjectionResult {
    const loaded = this.loadGuidelines();
    const block = wrapGuidelines(loaded.body);
    const prompt = `${originalPrompt}\n\n${block}`;

    if (loaded.source === "custom" && loaded.customPath) {
      return {
        prompt,
        guidelinesUsed: "custom",
        customPath: loaded.customPath,
      };
    }
    return {
      prompt,
      guidelinesUsed: "default",
    };
  }

  /**
   * Return the raw guidelines string (without the `[GUARDIAN GUIDELINES]`
   * wrapper). Useful for logging which guidelines were used on a given run.
   */
  getGuidelines(): string {
    return this.loadGuidelines().body;
  }

  private loadGuidelines(): LoadedGuidelines {
    if (this.cached) {
      return this.cached;
    }

    const loaded = this.readCustomGuidelines();
    this.cached = loaded;
    return loaded;
  }

  private readCustomGuidelines(): LoadedGuidelines {
    try {
      const raw = readFileSync(this.guidelinesPath, "utf-8");
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        this.logger.debug(
          { guidelinesPath: this.guidelinesPath },
          "custom guidelines file is empty — using default",
        );
        return { body: DEFAULT_GUIDELINES_BODY, source: "default" };
      }
      this.logger.debug(
        { guidelinesPath: this.guidelinesPath, bytes: raw.length },
        "loaded custom guidelines",
      );
      return {
        body: trimmed,
        source: "custom",
        customPath: this.guidelinesPath,
      };
    } catch (err) {
      if (isEnoent(err)) {
        this.logger.debug(
          { guidelinesPath: this.guidelinesPath },
          "no custom guidelines file — using default",
        );
        return { body: DEFAULT_GUIDELINES_BODY, source: "default" };
      }
      this.logger.warn(
        { err, guidelinesPath: this.guidelinesPath },
        "failed to read custom guidelines — falling back to default",
      );
      return { body: DEFAULT_GUIDELINES_BODY, source: "default" };
    }
  }
}

function defaultGuidelinesPath(): string {
  return join(homedir(), ".conductor", "guidelines.md");
}

function wrapGuidelines(body: string): string {
  return `${GUIDELINES_HEADER}\n${body}\n${GUIDELINES_FOOTER}`;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
