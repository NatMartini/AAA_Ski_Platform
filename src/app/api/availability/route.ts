import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getAvailability } from "@/lib/availability";
import { isDateKey } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Availability requires sign-in.
 *
 * Not because the times are secret, but because this site is private: an
 * anonymous caller should not be able to learn which coach teaches at which
 * resort on which day for how much.
 */
export async function GET(req: Request) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const url = new URL(req.url);
  const coachId = url.searchParams.get("coachId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!coachId || !from || !to || !isDateKey(from) || !isDateKey(to)) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const days = await getAvailability({ coachId, from, to });

  return NextResponse.json({
    days: days.map((day) => ({
      dateKey: day.dateKey,
      resort: day.resort,
      earlyBird: day.earlyBird,
      handoverDiscountCents: day.handoverDiscountCents,
      cells: day.cells.map((cell) => ({
        hour: cell.hour,
        status: cell.status,
        startAt: cell.startAt.toISOString(),
      })),
      startOptions: day.startOptions.map((option) => ({
        hour: option.hour,
        durations: option.durations,
      })),
    })),
  });
}
