import { NextResponse, type NextRequest } from "next/server";

import { AuthError } from "@/lib/auth/errors";
import { jsonError } from "@/lib/auth/handler-helpers";
import { resolveAuth } from "@/lib/game/__server-auth-context";
import { readAccountRunsPage } from "@/lib/account/runs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
    if (auth.ctx.userId === null) {
      throw new AuthError("SESSION_INVALID", "account runs require sign-in");
    }
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "25");
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
    const page = await readAccountRunsPage(auth.deps.db, auth.ctx.userId, { limit, offset });
    return NextResponse.json(page);
  } catch (err) {
    return jsonError(err);
  }
}
