import { NextResponse } from "next/server";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { requireUser } from "@/lib/auth/require-user";
import { reissueAttendeeInvite } from "@/lib/booking/attendees";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/attendees/[attendeeId]/invite">,
) {
  const limited = rateLimitOrRespond(req, "write", "attendee-invite");
  if (limited) return limited;
  const r = await requireUser();
  if (!r.ok) return r.response;
  const jsonBody = await readJsonBodyOrResponse(req, { allowEmpty: true });
  if (!jsonBody.ok) return jsonBody.response;
  const { code, attendeeId } = await ctx.params;
  const result = await reissueAttendeeInvite(
    code, attendeeId, r.user, toLocale(req.headers.get("x-locale") ?? undefined),
  );
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, {
      status: result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409,
      headers,
    });
  }
  return NextResponse.json(result, { headers });
}
