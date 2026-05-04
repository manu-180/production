import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SupabaseLikeClient,
  loadPlanFromDb,
  loadPlanFromDir,
  loadPlanFromUploaded,
} from "../plan-loader.js";

describe("loadPlanFromDir", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "plan-loader-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads .md files sorted lexicographically", async () => {
    await writeFile(join(dir, "02-second.md"), "Second prompt body");
    await writeFile(join(dir, "01-first.md"), "First prompt body");
    await writeFile(join(dir, "10-tenth.md"), "Tenth prompt body");

    const plan = await loadPlanFromDir(dir);
    expect(plan.prompts).toHaveLength(3);
    expect(plan.prompts[0]?.filename).toBe("01-first.md");
    expect(plan.prompts[1]?.filename).toBe("02-second.md");
    expect(plan.prompts[2]?.filename).toBe("10-tenth.md");
    expect(plan.prompts[0]?.order).toBe(0);
    expect(plan.prompts[1]?.order).toBe(1);
    expect(plan.prompts[2]?.order).toBe(2);
  });

  it("skips README.md (case-insensitive)", async () => {
    await writeFile(join(dir, "01-real.md"), "Real");
    await writeFile(join(dir, "README.md"), "# Readme");
    await writeFile(join(dir, "readme.md"), "# readme");
    await writeFile(join(dir, "Readme.md"), "# Readme mixed");

    const plan = await loadPlanFromDir(dir);
    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]?.filename).toBe("01-real.md");
  });

  it("skips numeric-prefixed README files (00-README.md, 01_readme.md)", async () => {
    // Real bug: a 40-prompt plan started with `00-README.md` as a pure
    // index/table-of-contents. Conductor sent it to Claude, which spent 10+ min
    // trying to "execute" it. Plan loader must drop these descriptive files.
    await writeFile(join(dir, "00-README.md"), "# Master index");
    await writeFile(join(dir, "01_README.md"), "# alt prefix");
    await writeFile(join(dir, "02-readme.md"), "# lowercase variant");
    await writeFile(join(dir, "03-real-prompt.md"), "Implement X");
    // Sanity: don't false-positive on filenames that merely *contain* readme.
    await writeFile(join(dir, "04-auth-readme-helper.md"), "Real prompt");

    const plan = await loadPlanFromDir(dir);
    const filenames = plan.prompts.map((p) => p.filename);
    expect(filenames).toEqual(["03-real-prompt.md", "04-auth-readme-helper.md"]);
  });

  it("skips _draft.md files", async () => {
    await writeFile(join(dir, "01-keep.md"), "Keep");
    await writeFile(join(dir, "_draft.md"), "Draft");
    await writeFile(join(dir, "_skip-me.md"), "Skip");

    const plan = await loadPlanFromDir(dir);
    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]?.filename).toBe("01-keep.md");
  });

  it("skips non-.md files", async () => {
    await writeFile(join(dir, "01-real.md"), "Real");
    await writeFile(join(dir, "notes.txt"), "Notes");
    await writeFile(join(dir, "config.yaml"), "key: val");

    const plan = await loadPlanFromDir(dir);
    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]?.filename).toBe("01-real.md");
  });

  it("returns Plan with empty prompts array for empty dir", async () => {
    const plan = await loadPlanFromDir(dir);
    expect(plan.prompts).toEqual([]);
    expect(plan.id).toBeTruthy();
    expect(plan.createdAt).toBeTruthy();
  });

  it("returns Plan with name = path.basename(dir)", async () => {
    const namedDir = join(dir, "my-cool-plan");
    await mkdir(namedDir);
    await writeFile(join(namedDir, "01-x.md"), "x");
    const plan = await loadPlanFromDir(namedDir);
    expect(plan.name).toBe("my-cool-plan");
  });
});

