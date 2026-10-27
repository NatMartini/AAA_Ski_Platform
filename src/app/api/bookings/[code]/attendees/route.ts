import { NextResponse } from "next/server";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { requireUser } from "@/lib/auth/require-user";
import { loadAttendeeRoster, reissueAttendeeInvite } from "@/lib/booking/attendees";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/bookings/[code]/attendees">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { code } = await ctx.params;
  const result = await loadAttendeeRoster(code, r.user);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, {
      status: result.reason === "not-found" ? 404 : 403, headers: privateHeaders,
    });
  }
  return NextResponse.json(result, { headers: privateHeaders });
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/attendees">,
) {
  const limited = rateLimitOrRespond(req, "write", "attendee-invite");
  if (limited) return limited;
  const r = await requireUser();
  if (!r.ok) return r.response;
  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.data;
  if (!body || typeof body !== "object" || !("attendeeId" in body) ||
      typeof body.attendeeId !== "string" || !body.attendeeId || body.attendeeId.length > 128) {
    return NextResponse.json({ error: "validation" }, { status: 400, headers: privateHeaders });
  }
  const { code } = await ctx.params;
  const result = await reissueAttendeeInvite(
    code, body.attendeeId, r.user, toLocale(req.headers.get("x-locale") ?? undefined),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, {
      status: result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409,
      headers: privateHeaders,
    });
  }
  return NextResponse.json(result, { headers: privateHeaders });
}
