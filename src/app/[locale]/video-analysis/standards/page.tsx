import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import type { StandardMotionId } from "@/lib/freeski/standard-motion";
import { PageHeader } from "@/components/ui/page-header";
import { StandardMotionViewer } from "@/components/booking/standard-motion-viewer";
import { FreeSkiLogo } from "@/components/booking/freeski-brand";
import { seasonMotionId } from "@/lib/freeski/csia-season";
import { seasonMotionGroups } from "@/lib/season-update/season-list";
import { readCurrentSeason } from "@/lib/season-update/season-store";

export default async function StandardMotionsPage({ params, searchParams }: PageProps<"/[locale]/video-analysis/standards">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis/standards` });
  const zh = toLocale(locale) === "zh";
  const { motion } = await searchParams;
  // The library follows the season in use: the list the last "update the actions" run published.
  const season = readCurrentSeason(), ids = season.actions.map(seasonMotionId);
  const initial = (ids.find(id => id === motion) ?? ids.find(id => id === "demonstration_parallel-l2") ?? ids[0]) as StandardMotionId;

  return (
    <div className="space-y-6">
      <Link href="/video-analysis" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />{zh ? "返回我的分析" : "Back to my analyses"}
      </Link>
      <PageHeader
        icon={<FreeSkiLogo />}
        tone="video"
        eyebrow={zh ? `${season.season} 雪季 · ${season.actions.length} 个 CSIA 考核动作` : `${season.season} season · ${season.actions.length} CSIA exam runs`}
        title={zh ? "标准动作库" : "Standard movements"}
        description={zh ? "按考官指南和示范视频生成的标准动作，不是真人示范，也不是考官认定的标准。"
          : "Standards generated from the candidate guides and demonstration videos; not a real skier and not an examiner's standard."}
      />
      <StandardMotionViewer zh={zh} initial={initial} groups={seasonMotionGroups(season)} lessons={user.role === "COACH" || user.role === "ADMIN"} />
    </div>
  );
}
