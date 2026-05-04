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
    name: "MVP de aplicación web (Next.js + Supabase)",
    description:
      "Generá un MVP full-stack con Next.js 15 App Router, autenticación con Supabase y una funcionalidad CRUD básica. Produce un esqueleto de aplicación funcional y desplegable con autenticación, modelo de datos e interfaz.",
    tags: ["nextjs", "supabase", "mvp", "fullstack"],
    iconName: "Globe",
    prompts: [
      {
        filename: "01-scaffold-project.md",
        title: "Estructurar el proyecto",
        content: `# Scaffold Project Structure

Set up the Next.js 15 App Router project with TypeScript strict mode, Tailwind CSS v4, and shadcn/ui.
Create the folder structure: \`app/\`, \`components/\`, \`lib/\`, and \`types/\`.
Initialize the Supabase client in \`lib/supabase/client.ts\` and \`lib/supabase/server.ts\`.
Add environment variable placeholders in \`.env.local.example\` and document each variable.
Verify the acceptance criteria: dev server starts without errors and the home page renders.`,
        frontmatter: {
          title: "Estructurar el proyecto",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
          maxTurns: 30,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["setup", "scaffold"],
        },
      },
      {
        filename: "02-supabase-auth.md",
        title: "Implementar autenticación con Supabase",
        content: `# Implement Supabase Auth

Create the authentication flow using Supabase Auth with email + password and GitHub OAuth.
Build the sign-in, sign-up, and sign-out UI pages under \`app/(auth)/\`.
Add a middleware in \`middleware.ts\` to protect routes that require authentication.
Store the session server-side via the Supabase SSR helpers and expose a \`useUser\` hook on the client.
Verify the acceptance criteria: a new user can register, log in, and see their email in the header.`,
        frontmatter: {
          title: "Implementar autenticación con Supabase",
          allowedTools: ["Bash", "Read", "Write", "Edit", "Glob"],
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["auth", "supabase"],
          dependsOn: ["01-scaffold-project.md"],
        },
      },
      {
        filename: "03-data-model.md",
        title: "Definir modelo de datos y RLS",
        content: `# Define Data Model & RLS

Create the primary Supabase migration for the core entity (e.g., \`items\`) with columns: \`id\`, \`user_id\`, \`name\`, \`description\`, \`created_at\`, \`updated_at\`.
Enable Row Level Security on the table and write policies so users can only read and mutate their own rows.
Generate TypeScript types from the schema using the Supabase CLI and place them in \`packages/db/src/types.gen.ts\`.
Verify the acceptance criteria: migration applies cleanly, RLS blocks cross-user queries in the SQL editor.`,
        frontmatter: {
          title: "Definir modelo de datos y RLS",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "bypassPermissions",
          maxTurns: 25,
          requiresApproval: true,
          rollbackOnFail: true,
          tags: ["database", "supabase", "rls"],
          dependsOn: ["01-scaffold-project.md"],
        },
      },
      {
        filename: "04-crud-ui.md",
        title: "Construir la interfaz CRUD",
        content: `# Build CRUD UI

Implement the list, create, edit, and delete flows for the core entity using React Server Components for data fetching and Server Actions for mutations.
Display the list at \`app/(dashboard)/items/page.tsx\` with optimistic updates on delete.
Add a modal or slide-over form for creating and editing records, with Zod-validated inputs.
Verify the acceptance criteria: a logged-in user can create 3 items, edit one, delete another, and the list updates without a full page reload.`,
        frontmatter: {
          title: "Construir la interfaz CRUD",
          allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
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
    name: "Refactorizar código legado",
    description:
      "Mejorá sistemáticamente un codebase existente: auditá la deuda técnica, aplicá refactors seguros y agregá una suite de tests sin romper el comportamiento actual.",
    tags: ["refactor", "typescript", "testing"],
    iconName: "Wrench",
    prompts: [
      {
        filename: "01-audit.md",
        title: "Auditar deuda técnica",
        content: `# Audit Tech Debt

Scan the working directory for: files larger than 300 lines, functions with cyclomatic complexity above 10, \`any\` TypeScript types, and missing error handling in async functions.
Produce a structured report in \`TECH_DEBT.md\` with severity (high/medium/low) and file locations.
Do not change any source files in this step — discovery only.
Verify the acceptance criteria: \`TECH_DEBT.md\` exists and lists at least the top 10 issues.`,
        frontmatter: {
          title: "Auditar deuda técnica",
          allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
          permissionMode: "bypassPermissions",
          maxTurns: 30,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["audit"],
        },
      },
      {
        filename: "02-type-safety.md",
        title: "Mejorar seguridad de tipos",
        content: `# Improve Type Safety

Address all HIGH and MEDIUM severity \`any\` type issues identified in \`TECH_DEBT.md\`.
Replace \`any\` with proper TypeScript types, adding interfaces or type aliases as needed.
Run \`tsc --noEmit\` after each file change and ensure zero new type errors are introduced.
Verify the acceptance criteria: \`tsc --noEmit\` exits 0 and \`grep -r "any" src/ --include="*.ts"\` returns fewer results than before.`,
        frontmatter: {
          title: "Mejorar seguridad de tipos",
          allowedTools: ["Bash", "Read", "Edit", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 50,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["typescript"],
          dependsOn: ["01-audit.md"],
        },
      },
      {
        filename: "03-add-tests.md",
        title: "Agregar cobertura de tests",
        content: `# Add Test Coverage

Write unit tests for the top 5 highest-complexity functions identified in the audit, using Vitest and Testing Library as appropriate.
Each test file should live next to the file it tests (\`*.test.ts\`).
Tests must cover the happy path, at least one error path, and any edge cases documented in the source.
Verify the acceptance criteria: \`vitest run\` exits 0 and coverage for the targeted functions is above 80%.`,
        frontmatter: {
          title: "Agregar cobertura de tests",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
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
    name: "Construir librería de componentes",
    description:
      "Diseñá e implementá una librería de componentes reutilizables con TypeScript, Tailwind, shadcn/ui y documentación en Storybook.",
    tags: ["components", "design-system", "storybook"],
    iconName: "Layers",
    prompts: [
      {
        filename: "01-design-tokens.md",
        title: "Definir design tokens",
        content: `# Define Design Tokens

Create a design token system in \`lib/tokens.ts\` covering: color palette (primary, secondary, neutral, semantic), spacing scale, border radii, font sizes, and shadow levels.
Map the tokens to Tailwind CSS variables in \`tailwind.config.ts\` so they are available as utility classes.
Create a visual token reference page at \`app/(docs)/tokens/page.tsx\` that renders every token.
Verify the acceptance criteria: all tokens render correctly in the reference page and the Tailwind build includes no unused variable warnings.`,
        frontmatter: {
          title: "Definir design tokens",
          allowedTools: ["Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
          maxTurns: 25,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["design-tokens", "tailwind"],
        },
      },
      {
        filename: "02-core-components.md",
        title: "Construir componentes base",
        content: `# Build Core Components

Implement these primitive components using shadcn/ui as base: Button (5 variants), Input, Textarea, Select, Checkbox, Radio, Switch, Badge, and Avatar.
Each component must accept a \`className\` prop, forward refs, and export its props type.
Apply design tokens from the previous step for all visual values.
Verify the acceptance criteria: TypeScript compiles with zero errors and all components render in isolation without console warnings.`,
        frontmatter: {
          title: "Construir componentes base",
          allowedTools: ["Read", "Write", "Edit", "Glob"],
          permissionMode: "bypassPermissions",
          maxTurns: 80,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["components", "shadcn"],
          dependsOn: ["01-design-tokens.md"],
        },
      },
      {
        filename: "03-storybook-stories.md",
        title: "Escribir stories de Storybook",
        content: `# Write Storybook Stories

Create a \`.stories.tsx\` file for each component built in the previous step, following the Component Story Format 3 (CSF3) standard.
Each story file must include: a Default story, stories for every variant, and a story demonstrating an error/disabled state.
Add Storybook a11y and interactions addons and ensure each story passes axe accessibility checks.
Verify the acceptance criteria: \`storybook build\` exits 0 and opening the built output shows all components with no a11y violations.`,
        frontmatter: {
          title: "Escribir stories de Storybook",
          allowedTools: ["Read", "Write", "Edit", "Bash"],
          permissionMode: "bypassPermissions",
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
    name: "Generar suite de tests",
    description:
      "Generá automáticamente una suite de tests completa para un codebase existente: tests unitarios, de integración y flujos end-to-end.",
    tags: ["testing", "vitest", "playwright"],
    iconName: "TestTube2",
    prompts: [
      {
        filename: "01-unit-tests.md",
        title: "Generar tests unitarios",
        content: `# Generate Unit Tests

Scan all utility and helper functions in \`lib/\` and \`packages/\` that have no corresponding \`*.test.ts\` file.
Generate Vitest unit tests covering: expected output for valid inputs, thrown errors for invalid inputs, and boundary conditions.
Follow the AAA pattern (Arrange, Act, Assert) and keep each test file under 200 lines.
Verify the acceptance criteria: \`vitest run --reporter=verbose\` exits 0 and no test file has more than 5 skipped tests.`,
        frontmatter: {
          title: "Generar tests unitarios",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["unit-tests", "vitest"],
        },
      },
      {
        filename: "02-integration-tests.md",
        title: "Generar tests de integración",
        content: `# Generate Integration Tests

Write integration tests for all API route handlers in \`app/api/\` using \`next-test-api-route-handler\` or \`msw\` to mock the Supabase client.
Cover: 200 success responses with valid payloads, 400 validation errors, and 401 unauthenticated requests.
Each route handler must have at least one test that verifies the database call arguments.
Verify the acceptance criteria: \`vitest run\` passes all integration test files and coverage for API routes is above 70%.`,
        frontmatter: {
          title: "Generar tests de integración",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 60,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["integration-tests"],
          dependsOn: ["01-unit-tests.md"],
        },
      },
      {
        filename: "03-e2e-flows.md",
        title: "Escribir flujos E2E críticos",
        content: `# Write E2E Critical Flows

Create Playwright tests for the 3 most critical user journeys: registration + first login, the core CRUD happy path, and account settings update.
Tests should run against the local dev server (\`http://localhost:3000\`) and use Playwright's built-in \`page.getByRole\` selectors for accessibility.
Add a \`playwright.config.ts\` if one does not exist with webkit, chromium, and firefox projects.
Verify the acceptance criteria: \`playwright test\` passes in headless mode across all three browser projects.`,
        frontmatter: {
          title: "Escribir flujos E2E críticos",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "bypassPermissions",
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
    name: "Documentación de API",
    description:
      "Generá documentación OpenAPI 3.1 completa a partir de los route handlers existentes y publicá una Swagger UI interactiva.",
    tags: ["docs", "openapi", "swagger"],
    iconName: "Code2",
    prompts: [
      {
        filename: "01-generate-openapi.md",
        title: "Generar esquema OpenAPI",
        content: `# Generate OpenAPI Schema

Inspect all route handlers in \`app/api/\` and their Zod validators in \`lib/validators/\` to produce a complete OpenAPI 3.1 spec at \`public/openapi.json\`.
Document each endpoint with: summary, description, request body schema (from Zod), all response schemas (200, 400, 401, 404, 500), and security requirements.
Use the \`zod-to-json-schema\` pattern to convert Zod schemas to JSON Schema components.
Verify the acceptance criteria: \`openapi.json\` is valid OpenAPI 3.1 (lint with \`spectral lint\`) and covers all 100% of endpoints.`,
        frontmatter: {
          title: "Generar esquema OpenAPI",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["openapi", "documentation"],
        },
      },
      {
        filename: "02-swagger-ui.md",
        title: "Publicar documentación interactiva",
        content: `# Publish Interactive Docs

Set up a Swagger UI page at \`app/(docs)/api/page.tsx\` that reads \`/openapi.json\` and renders an interactive API explorer.
Use the \`swagger-ui-react\` package and wrap it in a Client Component with a custom theme matching the app's design tokens.
Add an "Authorize" button pre-configured with the Bearer token scheme so developers can test authenticated endpoints directly.
Verify the acceptance criteria: the docs page renders all endpoints, the authorize flow works, and a test request to a protected endpoint returns a real response.`,
        frontmatter: {
          title: "Publicar documentación interactiva",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
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
    name: "Migración de base de datos",
    description:
      "Planificá, ejecutá y verificá una migración de esquema en Supabase Postgres con cero downtime y capacidad total de rollback.",
    tags: ["database", "migration", "supabase"],
    iconName: "Plug",
    prompts: [
      {
        filename: "01-plan-migration.md",
        title: "Planificar la migración",
        content: `# Plan Migration

Analyse the current schema by reading all files in \`supabase/migrations/\` and the output of \`supabase db diff\`.
Identify the required changes (new tables, column additions/renames, index changes, RLS policy updates) and produce a migration plan in \`MIGRATION_PLAN.md\`.
Flag any changes that require a multi-step process (e.g., column renames must be done in two migrations to avoid downtime).
Verify the acceptance criteria: \`MIGRATION_PLAN.md\` exists, lists every DDL statement in order, and includes a rollback SQL block for each step.`,
        frontmatter: {
          title: "Planificar la migración",
          allowedTools: ["Bash", "Read", "Write", "Glob"],
          permissionMode: "bypassPermissions",
          maxTurns: 20,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["planning"],
        },
      },
      {
        filename: "02-write-migration.md",
        title: "Escribir archivos de migración",
        content: `# Write Migration Files

Using the plan from \`MIGRATION_PLAN.md\`, create the Supabase migration SQL files in \`supabase/migrations/\` with the conventional timestamp prefix.
Each migration file must include an explicit transaction block (\`BEGIN; ... COMMIT;\`) and a matching rollback script saved alongside it as \`<timestamp>_rollback.sql\`.
Regenerate TypeScript types after writing the migrations: \`supabase gen types typescript --local > packages/db/src/types.gen.ts\`.
Verify the acceptance criteria: \`supabase db push --dry-run\` reports no errors and the generated types compile with \`tsc --noEmit\`.`,
        frontmatter: {
          title: "Escribir archivos de migración",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "bypassPermissions",
          maxTurns: 30,
          requiresApproval: true,
          rollbackOnFail: true,
          tags: ["migration", "sql"],
          dependsOn: ["01-plan-migration.md"],
        },
      },
      {
        filename: "03-apply-and-verify.md",
        title: "Aplicar migración y verificar",
        content: `# Apply Migration & Verify

Apply the migration to the local Supabase instance with \`supabase db push\` and run the seed script to restore test data.
Execute the verification queries listed in \`MIGRATION_PLAN.md\` to confirm the schema matches expectations and RLS policies are enforced correctly.
Run the full test suite (\`vitest run\` + \`playwright test\`) to confirm no existing functionality was broken by the schema change.
Verify the acceptance criteria: all tests pass, \`supabase db diff\` reports a clean state, and the application starts without migration-related errors.`,
        frontmatter: {
          title: "Aplicar migración y verificar",
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

  // ─── 7. Localization (i18n) ──────────────────────────────────────────────────
  {
    id: "localization-i18n",
    name: "Configurar internacionalización (i18n)",
    description:
      "Extraé todos los strings visibles del codebase e implementá soporte multi-idioma con next-intl. Incluye inglés, español y portugués de base.",
    tags: ["i18n", "localization", "nextjs"],
    iconName: "Globe",
    prompts: [
      {
        filename: "01-extract-strings.md",
        title: "Extraer strings y crear archivos de mensajes",
        content: `# Extract Strings & Create Message Files

Scan the entire codebase for hardcoded user-facing strings in: React components, API error messages, validation errors, email templates, and toast notifications.
Extract all strings into a flat JSON structure organized by feature/page in \`messages/en.json\`.
Identify strings with dynamic values (names, counts, dates) and mark interpolation points with {variable} syntax following the ICU message format.
Create translations for Spanish (\`messages/es.json\`) and Portuguese (\`messages/pt.json\`) by translating all strings from the English source.
Verify the acceptance criteria: \`messages/en.json\`, \`messages/es.json\`, and \`messages/pt.json\` all exist with matching keys and no missing translations.`,
        frontmatter: {
          title: "Extraer strings y crear archivos de mensajes",
          allowedTools: ["Bash", "Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 45,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["extraction", "i18n"],
        },
      },
      {
        filename: "02-setup-next-intl.md",
        title: "Configurar framework next-intl",
        content: `# Set Up next-intl Framework

Install and configure \`next-intl\` library in the Next.js 15 project.
Create \`middleware.ts\` to detect user locale from Accept-Language header and URL prefix.
Update \`next.config.ts\` with the next-intl plugin configuration and routing setup for \`/[locale]/\` prefix.
Create \`app/[locale]/layout.tsx\` with NextIntlClientProvider and import the message files.
Verify the acceptance criteria: \`next build\` succeeds, the middleware correctly redirects \`/en/\` and \`/es/\` requests, and no console errors appear.`,
        frontmatter: {
          title: "Configurar framework next-intl",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
          maxTurns: 35,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["setup", "nextjs"],
          dependsOn: ["01-extract-strings.md"],
        },
      },
      {
        filename: "03-replace-hardcoded-strings.md",
        title: "Reemplazar strings hardcodeados con traducciones",
        content: `# Replace Hardcoded Strings with Translations

Replace all extracted hardcoded strings with calls to the \`useTranslations()\` hook in client components and \`getTranslations()\` in server components.
Use the \`t()\` function to retrieve strings from the message files with proper TypeScript autocomplete.
For pluralization, apply the ICU plural format in message files and use \`t(key, { count: n })\` in components.
Run \`next build\` and verify no strings fall back to undefined translation keys.
Verify the acceptance criteria: the app renders in English, Spanish, and Portuguese with all strings translated and no missing keys in the browser console.`,
        frontmatter: {
          title: "Reemplazar strings hardcodeados con traducciones",
          allowedTools: ["Read", "Edit", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: 70,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["refactoring", "translation"],
          dependsOn: ["02-setup-next-intl.md"],
        },
      },
      {
        filename: "04-language-switcher.md",
        title: "Construir selector de idioma",
        content: `# Build Language Switcher UI

Add a language switcher dropdown to the app's main navigation or settings page that allows users to toggle between English, Spanish, and Portuguese.
Store the selected locale in a cookie or user preference in the database (if authenticated).
Update the middleware to respect stored user preference over Accept-Language header when available.
Create a unit test verifying that switching language in the UI updates the \`next-intl\` active locale and re-renders content with correct translations.
Verify the acceptance criteria: the switcher appears in the UI, clicking a language option changes the page language immediately, and the preference persists across page reloads.`,
        frontmatter: {
          title: "Construir selector de idioma",
          allowedTools: ["Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["ui", "ux"],
          dependsOn: ["03-replace-hardcoded-strings.md"],
        },
      },
    ],
  },

  // ─── 8. Performance Audit ────────────────────────────────────────────────────
  {
    id: "performance-audit",
    name: "Auditoría de rendimiento y optimización",
    description:
      "Analizá el tamaño del bundle, los Core Web Vitals y el rendimiento de las queries. Implementá optimizaciones como code splitting, optimización de imágenes e indexación de base de datos.",
    tags: ["performance", "optimization", "nextjs"],
    iconName: "Zap",
    prompts: [
      {
        filename: "01-analyze-bundle.md",
        title: "Analizar tamaño del bundle y chunks",
        content: `# Analyze Bundle Size & Chunks

Run \`next build\` with detailed output and use \`@next/bundle-analyzer\` to generate a bundle analysis report.
Identify: the largest chunks (>100KB), duplicate dependencies, and Client Components that could be Server Components.
Create a \`BUNDLE_ANALYSIS.md\` report listing each chunk, its size, and optimization recommendations.
Flag any third-party libraries that could be replaced with lighter alternatives or removed entirely.
Verify the acceptance criteria: \`BUNDLE_ANALYSIS.md\` exists, identifies the top 5 optimization opportunities, and includes before/after size estimates.`,
        frontmatter: {
          title: "Analizar tamaño del bundle y chunks",
          allowedTools: ["Bash", "Read", "Write"],
          permissionMode: "bypassPermissions",
          maxTurns: 25,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["analysis"],
        },
      },
      {
        filename: "02-optimize-bundle.md",
        title: "Optimizar tamaño del bundle",
        content: `# Optimize Bundle Size

Implement the top 3 bundle size optimizations identified in the analysis:
1. Convert Client Components to Server Components where state/interactivity is not required.
2. Add dynamic imports with \`React.lazy()\` for route-specific or heavy UI components.
3. Replace or remove oversized third-party dependencies identified in the report.
Re-run \`next build\` after each change and measure the total JavaScript size reduction.
Verify the acceptance criteria: the bundle size decreases by at least 15%, \`next build\` succeeds, and the app functions correctly in production.`,
        frontmatter: {
          title: "Optimizar tamaño del bundle",
          allowedTools: ["Bash", "Read", "Edit", "Write"],
          permissionMode: "bypassPermissions",
          maxTurns: 50,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["optimization", "bundling"],
          dependsOn: ["01-analyze-bundle.md"],
        },
      },
      {
        filename: "03-optimize-images-fonts.md",
        title: "Optimizar imágenes y fuentes",
        content: `# Optimize Images & Fonts

Replace all \`<img>\` tags with Next.js \`<Image>\` component, specifying explicit \`width\` and \`height\` attributes to prevent layout shift (CLS).
Set \`priority\` prop for above-the-fold images and add \`blurDataURL\` placeholders for a better perceived load time.
Replace all font imports with \`next/font\` (Google Fonts or local fonts) to eliminate font load blocking and reduce CLS.
Verify the acceptance criteria: run \`lighthouse\` against the local dev server and confirm CLS < 0.1, LCP < 2.5s, and no font-related layout shift warnings.`,
        frontmatter: {
          title: "Optimizar imágenes y fuentes",
          allowedTools: ["Read", "Edit", "Bash"],
          permissionMode: "bypassPermissions",
          maxTurns: 45,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["images", "fonts", "cwv"],
          dependsOn: ["02-optimize-bundle.md"],
        },
      },
      {
        filename: "04-database-optimization.md",
        title: "Optimizar queries de base de datos",
        content: `# Optimize Database Queries

Enable query logging in Supabase and scan the logs for: N+1 queries, missing indexes on frequently filtered/joined columns, and unoptimized WHERE clauses.
Write a migration to add missing indexes on foreign key columns and high-cardinality filter columns (status, created_at, user_id).
Refactor API routes and Server Components to eliminate N+1 patterns by using SQL joins or batch fetches instead of loops with individual queries.
Run the full test suite to verify query changes do not affect application behavior.
Verify the acceptance criteria: average API response time decreases by at least 20%, new indexes are created, and no N+1 patterns remain in the code.`,
        frontmatter: {
          title: "Optimizar queries de base de datos",
          allowedTools: ["Bash", "Read", "Write", "Edit"],
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: true,
          tags: ["database", "queries"],
          dependsOn: ["03-optimize-images-fonts.md"],
        },
      },
      {
        filename: "05-monitoring-setup.md",
        title: "Configurar monitoreo de rendimiento",
        content: `# Set Up Performance Monitoring

Install \`next-safe-action\` or the \`web-vitals\` package to collect Core Web Vitals metrics (LCP, FID, CLS, TTFB) from real users in production.
Send metrics to your analytics provider (Google Analytics 4) or a custom endpoint for tracking.
Create a performance dashboard at \`app/(docs)/performance/page.tsx\` that displays baseline metrics and historical trends.
Add a performance budget in \`next.config.ts\` that fails the build if the main bundle exceeds a configurable size threshold (e.g., 300KB gzipped).
Verify the acceptance criteria: metrics are being recorded and sent to analytics, the performance dashboard renders historical data, and the build fails when the performance budget is exceeded.`,
        frontmatter: {
          title: "Configurar monitoreo de rendimiento",
          allowedTools: ["Read", "Write", "Edit", "Bash"],
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          requiresApproval: false,
          rollbackOnFail: false,
          tags: ["monitoring", "analytics"],
          dependsOn: ["04-database-optimization.md"],
        },
      },
    ],
  },
];

export function getTemplateById(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByTag(tag: string): BuiltinTemplate[] {
  return BUILTIN_TEMPLATES.filter((t) => t.tags.includes(tag));
}

export function searchTemplates(query: string): BuiltinTemplate[] {
  const lowerQuery = query.toLowerCase();
  return BUILTIN_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
  );
}
