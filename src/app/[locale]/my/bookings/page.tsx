import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { BookingRow } from "@/components/booking/booking-row";
import { toLocale } from "@/i18n/routing";
import { TERMINAL_STATUSES } from "@/lib/booking/state";

export default async function MyBookingsPage({
  params,
}: PageProps<"/[locale]/my/bookings">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/my/bookings`,
  });
  const t = await getTranslations("nav");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const bookings = await prisma.booking.findMany({
    where: { accountId: user.id },
    include: {
      resort: true,
      coach: { select: { name: true, email: true } },
    },
    orderBy: { startAt: "desc" },
  });

  const upcoming = bookings.filter(
    (b) => !TERMINAL_STATUSES.includes(b.status) && b.endAt >= new Date(),
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="stagger space-y-6">
      <h1 className="text-3xl">
        {t("myBookings")}
      </h1>

      {bookings.length === 0 && (
        <Card>
          <CardDescription>
            {zh ? "还没有任何预定。" : "No bookings yet."}
          </CardDescription>
        </Card>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
            {zh ? "进行中" : "Active"}
          </h2>
          <div className="space-y-2">
            {upcoming.map((b) => (
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
                  otherPartyName: b.coach.name ?? b.coach.email,
                  hasWaiver: Boolean(b.waiverId),
                }}
              />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
            {zh ? "历史" : "Past"}
          </h2>
          <div className="space-y-2">
            {past.map((b) => (
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
                  otherPartyName: b.coach.name ?? b.coach.email,
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
