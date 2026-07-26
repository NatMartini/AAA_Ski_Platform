import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, lessonSummarySchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { sendLessonSummary } from "@/lib/booking/notify";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The coach writes (or rewrites) the post-lesson notes.
 *
 * Editable rather than write-once: these are teaching notes, not a legal
 * record, and a coach typing on a phone in a lodge will want to fix them
 * later. The student is emailed only the first time — subsequent edits update
 * the page silently instead of pinging them again.
 */
export async function PUT(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/summary">,
) {
  const limited = rateLimitOrRespond(req, "write", "summary");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = lessonSummarySchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const summary = parsed.data.summary.trim();
  const isFirst = !booking.coachSummary;

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      coachSummary: summary || null,
      coachSummaryAt: summary ? new Date() : null,
    },
  });

  const to = booking.account?.email ?? booking.inviteEmail;
  if (summary && isFirst && to) {
    await sendLessonSummary({
      code: booking.code,
      to,
      coachName: booking.coach.name ?? booking.coach.email,
      locale: toLocale(req.headers.get("x-locale") ?? undefined),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
