import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { cancelActionUpdate } from "@/lib/season-update/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Stops an update that is waiting or under way. */
export async function POST(req: Request, context: { params: Promise<{ runId: string }> }) {
  const limited = rateLimitOrRespond(req, "write", "season-update");
  if (limited) return limited;
  const auth = await requireCoach();
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return NextResponse.json({ error: "not-found" }, { status: 404, headers: PRIVATE });
  return (await cancelActionUpdate(runId)) ? NextResponse.json({ ok: true }, { headers: PRIVATE })
    : NextResponse.json({ error: "not-running" }, { status: 409, headers: PRIVATE });
}
