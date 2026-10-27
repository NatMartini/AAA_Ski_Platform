import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { listResortBookingDays } from "@/lib/booking/recommendation";
import { BookingSteps } from "@/components/booking/booking-steps";
import { toLocale } from "@/i18n/routing";
import { MapPin, ArrowRight } from "lucide-react";

export default async function ChooseResortPage({
  params,
}: PageProps<"/[locale]/book">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/book` });
  if (user.role === "COACH" || user.role === "ADMIN") {
    redirect({ href: "/coach/bookings/new", locale });
  }

  const t = await getTranslations("booking");
  const zh = locale === "zh";

  const resorts = await prisma.resort.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
  });

  const withDays = await Promise.all(
    resorts.map(async (resort) => ({
      resort,
      days: await listResortBookingDays(resort.slug),
    })),
  );

  const available = withDays.filter((r) => r.days.length > 0);

  return (
    <div className="space-y-5">
      <BookingSteps locale={toLocale(locale)} current={1} />
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("stepResort")}
      </h1>
      <p className="text-sm text-ink-2">{zh ? "先选雪场，再选时间和教练。" : "Choose a resort, then choose your time and coach."}</p>

      {available.length === 0 ? (
        <Card>
          <CardDescription>{t("noSlots")}</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {available.map(({ resort, days }) => (
            <Link key={resort.id} href={`/book/${resort.slug}`} className="block">
              <Card className="flex h-full flex-col gap-2 transition-colors hover:border-ice-400">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{zh ? resort.nameZh : resort.nameEn}</CardTitle>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                {resort.address && (
                  <CardDescription className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {resort.address}
                  </CardDescription>
                )}
                <p className="mt-auto pt-2 text-xs text-muted-foreground">
                  {zh ? `${days.length} 天有可约时间` : `${days.length} days with available times`}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
