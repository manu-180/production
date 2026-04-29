import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { type Logger, createLogger } from "../../logger.js";
import type { DecisionInput, DecisionResult, DecisionStrategy } from "../decision-engine.js";

/**
 * Shape of a single rule entry in `~/.conductor/rules.yaml`.
 *
 * - `match`: case-insensitive substring match against the question.
 * - `matchPattern`: regex (case-insensitive) match against the question.
 * - `answer`: the decision text to return on match.
 *
 * If both `match` and `matchPattern` are present on the same rule, `match`
 * is tried first.
 */
export interface UserRule {
  match?: string;
  matchPattern?: string;
  answer: string;
}

/** Parsed shape of `~/.conductor/rules.yaml`. */
export interface UserRulesFile {
  rules: UserRule[];
}

const DEFAULT_RULES_PATH = join(homedir(), ".conductor", "rules.yaml");

/**
 * Strategy that consults the user's `~/.conductor/rules.yaml` file. If the
 * file is missing or malformed, the strategy returns `null` so the engine
 * can move on to the next strategy.
 */
export class RulesStrategy implements DecisionStrategy {
  public readonly name = "rules";
  private readonly logger: Logger;
  private readonly rulesPath: string;
  private cache: { rules: UserRule[]; loaded: true } | null = null;
  private loadAttempted = false;

  constructor(rulesPath: string = DEFAULT_RULES_PATH) {
    this.logger = createLogger("guardian:strategy-rules");
    this.rulesPath = rulesPath;
  }

  async resolve(input: DecisionInput): Promise<DecisionResult | null> {
    const rules = this.getRules();
    if (!rules || rules.length === 0) {
      return null;
    }

    const question = input.question ?? "";
    const lowered = question.toLowerCase();

    // First pass: substring matches.
    for (const rule of rules) {
      if (typeof rule.match === "string" && rule.match.length > 0) {
        if (lowered.includes(rule.match.toLowerCase())) {
          this.logger.debug({ match: rule.match }, "matched user rule by substring");
          return {
            decision: rule.answer,
            reasoning: `matched user rule: ${rule.match}`,
            confidence: 1,
            strategy: "rule",
            requiresHumanReview: false,
          };
        }
      }
    }

    // Second pass: regex patterns.
    for (const rule of rules) {
      if (typeof rule.matchPattern === "string" && rule.matchPattern.length > 0) {
        let regex: RegExp;
        try {
          regex = new RegExp(rule.matchPattern, "i");
        } catch (err) {
          this.logger.warn(
            { err, pattern: rule.matchPattern },
            "invalid regex in user rule — skipping",
          );
          continue;
        }
        if (regex.test(question)) {
          this.logger.debug({ pattern: rule.matchPattern }, "matched user rule by regex");
          return {
            decision: rule.answer,
            reasoning: `matched user rule: ${rule.matchPattern}`,
            confidence: 1,
            strategy: "rule",
            requiresHumanReview: false,
          };
        }
      }
    }

    return null;
  }

  /**
   * Lazily load and cache the rules file. Any error (missing file, invalid
   * YAML, wrong shape) results in an empty rule set and a warn log.
   */
  private getRules(): UserRule[] | null {
    if (this.cache) {
      return this.cache.rules;
    }
    if (this.loadAttempted) {
      return null;
    }
    this.loadAttempted = true;

    let raw: string;
    try {
      raw = readFileSync(this.rulesPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.logger.debug({ path: this.rulesPath }, "rules file not found — skipping");
      } else {
        this.logger.warn({ err, path: this.rulesPath }, "could not read rules file");
      }
      return null;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (err) {
      this.logger.warn({ err, path: this.rulesPath }, "invalid YAML in rules file");
      return null;
    }

    if (!parsed || typeof parsed !== "object") {
      this.logger.warn({ path: this.rulesPath }, "rules file has unexpected shape");
      return null;
    }

    const rulesField = (parsed as Record<string, unknown>)["rules"];
    if (!Array.isArray(rulesField)) {
      this.logger.warn({ path: this.rulesPath }, "rules file has no `rules` array");
      return null;
    }

    const rules: UserRule[] = [];
    for (const entry of rulesField) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const answer = obj["answer"];
      if (typeof answer !== "string" || answer.length === 0) continue;
      const match = typeof obj["match"] === "string" ? (obj["match"] as string) : undefined;
      const matchPattern =
        typeof obj["matchPattern"] === "string" ? (obj["matchPattern"] as string) : undefined;
      if (!match && !matchPattern) continue;
      rules.push({
        answer,
        ...(match ? { match } : {}),
        ...(matchPattern ? { matchPattern } : {}),
      });
    }

    this.cache = { rules, loaded: true };
    this.logger.debug({ count: rules.length, path: this.rulesPath }, "loaded user rules");
    return rules;
  }
}
