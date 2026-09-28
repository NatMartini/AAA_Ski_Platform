import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { BookingRow } from "@/components/booking/booking-row";
import { toLocale } from "@/i18n/routing";
import { TERMINAL_STATUSES } from "@/lib/booking/state";
import { cn } from "@/lib/utils";

export default async function CoachBookingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/coach/bookings">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });
  const t = await getTranslations("coach");
  const loc = toLocale(locale);
  const zh = loc === "zh";
  // The coaches share their books, so either can list every coach's bookings.
  const all = (await searchParams).scope === "all";

  const bookings = await prisma.booking.findMany({
    where: all ? {} : { coachId: user.id },
    include: {
      resort: true,
      participant: true,
      coach: { select: { name: true, email: true } },
    },
    orderBy: { startAt: "desc" },
    take: 200,
  });

  const live = bookings.filter((b) => !TERMINAL_STATUSES.includes(b.status));
  const done = bookings.filter((b) => TERMINAL_STATUSES.includes(b.status));

  const row = (b: (typeof bookings)[number]) => {
    const student =
      b.participantNameSnapshot ?? b.participant?.fullName ?? b.inviteName ?? "—";
    return (
      <BookingRow
        key={b.id}
        locale={loc}
        href={`/booking/${b.code}`}
        booking={{
          code: b.code,
          status: b.status,
          startAt: b.startAt,
          lessonStartAt: b.lessonStartAt,
          lessonEndAt: b.lessonEndAt,
          totalCents: b.totalCents,
          lessonType: b.lessonType,
          paidByPackage: b.paymentPlan === "PACKAGE",
          resortName: zh ? b.resort.nameZh : b.resort.nameEn,
          otherPartyName: all
            ? `${student} · ${zh ? "教练" : "coach"} ${b.coach.name ?? b.coach.email}`
            : student,
          hasWaiver: Boolean(b.waiverId),
        }}
      />
    );
  };

  return (
    <div className="stagger space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label={t("bookings")}>
          {(
            [
              [false, zh ? "我的订单" : "Mine"],
              [true, zh ? "全部教练" : "All coaches"],
            ] as const
          ).map(([isAll, label]) => (
            <Link
              key={label}
              href={isAll ? "/coach/bookings?scope=all" : "/coach/bookings"}
              aria-current={all === isAll ? "page" : undefined}
              className={cn(
                "press rounded-xl border px-3.5 py-2 text-sm font-semibold",
                all === isAll
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface text-ink-2 hover:border-accent",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        {/* A file download from a route handler, not an internal page — next/link
            would prefetch it and fight the Content-Disposition. */}
        <a
          href="/api/coach/export"
          download
          className="press text-sm font-bold text-accent underline underline-offset-2"
        >
          {zh ? "导出 CSV" : "Export CSV"}
        </a>
      </div>

      {bookings.length === 0 && (
        <Card>
          <CardDescription>
            {zh ? "还没有订单。" : "No bookings yet."}
          </CardDescription>
        </Card>
      )}

      {live.length > 0 && <div className="space-y-2">{live.map(row)}</div>}

      {done.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
            {zh ? "已结束" : "Closed"}
          </h3>
          <div className="space-y-2">{done.map(row)}</div>
        </section>
      )}
    </div>
  );
}
