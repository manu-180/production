import * as authModule from "@/lib/api/auth";
import { mutationLimiter } from "@/lib/api/rate-limit";
import { zipSync } from "fflate";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

function makeForm(files: { name: string; bytes: Uint8Array; type?: string }[]): FormData {
  const form = new FormData();
  for (const f of files) {
    // Cast: TS 5.7's Uint8Array<ArrayBufferLike> isn't structurally a BlobPart,
    // even though it works at runtime. Wrap in a Blob first to dodge the type.
    const blob = new Blob([f.bytes as BlobPart], { type: f.type ?? "application/octet-stream" });
    form.append("files", new File([blob], f.name, { type: blob.type }));
  }
  return form;
}

function reqWithForm(form: FormData): NextRequest {
  // NextRequest accepts a Request body; pass a Request to keep multipart boundary.
  const req = new Request("http://x/api/upload/prompts", {
    method: "POST",
    body: form,
  });
  return new NextRequest(req);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

const TEST_USER = { userId: "u1", db: {} as never };

describe("POST /api/upload/prompts", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: TEST_USER });
    mutationLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects non-multipart with 415", async () => {
    const req = new NextRequest("http://x/api/upload/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("rejects empty upload with 400", async () => {
    const res = await POST(reqWithForm(new FormData()));
    expect(res.status).toBe(400);
  });

  it("parses a single .md file with frontmatter", async () => {
    const md = "---\ntitle: Hello\n---\n\nbody content";
    const form = makeForm([{ name: "01-hello.md", bytes: utf8(md), type: "text/markdown" }]);
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].filename).toBe("01-hello.md");
    expect(body.prompts[0].title).toBe("Hello");
    expect(body.prompts[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.skipped).toEqual([]);
  });

  it("skips README, _drafts, and non-md files with reason", async () => {
    const form = makeForm([
      { name: "README.md", bytes: utf8("readme") },
      { name: "_draft.md", bytes: utf8("draft") },
      { name: "notes.txt", bytes: utf8("text") },
      { name: "00-keep.md", bytes: utf8("keep") },
    ]);
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].filename).toBe("00-keep.md");
    expect(body.skipped).toHaveLength(3);
  });

  it("extracts .md files from a zip", async () => {
    const zipBytes = zipSync({
      "plans/01-a.md": utf8("# A"),
      "plans/02-b.md": utf8("# B"),
      "plans/README.md": utf8("docs"),
      "plans/notes.txt": utf8("ignore"),
    });
    const form = makeForm([{ name: "bundle.zip", bytes: zipBytes, type: "application/zip" }]);
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(2);
    expect(body.prompts.map((p: { filename: string }) => p.filename).sort()).toEqual([
      "01-a.md",
      "02-b.md",
    ]);
  });

  it("returns 400 with reasons when nothing valid is found", async () => {
    const form = makeForm([
      { name: "notes.txt", bytes: utf8("nope") },
      { name: "README.md", bytes: utf8("readme") },
    ]);
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.skipped.length).toBeGreaterThan(0);
  });

  it("rejects an invalid zip with skipped reason and no prompts", async () => {
    const form = makeForm([
      { name: "bad.zip", bytes: utf8("not a real zip"), type: "application/zip" },
    ]);
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(400);
  });
});
