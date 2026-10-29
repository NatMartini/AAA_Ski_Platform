import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Gift } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireCoachPage } from "@/lib/auth/require-user";
import { VideoAnalysisGrants } from "@/components/coach/video-analysis-grants";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

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
    <PageHeader
      icon={<Gift aria-hidden />}
      tone="video"
      title={zh ? "FreeSki 次数发放" : "FreeSki credit issuance"}
      description={zh ? "来自 Kevin 的个人项目 — FreeSki 视频滑雪分析平台。为学员发放额外的免费分析次数，作为课后练习或体验。" : "Kevin's personal project — the FreeSki ski video analysis platform. Give students complimentary analyses for practice after lessons or a trial."}
      actions={<Button asChild variant="secondary"><Link href="/video-analysis">{zh ? "打开 FreeSki" : "Open FreeSki"}<ArrowRight aria-hidden /></Link></Button>}
    />
    <VideoAnalysisGrants key={user.id} locale={loc} coachId={user.id} />
  </div>;
}
