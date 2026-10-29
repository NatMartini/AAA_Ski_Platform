import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { CalendarPlus, ClipboardList } from "lucide-react";
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
  if (user.role === "COACH" || user.role === "ADMIN") {
    redirect({ href: "/coach/bookings", locale });
  }
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
    <div className="space-y-6">
      <PageHeader
        icon={<ClipboardList aria-hidden />}
        tone="lessons"
        title={t("myBookings")}
        description={zh ? "订单状态、签署协议与付款进度。点开一节课查看详情、课程视频和分析。" : "Booking status, waivers and payment progress. Open a lesson for details, its videos and analysis."}
        actions={<Button asChild><Link href="/book"><CalendarPlus aria-hidden />{zh ? "预约新课程" : "Book a lesson"}</Link></Button>}
      />

      {bookings.length === 0 && (
        <EmptyState
          icon={<ClipboardList aria-hidden />}
          title={zh ? "还没有任何预定。" : "No bookings yet."}
          action={<Button asChild variant="secondary"><Link href="/book">{zh ? "预约课程" : "Book a lesson"}</Link></Button>}
        />
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <SectionHeading title={`${zh ? "进行中" : "Active"} · ${upcoming.length}`} />
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
                  lessonType: b.lessonType,
                  paidByPackage: b.paymentPlan === "PACKAGE",
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
        <section className="space-y-3">
          <SectionHeading title={`${zh ? "历史" : "Past"} · ${past.length}`} />
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
                  lessonType: b.lessonType,
                  paidByPackage: b.paymentPlan === "PACKAGE",
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
