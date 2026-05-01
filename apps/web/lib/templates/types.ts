/**
 * Type definitions for Conductor plan templates.
 * Provides a structured interface for defining reusable multi-step plans.
 */

/**
 * A single prompt step within a template plan.
 * Each prompt is a discrete unit of work that Claude CLI executes.
 */
export interface TemplatePrompt {
  /** Order of execution within the plan (1-indexed) */
  order: number;

  /** Short name for this step (e.g., "Setup Auth", "Write Tests") */
  name: string;

  /** The actual Claude prompt text (2-4 sentences, specific and actionable) */
  content: string;

  /** Optional notes shown in the UI to provide context or warnings */
  notes?: string;

  /** Optional dependencies on other step IDs (must complete first) */
  dependsOn?: string[];

  /** Estimated duration for this step in minutes */
  estimatedDurationMin?: number;

  /** Estimated cost for this step in USD */
  estimatedCostUsd?: number;
}

/**
 * A complete template for a multi-step plan.
 * Templates are reusable starting points for common development tasks.
 */
export interface Template {
  /** kebab-case unique identifier (e.g., "web-app-mvp") */
  id: string;

  /** Display name of the template */
  name: string;

  /** Short description of what the template does (1-2 sentences) */
  description: string;

  /** Author or team that created the template */
  author: string;

  /** Category for filtering and organization */
  category: "web" | "mobile" | "devops" | "data" | "docs";

  /** Tags for searching and filtering (e.g., "nextjs", "testing", "supabase") */
  tags: string[];

  /** Array of prompts executed in order */
  prompts: TemplatePrompt[];

  /** Estimated total duration for the complete plan in minutes */
  estimatedDurationMin: number;

  /** Estimated total cost for the complete plan in USD */
  estimatedCostUsd: number;
}

/**
 * Internal representation of built-in templates as used by Conductor.
 * This is the runtime format for the templates system.
 */
export interface BuiltinTemplateInternal {
  id: string;
  name: string;
  description: string;
  tags: string[];
  iconName?: string;
  prompts: Array<{
    filename: string;
    title: string;
    content: string;
    frontmatter: Record<string, unknown>;
  }>;
}
