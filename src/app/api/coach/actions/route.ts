import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { seasonListSchema } from "@/lib/season-update/season-list";
import { getActionUpdateState, startActionUpdate } from "@/lib/season-update/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const schema = z.object({ expectedCoachId: z.string().min(1).max(128), list: seasonListSchema });

/** The season's action list, what the site can generate, and the latest update with its progress; `materials=1` also asks FreeSki what it holds. */
export async function GET(req: Request) {
  const auth = await requireCoach();
  if (!auth.ok) return auth.response;
  const state = await getActionUpdateState(auth.user.id, { materials: new URL(req.url).searchParams.get("materials") === "1" });
  return NextResponse.json(state, { headers: PRIVATE });
}

/** "Update the actions": takes the list as edited and asks the worker for the whole run. Nothing on the site changes until the run publishes. */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "season-update");
  if (limited) return limited;
  const auth = await requireCoach();
  if (!auth.ok) return auth.response;
  const body = await readJsonBodyOrResponse(req);
  if (!body.ok) return body.response;
  const input = schema.safeParse(body.data);
  if (!input.success) return NextResponse.json({ error: "validation" }, { status: 400, headers: PRIVATE });
  if (input.data.expectedCoachId !== auth.user.id) return NextResponse.json({ error: "session-changed" }, { status: 409, headers: PRIVATE });
  const result = await startActionUpdate(auth.user.id, input.data.list);
  return NextResponse.json(result, { status: result.ok ? 201 : result.error === "validation" ? 400 : 409, headers: PRIVATE });
}
