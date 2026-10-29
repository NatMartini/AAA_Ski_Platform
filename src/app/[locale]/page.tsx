import { getTranslations, setRequestLocale } from "next-intl/server";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CalendarPlus,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Snowflake,
  Users,
  Video,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-header";
import { TONE_TILE, type Tone } from "@/components/ui/tone";
import { getUser } from "@/lib/auth/require-user";
import { FreeSkiIntroCard } from "@/components/booking/freeski-intro-card";
import { MountainArt } from "@/components/mountain-art";

type CategoryLink = { href: string; label: string };

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const nav = await getTranslations("nav");
  const user = await getUser();
  const isCoach = user?.role === "COACH" || user?.role === "ADMIN";
  const zh = locale === "zh";
  const video = await getTranslations("videoAnalysis");

  // Signed-out visitors can discover FreeSki; course data still requires sign-in.
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 sm:mt-4">
        <section className="hero-banner animate-fade-up px-6 py-10 text-center sm:px-12 sm:py-14">
          <MountainArt className="hero-art" />
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white/15">
            <Snowflake className="size-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-3xl text-balance sm:text-4xl">{t("signedOutTitle")}</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed opacity-85">{t("signedOutBody")}</p>
          <Button asChild size="lg" className="mt-7 bg-white text-[var(--hero-from)] hover:bg-white/90">
            <Link href="/sign-in">{nav("signIn")}</Link>
          </Button>
        </section>
        <FreeSkiIntroCard copy={{ title: video("title"), attribution: video("attribution"),
          body: video("body"), quotaPolicy: video("quotaPolicy"),
          sharedPolicy: video("sharedPolicy"), action: zh ? "了解视频分析" : "About video analysis" }} />
      </div>
    );
  }

  const name = user.name ?? user.email;

  if (isCoach) {
    return (
      <div className="space-y-8">
        <Hero
          eyebrow={zh ? "教练工作台" : "Coach workspace"}
          title={t("signedInTitle", { name })}
          body={zh ? "查看课程与待办事项，为学员安排课程。" : "Review your lessons and pending actions, and arrange lessons for students."}
          primary={{ href: "/coach", label: zh ? "打开工作台" : "Open dashboard", icon: LayoutDashboard }}
          videoLabel={zh ? "视频分析" : "Video analysis"}
        />
        <section className="space-y-3">
          <SectionHeading title={zh ? "全部功能" : "Everything"} />
          <div className="grid gap-4 md:grid-cols-3">
            <CategoryCard tone="lessons" icon={ClipboardList} title={zh ? "课程" : "Lessons"}
              description={zh ? "课表、代学员建课和各教练的出勤日历。" : "Your schedule, booking for students and every coach's calendar."}
              links={[
                { href: "/coach/schedule", label: zh ? "已排课程" : "Scheduled lessons" },
                { href: "/coach/bookings/new", label: zh ? "代学员建课" : "Book for a student" },
                { href: "/calendar", label: nav("calendar") },
              ]} />
            <CategoryCard tone="people" icon={Users} title={zh ? "学员" : "Students"}
              description={zh ? "学员名单、剩余课时和课时包付款。" : "Your students, hours left and package payments."}
              links={[
                { href: "/coach/students", label: zh ? "学员" : "Students" },
                { href: "/coach/packages", label: nav("packages") },
              ]} />
            <CategoryCard tone="video" icon={Video} title={zh ? "视频" : "Video"}
              description={video("coachBody")}
              links={[
                { href: "/video-analysis", label: zh ? "视频分析" : "Video analysis" },
                { href: "/coach/video-analysis", label: zh ? "给学员发放次数" : "Issue credits" },
                { href: "/coach/video-reviews", label: zh ? "视频点评" : "Video reviews" },
              ]} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Hero
        eyebrow={zh ? "私人双板教学" : "Private ski lessons"}
        title={t("signedInTitle", { name })}
        body={zh ? "约一节新课，查看已有课程，或者上传滑雪视频看看自己的动作。" : "Book your next lesson, check your bookings, or upload a skiing video to review your technique."}
        primary={{ href: "/book", label: nav("book"), icon: CalendarPlus }}
        videoLabel={zh ? "视频分析" : "Video analysis"}
      />
      <section className="space-y-3">
        <SectionHeading title={zh ? "全部功能" : "Everything"} />
        <div className="grid gap-4 md:grid-cols-3">
          <CategoryCard tone="book" icon={CalendarPlus} title={zh ? "约课" : "Book"}
            description={zh ? "选择雪场、教练和时间，两小时起。12 月 1 日前下单享早鸟价，蓝山课时包 4 小时 $180。" : "Pick a resort, coach and time; two hours minimum. Book by 1 December for early-bird prices, or get 4 hours at Blue Mountain for $180."}
            links={[
              { href: "/book", label: nav("book") },
              { href: "/prices", label: nav("prices") },
              { href: "/packages", label: nav("packages") },
              { href: "/calendar", label: nav("calendar") },
            ]} />
          <CategoryCard tone="lessons" icon={ClipboardList} title={zh ? "我的课程" : "My lessons"}
            description={zh ? "查看订单状态、签署协议与付款进度。" : "Check status, waivers and payment progress."}
            links={[{ href: "/my/bookings", label: nav("myBookings") }]} />
          <CategoryCard tone="video" icon={Video} title={zh ? "视频分析" : "Video analysis"}
            description={`${video("body")} ${video("quotaPolicy")}`}
            links={[{ href: "/video-analysis", label: zh ? "打开视频库" : "Open video library" }]} />
        </div>
      </section>
    </div>
  );
}

function Hero({ eyebrow, title, body, primary, videoLabel }: {
  eyebrow: string;
  title: string;
  body: string;
  primary: { href: string; label: string; icon: LucideIcon };
  videoLabel: string;
}) {
  const PrimaryIcon = primary.icon;
  return (
    <section className="hero-banner animate-fade-up px-6 py-8 sm:px-10 sm:py-12">
      <MountainArt className="hero-art" />
      <p className="flex items-center gap-2 text-sm font-semibold opacity-80">
        <Snowflake className="size-4" aria-hidden />
        {eyebrow}
      </p>
      <h1 className="mt-3 max-w-2xl break-words text-3xl text-balance sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed opacity-85">{body}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button asChild size="lg" className="bg-white text-[var(--hero-from)] hover:bg-white/90">
          <Link href={primary.href}><PrimaryIcon aria-hidden />{primary.label}</Link>
        </Button>
        <Button asChild size="lg" className="border border-white/40 bg-white/10 text-white hover:bg-white/20">
          <Link href="/video-analysis"><Video aria-hidden />{videoLabel}</Link>
        </Button>
      </div>
    </section>
  );
}

function CategoryCard({ tone, icon: Icon, title, description, links }: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  description: string;
  links: CategoryLink[];
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)]">
      <span className={`flex size-11 items-center justify-center rounded-xl ${TONE_TILE[tone]}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{description}</p>
      <div className="mt-4 divide-y divide-border border-t border-border">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="group flex min-h-11 items-center justify-between gap-3 py-2 text-sm font-semibold text-ink hover:text-accent">
            {link.label}
            {links.length === 1
              ? <ArrowRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
              : <ChevronRight className="size-4 shrink-0 text-ink-3 group-hover:text-accent" aria-hidden />}
          </Link>
        ))}
      </div>
    </div>
  );
}
