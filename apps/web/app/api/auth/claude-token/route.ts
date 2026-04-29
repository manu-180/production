import { createProductionTokenManager, validateToken } from "@conductor/core";
import { type NextRequest, NextResponse } from "next/server";

// TODO: replace with auth.getUser() when multi-user auth is implemented
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();

    const rawToken =
      typeof body === "object" && body !== null && "token" in body
        ? (body as { token: unknown })["token"]
        : undefined;

    if (typeof rawToken !== "string" || rawToken.trim() === "") {
      return NextResponse.json(
        { ok: false, error: "token is required and must be a non-empty string" },
        { status: 400 },
      );
    }

    const token = rawToken.trim();

    const result = await validateToken(token);
    if (!result.valid) {
      return NextResponse.json({ ok: false, error: "Token validation failed" }, { status: 400 });
    }

    const mgr = await createProductionTokenManager();
    await mgr.saveToken(DEV_USER_ID, token);

    return NextResponse.json({ ok: true, validatedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const mgr = await createProductionTokenManager();
    const token = await mgr.getToken(DEV_USER_ID);

    return NextResponse.json({ configured: token !== null });
  } catch {
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const mgr = await createProductionTokenManager();
    await mgr.revokeToken(DEV_USER_ID);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
