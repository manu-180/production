import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body: unknown = await req.json();
  const rawPath =
    typeof body === "object" && body !== null && "path" in body
      ? (body as { path: unknown })["path"]
      : undefined;

  const pathStr = typeof rawPath === "string" ? rawPath.trim() : null;

  if (!pathStr) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const info = await stat(pathStr);
    const isDir = info.isDirectory();

    let isWritable = false;
    try {
      await access(pathStr, constants.W_OK);
      isWritable = true;
    } catch {
      /* not writable */
    }

    let isGitRepo = false;
    try {
      await stat(join(pathStr, ".git"));
      isGitRepo = true;
    } catch {
      /* not a git repo */
    }

    return NextResponse.json({ exists: true, isDir, isWritable, isGitRepo });
  } catch {
    return NextResponse.json({
      exists: false,
      isDir: false,
      isWritable: false,
      isGitRepo: false,
    });
  }
}
