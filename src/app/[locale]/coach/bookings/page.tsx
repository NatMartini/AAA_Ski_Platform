import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { BookingRow } from "@/components/booking/booking-row";
import { toLocale } from "@/i18n/routing";
import { TERMINAL_STATUSES } from "@/lib/booking/state";

export default async function CoachBookingsPage({
  params,
}: PageProps<"/[locale]/coach/bookings">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });
  const t = await getTranslations("coach");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const bookings = await prisma.booking.findMany({
    where: { coachId: user.id },
    include: { resort: true, participant: true },
    orderBy: { startAt: "desc" },
    take: 200,
  });

  const live = bookings.filter((b) => !TERMINAL_STATUSES.includes(b.status));
  const done = bookings.filter((b) => TERMINAL_STATUSES.includes(b.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("bookings")}
        </h2>
        {/* A file download from a route handler, not an internal page — next/link
            would prefetch it and fight the Content-Disposition. */}
        <a
          href="/api/coach/export"
          download
          className="text-sm text-ice-700 underline dark:text-ice-300"
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

      {live.length > 0 && (
        <div className="space-y-2">
          {live.map((b) => (
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
                resortName: zh ? b.resort.nameZh : b.resort.nameEn,
                otherPartyName:
                  b.participantNameSnapshot ??
                  b.participant?.fullName ??
                  b.inviteName ??
                  "—",
                hasWaiver: Boolean(b.waiverId),
              }}
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {zh ? "已结束" : "Closed"}
          </h3>
          <div className="space-y-2">
            {done.map((b) => (
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
                  resortName: zh ? b.resort.nameZh : b.resort.nameEn,
                  otherPartyName:
                    b.participantNameSnapshot ??
                    b.participant?.fullName ??
                    b.inviteName ??
                    "—",
                  hasWaiver: Boolean(b.waiverId),
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
