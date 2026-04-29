import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function GET(): Promise<NextResponse> {
  try {
    const [versionResult, whereResult] = await Promise.allSettled([
      execFileAsync("claude", ["--version"], { timeout: 5_000 }),
      execFileAsync("where", ["claude"], { timeout: 3_000 }), // Windows
    ]);

    const version =
      versionResult.status === "fulfilled" ? versionResult.value.stdout.trim() : undefined;

    const rawLocation =
      whereResult.status === "fulfilled" ? whereResult.value.stdout.split("\n")[0] : undefined;

    const location = typeof rawLocation === "string" ? rawLocation.trim() : undefined;

    return NextResponse.json({
      installed: versionResult.status === "fulfilled",
      version,
      location,
    });
  } catch {
    return NextResponse.json({ installed: false });
  }
}
