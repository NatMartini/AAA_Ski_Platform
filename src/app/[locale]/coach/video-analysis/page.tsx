import { setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireCoachPage } from "@/lib/auth/require-user";
import { VideoAnalysisGrants } from "@/components/coach/video-analysis-grants";

export default async function CoachVideoAnalysisPage({ params }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCoachPage({ locale, callbackPath: `/${locale}/coach/video-analysis` });
  const loc = toLocale(locale);
  const zh = loc === "zh";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-extrabold">{zh ? "FreeSki 次数发放" : "FreeSki credit issuance"}</h2>
        <p className="text-sm leading-relaxed text-ink-2">{zh ? "来自 Kevin 的个人项目 — FreeSki 视频滑雪分析平台。为学员发放额外的免费分析次数，作为课后练习或体验。" : "Kevin's personal project — the FreeSki ski video analysis platform. Give students complimentary analyses for practice after lessons or a trial."}</p>
      </div>
      <Link href="/video-analysis" className="press inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-bold text-accent">{zh ? "打开 FreeSki" : "Open FreeSki"}<ArrowRight className="size-4" aria-hidden /></Link>
    </div>
    <VideoAnalysisGrants key={user.id} locale={loc} coachId={user.id} />
  </div>;
}
