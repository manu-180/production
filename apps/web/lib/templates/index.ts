export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Lucide icon name (PascalCase) used for rendering in the gallery card. */
  iconName?: string;
  prompts: Array<{
    filename: string;
    title: string;
    content: string;
    frontmatter: Record<string, unknown>;
  }>;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ─── 1. Web App MVP ──────────────────────────────────────────────────────────
  {
    id: "web-app-mvp",
    name: "Web App MVP (Next.js + Supabase)",
    description:
      "Scaffold a full-stack MVP with Next.js 15 App Router, Supabase auth, and a basic CRUD feature. Produces a working, deployable application skeleton with authentication, a data model, and a UI.",
    tags: ["nextjs", "supabase", "mvp", "fullstack"],
    prompts: [
      {
        filename: "01-scaffold-project.md",
        title: "Scaffold Project Structure",
        content: `# Scaffold Project Structure

Set up the Next.js 15 App Router project with TypeScript strict mode, Tailwind CSS v4, and shadcn/ui.
Create the folder structure: \`app/\`, \`components/\`, \`lib/\`, and \`types/\`.
Initialize the Supabase client in \`lib/supabase/client.ts\` and \`lib/supabase/server.ts\`.
Add environment variable placeholders in \`.env.local.example\` and document each variable.
Verify the acceptance criteria: dev server starts without errors and the home page renders.`,
        frontmatter: {
          title: "Scaffold Project Structure",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "default",
          maxTurns: 30,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["setup", "scaffold"],
        },
      },
      {
        filename: "02-supabase-auth.md",
        title: "Implement Supabase Auth",
        content: `# Implement Supabase Auth

Create the authentication flow using Supabase Auth with email + password and GitHub OAuth.
Build the sign-in, sign-up, and sign-out UI pages under \`app/(auth)/\`.
Add a middleware in \`middleware.ts\` to protect routes that require authentication.
Store the session server-side via the Supabase SSR helpers and expose a \`useUser\` hook on the client.
Verify the acceptance criteria: a new user can register, log in, and see their email in the header.`,
        frontmatter: {
          title: "Implement Supabase Auth",
          allowedTools: ["Bash", "Read", "Write", "Edit", "Glob"],
          permissionMode: "default",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["auth", "supabase"],
          dependsOn: ["01-scaffold-project.md"],
        },
      },
      {
        filename: "03-data-model.md",
        title: "Define Data Model & RLS",
        content: `# Define Data Model & RLS

Create the primary Supabase migration for the core entity (e.g., \`items\`) with columns: \`id\`, \`user_id\`, \`name\`, \`description\`, \`created_at\`, \`updated_at\`.
Enable Row Level Security on the table and write policies so users can only read and mutate their own rows.
Generate TypeScript types from the schema using the Supabase CLI and place them in \`packages/db/src/types.gen.ts\`.
Verify the acceptance criteria: migration applies cleanly, RLS blocks cross-user queries in the SQL editor.`,
        frontmatter: {
          title: "Define Data Model & RLS",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "default",
          maxTurns: 25,
          requiresApproval: true,
          rollbackOnFail: true,
          tags: ["database", "supabase", "rls"],
          dependsOn: ["01-scaffold-project.md"],
        },
      },
      {
        filename: "04-crud-ui.md",
        title: "Build CRUD UI",
        content: `# Build CRUD UI

Implement the list, create, edit, and delete flows for the core entity using React Server Components for data fetching and Server Actions for mutations.
Display the list at \`app/(dashboard)/items/page.tsx\` with optimistic updates on delete.
Add a modal or slide-over form for creating and editing records, with Zod-validated inputs.
Verify the acceptance criteria: a logged-in user can create 3 items, edit one, delete another, and the list updates without a full page reload.`,
        frontmatter: {
          title: "Build CRUD UI",
          allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["ui", "crud"],
          dependsOn: ["02-supabase-auth.md", "03-data-model.md"],
        },
      },
    ],
  },

  // ─── 2. Refactor Legacy Codebase ─────────────────────────────────────────────
  {
    id: "refactor-legacy",
    name: "Refactor Legacy Codebase",
    description:
      "Systematically improve an existing codebase: audit tech debt, apply safe refactors, and add a test suite without breaking existing behavior.",
    tags: ["refactor", "typescript", "testing"],
    prompts: [
      {
        filename: "01-audit.md",
        title: "Audit Tech Debt",
        content: `# Audit Tech Debt

Scan the working directory for: files larger than 300 lines, functions with cyclomatic complexity above 10, \`any\` TypeScript types, and missing error handling in async functions.
Produce a structured report in \`TECH_DEBT.md\` with severity (high/medium/low) and file locations.
Do not change any source files in this step — discovery only.
Verify the acceptance criteria: \`TECH_DEBT.md\` exists and lists at least the top 10 issues.`,
        frontmatter: {
          title: "Audit Tech Debt",
          allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
          permissionMode: "default",
          maxTurns: 30,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["audit"],
        },
      },
      {
        filename: "02-type-safety.md",
        title: "Improve Type Safety",
        content: `# Improve Type Safety

Address all HIGH and MEDIUM severity \`any\` type issues identified in \`TECH_DEBT.md\`.
Replace \`any\` with proper TypeScript types, adding interfaces or type aliases as needed.
Run \`tsc --noEmit\` after each file change and ensure zero new type errors are introduced.
Verify the acceptance criteria: \`tsc --noEmit\` exits 0 and \`grep -r "any" src/ --include="*.ts"\` returns fewer results than before.`,
        frontmatter: {
          title: "Improve Type Safety",
          allowedTools: ["Bash", "Read", "Edit", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 50,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["typescript"],
          dependsOn: ["01-audit.md"],
        },
      },
      {
        filename: "03-add-tests.md",
        title: "Add Test Coverage",
        content: `# Add Test Coverage

Write unit tests for the top 5 highest-complexity functions identified in the audit, using Vitest and Testing Library as appropriate.
Each test file should live next to the file it tests (\`*.test.ts\`).
Tests must cover the happy path, at least one error path, and any edge cases documented in the source.
Verify the acceptance criteria: \`vitest run\` exits 0 and coverage for the targeted functions is above 80%.`,
        frontmatter: {
          title: "Add Test Coverage",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["testing", "vitest"],
          dependsOn: ["02-type-safety.md"],
        },
      },
    ],
  },

  // ─── 3. Component Library ────────────────────────────────────────────────────
  {
    id: "component-library",
    name: "Build Component Library",
    description:
      "Design and implement a reusable component library with TypeScript, Tailwind, shadcn/ui, and Storybook documentation.",
    tags: ["components", "design-system", "storybook"],
    prompts: [
      {
        filename: "01-design-tokens.md",
        title: "Define Design Tokens",
        content: `# Define Design Tokens

Create a design token system in \`lib/tokens.ts\` covering: color palette (primary, secondary, neutral, semantic), spacing scale, border radii, font sizes, and shadow levels.
Map the tokens to Tailwind CSS variables in \`tailwind.config.ts\` so they are available as utility classes.
Create a visual token reference page at \`app/(docs)/tokens/page.tsx\` that renders every token.
Verify the acceptance criteria: all tokens render correctly in the reference page and the Tailwind build includes no unused variable warnings.`,
        frontmatter: {
          title: "Define Design Tokens",
          allowedTools: ["Read", "Write", "Edit"],
          permissionMode: "default",
          maxTurns: 25,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["design-tokens", "tailwind"],
        },
      },
      {
        filename: "02-core-components.md",
        title: "Build Core Components",
        content: `# Build Core Components

Implement these primitive components using shadcn/ui as base: Button (5 variants), Input, Textarea, Select, Checkbox, Radio, Switch, Badge, and Avatar.
Each component must accept a \`className\` prop, forward refs, and export its props type.
Apply design tokens from the previous step for all visual values.
Verify the acceptance criteria: TypeScript compiles with zero errors and all components render in isolation without console warnings.`,
        frontmatter: {
          title: "Build Core Components",
          allowedTools: ["Read", "Write", "Edit", "Glob"],
          permissionMode: "default",
          maxTurns: 80,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["components", "shadcn"],
          dependsOn: ["01-design-tokens.md"],
        },
      },
      {
        filename: "03-storybook-stories.md",
        title: "Write Storybook Stories",
        content: `# Write Storybook Stories

Create a \`.stories.tsx\` file for each component built in the previous step, following the Component Story Format 3 (CSF3) standard.
Each story file must include: a Default story, stories for every variant, and a story demonstrating an error/disabled state.
Add Storybook a11y and interactions addons and ensure each story passes axe accessibility checks.
Verify the acceptance criteria: \`storybook build\` exits 0 and opening the built output shows all components with no a11y violations.`,
        frontmatter: {
          title: "Write Storybook Stories",
          allowedTools: ["Read", "Write", "Edit", "Bash"],
          permissionMode: "default",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["storybook", "documentation"],
          dependsOn: ["02-core-components.md"],
        },
      },
    ],
  },

  // ─── 4. Generate Tests ───────────────────────────────────────────────────────
  {
    id: "generate-tests",
    name: "Generate Test Suite",
    description:
      "Automatically generate a comprehensive test suite for an existing codebase: unit tests, integration tests, and end-to-end flows.",
    tags: ["testing", "vitest", "playwright"],
    prompts: [
      {
        filename: "01-unit-tests.md",
        title: "Generate Unit Tests",
        content: `# Generate Unit Tests

Scan all utility and helper functions in \`lib/\` and \`packages/\` that have no corresponding \`*.test.ts\` file.
Generate Vitest unit tests covering: expected output for valid inputs, thrown errors for invalid inputs, and boundary conditions.
Follow the AAA pattern (Arrange, Act, Assert) and keep each test file under 200 lines.
Verify the acceptance criteria: \`vitest run --reporter=verbose\` exits 0 and no test file has more than 5 skipped tests.`,
        frontmatter: {
          title: "Generate Unit Tests",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["unit-tests", "vitest"],
        },
      },
      {
        filename: "02-integration-tests.md",
        title: "Generate Integration Tests",
        content: `# Generate Integration Tests

Write integration tests for all API route handlers in \`app/api/\` using \`next-test-api-route-handler\` or \`msw\` to mock the Supabase client.
Cover: 200 success responses with valid payloads, 400 validation errors, and 401 unauthenticated requests.
Each route handler must have at least one test that verifies the database call arguments.
Verify the acceptance criteria: \`vitest run\` passes all integration test files and coverage for API routes is above 70%.`,
        frontmatter: {
          title: "Generate Integration Tests",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["integration-tests"],
          dependsOn: ["01-unit-tests.md"],
        },
      },
      {
        filename: "03-e2e-flows.md",
        title: "Write E2E Critical Flows",
        content: `# Write E2E Critical Flows

Create Playwright tests for the 3 most critical user journeys: registration + first login, the core CRUD happy path, and account settings update.
Tests should run against the local dev server (\`http://localhost:3000\`) and use Playwright's built-in \`page.getByRole\` selectors for accessibility.
Add a \`playwright.config.ts\` if one does not exist with webkit, chromium, and firefox projects.
Verify the acceptance criteria: \`playwright test\` passes in headless mode across all three browser projects.`,
        frontmatter: {
          title: "Write E2E Critical Flows",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "default",
          maxTurns: 50,
          requiresApproval: true,
          rollbackOnFail: false,
          tags: ["e2e", "playwright"],
          dependsOn: ["02-integration-tests.md"],
        },
      },
    ],
  },

  // ─── 5. API Documentation ────────────────────────────────────────────────────
  {
    id: "api-documentation",
    name: "API Documentation",
    description:
      "Generate comprehensive OpenAPI 3.1 documentation from existing route handlers and publish an interactive Swagger UI.",
    tags: ["docs", "openapi", "swagger"],
    prompts: [
      {
        filename: "01-generate-openapi.md",
        title: "Generate OpenAPI Schema",
        content: `# Generate OpenAPI Schema

Inspect all route handlers in \`app/api/\` and their Zod validators in \`lib/validators/\` to produce a complete OpenAPI 3.1 spec at \`public/openapi.json\`.
Document each endpoint with: summary, description, request body schema (from Zod), all response schemas (200, 400, 401, 404, 500), and security requirements.
Use the \`zod-to-json-schema\` pattern to convert Zod schemas to JSON Schema components.
Verify the acceptance criteria: \`openapi.json\` is valid OpenAPI 3.1 (lint with \`spectral lint\`) and covers all 100% of endpoints.`,
        frontmatter: {
          title: "Generate OpenAPI Schema",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "default",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["openapi", "documentation"],
        },
      },
      {
        filename: "02-swagger-ui.md",
        title: "Publish Interactive Docs",
        content: `# Publish Interactive Docs

Set up a Swagger UI page at \`app/(docs)/api/page.tsx\` that reads \`/openapi.json\` and renders an interactive API explorer.
Use the \`swagger-ui-react\` package and wrap it in a Client Component with a custom theme matching the app's design tokens.
Add an "Authorize" button pre-configured with the Bearer token scheme so developers can test authenticated endpoints directly.
Verify the acceptance criteria: the docs page renders all endpoints, the authorize flow works, and a test request to a protected endpoint returns a real response.`,
        frontmatter: {
          title: "Publish Interactive Docs",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "default",
          maxTurns: 30,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["swagger", "ui"],
          dependsOn: ["01-generate-openapi.md"],
        },
      },
    ],
  },

  // ─── 6. Database Migration ───────────────────────────────────────────────────
  {
    id: "database-migration",
    name: "Database Migration",
    description:
      "Safely plan, execute, and verify a Supabase Postgres schema migration with zero downtime and full rollback capability.",
    tags: ["database", "migration", "supabase"],
    prompts: [
      {
        filename: "01-plan-migration.md",
        title: "Plan Migration",
        content: `# Plan Migration

Analyse the current schema by reading all files in \`supabase/migrations/\` and the output of \`supabase db diff\`.
Identify the required changes (new tables, column additions/renames, index changes, RLS policy updates) and produce a migration plan in \`MIGRATION_PLAN.md\`.
Flag any changes that require a multi-step process (e.g., column renames must be done in two migrations to avoid downtime).
Verify the acceptance criteria: \`MIGRATION_PLAN.md\` exists, lists every DDL statement in order, and includes a rollback SQL block for each step.`,
        frontmatter: {
          title: "Plan Migration",
          allowedTools: ["Bash", "Read", "Write", "Glob"],
          permissionMode: "default",
          maxTurns: 20,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["planning"],
        },
      },
      {
        filename: "02-write-migration.md",
        title: "Write Migration Files",
        content: `# Write Migration Files

Using the plan from \`MIGRATION_PLAN.md\`, create the Supabase migration SQL files in \`supabase/migrations/\` with the conventional timestamp prefix.
Each migration file must include an explicit transaction block (\`BEGIN; ... COMMIT;\`) and a matching rollback script saved alongside it as \`<timestamp>_rollback.sql\`.
Regenerate TypeScript types after writing the migrations: \`supabase gen types typescript --local > packages/db/src/types.gen.ts\`.
Verify the acceptance criteria: \`supabase db push --dry-run\` reports no errors and the generated types compile with \`tsc --noEmit\`.`,
        frontmatter: {
          title: "Write Migration Files",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "default",
          maxTurns: 30,
          requiresApproval: true,
          rollbackOnFail: true,
          tags: ["migration", "sql"],
          dependsOn: ["01-plan-migration.md"],
        },
      },
      {
        filename: "03-apply-and-verify.md",
        title: "Apply Migration & Verify",
        content: `# Apply Migration & Verify

Apply the migration to the local Supabase instance with \`supabase db push\` and run the seed script to restore test data.
Execute the verification queries listed in \`MIGRATION_PLAN.md\` to confirm the schema matches expectations and RLS policies are enforced correctly.
Run the full test suite (\`vitest run\` + \`playwright test\`) to confirm no existing functionality was broken by the schema change.
Verify the acceptance criteria: all tests pass, \`supabase db diff\` reports a clean state, and the application starts without migration-related errors.`,
        frontmatter: {
          title: "Apply Migration & Verify",
          allowedTools: ["Bash", "Read"],
          permissionMode: "bypassPermissions",
          maxTurns: 20,
          requiresApproval: true,
          rollbackOnFail: true,
          tags: ["verification"],
          dependsOn: ["02-write-migration.md"],
        },
      },
    ],
  },
];

export function getTemplateById(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
