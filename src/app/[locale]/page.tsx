import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/auth/require-user";
import { ArrowRight, CalendarDays, Snowflake } from "lucide-react";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const nav = await getTranslations("nav");
  const user = await getUser();

  // Signed out: brand and a sign-in button only. No coaches, resorts or prices.
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <Snowflake className="mx-auto size-10 text-ice-500" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t("signedOutTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("signedOutBody")}
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/sign-in">{nav("signIn")}</Link>
        </Button>
      </div>
    );
  }

  const isCoach = user.role === "COACH" || user.role === "ADMIN";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("signedInTitle", { name: user.name ?? user.email })}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>{nav("book")}</CardTitle>
          <CardDescription>
            {locale === "zh"
              ? "选择雪场、教练和时间,两小时起。"
              : "Pick a resort, coach and time. Two hours minimum."}
          </CardDescription>
          <Button asChild className="mt-auto self-start">
            <Link href="/book">
              {t("startBooking")}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>{nav("myBookings")}</CardTitle>
          <CardDescription>
            {locale === "zh"
              ? "查看订单状态、签署协议与付款进度。"
              : "Check status, waivers and payment progress."}
          </CardDescription>
          <Button asChild variant="secondary" className="mt-auto self-start">
            <Link href="/my/bookings">
              <CalendarDays aria-hidden />
              {t("viewBookings")}
            </Link>
          </Button>
        </Card>
      </div>

      {isCoach && (
        <Card className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{nav("coach")}</CardTitle>
            <CardDescription>
              {locale === "zh"
                ? "管理可用日、价格、订单与收款确认。"
                : "Availability, pricing, bookings and payment review."}
            </CardDescription>
          </div>
          <Button asChild variant="secondary">
            <Link href="/coach">{t("coachArea")}</Link>
          </Button>
        </Card>
      )}
    </div>
  );
}
