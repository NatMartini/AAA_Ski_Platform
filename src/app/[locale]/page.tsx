import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/auth/require-user";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Package,
  Snowflake,
} from "lucide-react";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const nav = await getTranslations("nav");
  const user = await getUser();

  // Signed out: brand and a sign-in button only. No coaches, resorts or prices.
  if (!user) {
    return (
      <div className="animate-fade-up mx-auto max-w-md py-10 text-center sm:py-16">
        <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-[var(--accent-soft)]">
          <Snowflake className="size-8 text-accent" aria-hidden />
        </span>
        <h1 className="mt-6 text-3xl">{t("signedOutTitle")}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-2">
          {t("signedOutBody")}
        </p>
        <Button asChild size="lg" className="mt-7 w-full">
          <Link href="/sign-in">{nav("signIn")}</Link>
        </Button>
      </div>
    );
  }

  const isCoach = user.role === "COACH" || user.role === "ADMIN";

  return (
    <div className="stagger space-y-6">
      <h1 className="text-3xl">
        {t("signedInTitle", { name: user.name ?? user.email })}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card interactive className="flex flex-col gap-3">
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

        <Card interactive className="flex flex-col gap-3">
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

        <Card interactive className="flex flex-col gap-3">
          <CardTitle>{nav("calendar")}</CardTitle>
          <CardDescription>
            {locale === "zh"
              ? "这周每位教练在哪个雪场、什么时间在上课、还有哪些时间可以约。"
              : "Where each coach is this week, when they are teaching, and what is still free."}
          </CardDescription>
          <Button asChild variant="secondary" className="mt-auto self-start">
            <Link href="/calendar">
              <CalendarRange aria-hidden />
              {nav("calendar")}
            </Link>
          </Button>
        </Card>

        <Card interactive className="flex flex-col gap-3">
          <CardTitle>
            {nav("prices")} · {nav("packages")}
          </CardTitle>
          <CardDescription>
            {locale === "zh"
              ? "各教练的滑行课、一级考前培训和公园课价格;12 月 1 日前下单享早鸟价,蓝山课时包 4 小时 $180。"
              : "Every coach's prices for ski lessons, CSIA Level 1 prep and park. Book by 1 December for early-bird prices, or get 4 hours at Blue Mountain for $180."}
          </CardDescription>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/prices">{nav("prices")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/packages">
                <Package aria-hidden />
                {nav("packages")}
              </Link>
            </Button>
          </div>
        </Card>
      </div>

      {isCoach && (
        <Card interactive className="flex items-center justify-between gap-4">
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
