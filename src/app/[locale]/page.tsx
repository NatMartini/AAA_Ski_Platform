import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/auth/require-user";
import { FreeSkiIntroCard } from "@/components/booking/freeski-intro-card";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  Package,
  Snowflake,
  UserRoundPlus,
} from "lucide-react";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const nav = await getTranslations("nav");
  const user = await getUser();
  const isCoach = user?.role === "COACH" || user?.role === "ADMIN";
  const video = await getTranslations("videoAnalysis");
  const videoIntro = <FreeSkiIntroCard copy={{ title: video("title"), attribution: video("attribution"),
    body: video(isCoach ? "coachBody" : "body"), quotaPolicy: video("quotaPolicy"),
    sharedPolicy: video("sharedPolicy"), action: video(isCoach ? "coachAction" : "action") }} />;

  // Signed-out visitors can discover FreeSki; course data still requires sign-in.
  if (!user) {
    return (
      <div className="home-hero animate-fade-up mx-auto my-4 max-w-lg px-6 py-10 text-center sm:my-10 sm:px-10 sm:py-14">
        <span className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
          <Snowflake className="size-8 text-accent" aria-hidden />
        </span>
        <h1 className="mt-6 text-3xl text-balance sm:text-4xl">{t("signedOutTitle")}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-2">
          {t("signedOutBody")}
        </p>
        <Button asChild size="lg" className="mt-7 w-full">
          <Link href="/sign-in">{nav("signIn")}</Link>
        </Button>
        <div className="mt-6">{videoIntro}</div>
      </div>
    );
  }

  if (isCoach) {
    const zh = locale === "zh";
    return (
      <div className="stagger space-y-5 sm:space-y-7">
        <div className="home-hero space-y-3 px-6 py-7 sm:px-8 sm:py-9">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-accent">
            <Snowflake className="size-4" aria-hidden />
            {zh ? "教练工作台" : "COACH WORKSPACE"}
          </p>
          <h1 className="max-w-2xl break-words text-3xl text-balance sm:text-4xl">{t("signedInTitle", { name: user.name ?? user.email })}</h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-2 sm:text-[15px]">
            {zh ? "查看课程与待办事项,为学员安排课程。" : "Review your lessons and pending actions, and arrange lessons for students."}
          </p>
        </div>
        {videoIntro}
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          <Card interactive className="home-action flex flex-col gap-3">
            <HomeIcon><LayoutDashboard aria-hidden /></HomeIcon>
            <CardTitle className="text-lg">{nav("coach")}</CardTitle>
            <CardDescription>
              {zh ? "查看今日课程、当前订单与需要处理的事项。" : "Today's lessons, current bookings and items that need your attention."}
            </CardDescription>
            <Button asChild className="mt-auto self-start">
              <Link href="/coach">{t("coachArea")}<ArrowRight aria-hidden /></Link>
            </Button>
          </Card>
          <Card interactive className="home-action flex flex-col gap-3">
            <HomeIcon><CalendarDays aria-hidden /></HomeIcon>
            <CardTitle className="text-lg">{zh ? "已排课程" : "Scheduled lessons"}</CardTitle>
            <CardDescription>
              {zh ? "按日期查看已安排的课程、学员和授课时间。" : "See scheduled lessons, students and teaching times by date."}
            </CardDescription>
            <Button asChild variant="secondary" className="mt-auto self-start">
              <Link href="/coach/schedule"><CalendarDays aria-hidden />{zh ? "查看课表" : "View schedule"}</Link>
            </Button>
          </Card>
          <Card interactive className="home-action flex flex-col gap-3">
            <HomeIcon><UserRoundPlus aria-hidden /></HomeIcon>
            <CardTitle className="text-lg">{zh ? "代学员建课" : "Book for a student"}</CardTitle>
            <CardDescription>
              {zh ? "为学员安排你执教的课程,并生成由学员或监护人签署的协议链接。" : "Arrange one of your lessons for a student and create a waiver link for them or their guardian."}
            </CardDescription>
            <Button asChild variant="secondary" className="mt-auto self-start">
              <Link href="/coach/bookings/new">{zh ? "创建课程" : "Create lesson"}<ArrowRight aria-hidden /></Link>
            </Button>
          </Card>
          <Card interactive className="home-action flex flex-col gap-3">
            <HomeIcon><CalendarRange aria-hidden /></HomeIcon>
            <CardTitle className="text-lg">{nav("calendar")}</CardTitle>
            <CardDescription>
              {zh ? "查看各教练的出勤日、课程和可用时间。" : "See every coach's working days, lessons and available time."}
            </CardDescription>
            <Button asChild variant="secondary" className="mt-auto self-start">
              <Link href="/calendar"><CalendarRange aria-hidden />{nav("calendar")}</Link>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="stagger space-y-5 sm:space-y-7">
      <div className="home-hero space-y-3 px-6 py-7 sm:px-8 sm:py-9">
        <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-accent">
          <Snowflake className="size-4" aria-hidden />
          {locale === "zh" ? "私人双板教学" : "PRIVATE SKI LESSONS"}
        </p>
        <h1 className="max-w-2xl break-words text-3xl text-balance sm:text-4xl">
          {t("signedInTitle", { name: user.name ?? user.email })}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-ink-2 sm:text-[15px]">
          {locale === "zh" ? "安排新课程，或查看已有预定。" : "Book your next lesson or check your existing bookings."}
        </p>
      </div>

      {videoIntro}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        <Card interactive className="home-action flex flex-col gap-3">
          <HomeIcon><Snowflake aria-hidden /></HomeIcon>
          <CardTitle className="text-lg">{nav("book")}</CardTitle>
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

        <Card interactive className="home-action flex flex-col gap-3">
          <HomeIcon><CalendarDays aria-hidden /></HomeIcon>
          <CardTitle className="text-lg">{nav("myBookings")}</CardTitle>
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

        <Card interactive className="home-action flex flex-col gap-3">
          <HomeIcon><CalendarRange aria-hidden /></HomeIcon>
          <CardTitle className="text-lg">{nav("calendar")}</CardTitle>
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

        <Card interactive className="home-action flex flex-col gap-3">
          <HomeIcon><Package aria-hidden /></HomeIcon>
          <CardTitle className="text-lg">
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

    </div>
  );
}

function HomeIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">
      {children}
    </span>
  );
}