describe("loadPlanFromUploaded", () => {
  it("sorts files by name", async () => {
    const plan = await loadPlanFromUploaded([
      { name: "03-c.md", content: "c" },
      { name: "01-a.md", content: "a" },
      { name: "02-b.md", content: "b" },
    ]);
    expect(plan.prompts.map((p) => p.filename)).toEqual(["01-a.md", "02-b.md", "03-c.md"]);
  });

  it("skips README and _-prefixed files", async () => {
    const plan = await loadPlanFromUploaded([
      { name: "README.md", content: "readme" },
      { name: "_draft.md", content: "draft" },
      { name: "01-real.md", content: "real" },
      { name: "notes.txt", content: "notes" },
    ]);
    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]?.filename).toBe("01-real.md");
  });

  it("returns Plan with name 'uploaded-plan'", async () => {
    const plan = await loadPlanFromUploaded([{ name: "01-x.md", content: "x" }]);
    expect(plan.name).toBe("uploaded-plan");
  });

  it("does not mutate the caller's input array", async () => {
    const input = [
      { name: "02-b.md", content: "b" },
      { name: "01-a.md", content: "a" },
    ];
    const original = [...input];
    await loadPlanFromUploaded(input);
    expect(input).toEqual(original);
  });
});

describe("loadPlanFromDb", () => {
  function makeMockDb(opts: {
    planRows: unknown[] | null;
    planError?: unknown;
    promptRows?: unknown[] | null;
    promptError?: unknown;
  }): SupabaseLikeClient {
    return {
      from(table: string) {
        return {
          select(_cols: string) {
            const planResult = {
              data: opts.planRows,
              error: opts.planError ?? null,
            };
            const promptResult = {
              data: opts.promptRows ?? [],
              error: opts.promptError ?? null,
            };

            // Use real Promises extended with chainable methods (avoids noThenProperty lint rule)
            const makeEqResult = (result: typeof planResult | typeof promptResult) => {
              const p = Promise.resolve(result);
              return Object.assign(p, {
                order(_c: string, _o?: { ascending?: boolean }) {
                  return Promise.resolve(promptResult);
                },
              });
            };

            const eqChain = Object.assign(
              Promise.resolve(table === "plans" ? planResult : promptResult),
              {
                eq(_col: string, _val: string) {
                  const result = table === "plans" ? planResult : promptResult;
                  return makeEqResult(result);
                },
              },
            );

            return eqChain;
          },
        };
      },
    } as SupabaseLikeClient;
  }

  it("returns Plan from DB rows", async () => {
    const db = makeMockDb({
      planRows: [
        {
          id: "plan-1",
          name: "DB Plan",
          description: "From DB",
          default_working_dir: "/work",
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      promptRows: [
        {
          id: "prompt-1",
          plan_id: "plan-1",
          order_index: 0,
          filename: "01-a.md",
          content: "Body A",
          frontmatter: { title: "A", retries: 1 },
        },
        {
          id: "prompt-2",
          plan_id: "plan-1",
          order_index: 1,
          filename: "02-b.md",
          content: "Body B",
          frontmatter: null,
        },
      ],
    });

    const plan = await loadPlanFromDb("plan-1", db);
    expect(plan.id).toBe("plan-1");
    expect(plan.name).toBe("DB Plan");
    expect(plan.description).toBe("From DB");
    expect(plan.defaultWorkingDir).toBe("/work");
    expect(plan.prompts).toHaveLength(2);
    expect(plan.prompts[0]?.filename).toBe("01-a.md");
    expect(plan.prompts[0]?.frontmatter.title).toBe("A");
    expect(plan.prompts[0]?.frontmatter.retries).toBe(1);
    expect(plan.prompts[1]?.filename).toBe("02-b.md");
  });

  it("throws if plan not found (data is empty)", async () => {
    const db = makeMockDb({ planRows: [] });
    await expect(loadPlanFromDb("missing", db)).rejects.toThrow(/not found/);
  });

  it("throws if plan not found (data is null)", async () => {
    const db = makeMockDb({ planRows: null });
    await expect(loadPlanFromDb("missing", db)).rejects.toThrow(/not found/);
  });

  it("throws if DB returns an error for the plan query", async () => {
    const db = makeMockDb({
      planRows: null,
      planError: { message: "boom" },
    });
    await expect(loadPlanFromDb("x", db)).rejects.toThrow(/boom/);
  });
});
