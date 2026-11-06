import { setRequestLocale } from "next-intl/server";
import { ArrowLeft, PersonStanding } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import { STANDARD_MOTION_IDS, type StandardMotionId } from "@/lib/freeski/standard-motion";
import { PageHeader } from "@/components/ui/page-header";
import { StandardMotionViewer } from "@/components/booking/standard-motion-viewer";

export default async function StandardMotionsPage({ params, searchParams }: PageProps<"/[locale]/video-analysis/standards">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis/standards` });
  const zh = toLocale(locale) === "zh";
  const { motion } = await searchParams;
  const initial: StandardMotionId = STANDARD_MOTION_IDS.find(id => id === motion) ?? "demonstration_parallel-l2";

  return (
    <div className="space-y-6">
      <Link href="/video-analysis" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />{zh ? "返回视频库" : "Back to the video library"}
      </Link>
      <PageHeader
        icon={<PersonStanding aria-hidden />}
        tone="video"
        title={zh ? "标准动作库" : "Standard movements"}
        description={zh ? "每个 CSIA 考核动作的标准数据：人、雪板和雪杖从换刃到换刃的完整动作。按指南的要求和示范视频的数据生成，再用 FreeSki 的评分代码检查过。它不是真人示范，也不是考官认定的标准。"
          : "Standard data for each CSIA exam run: the skier, skis and poles through a whole turn, edge change to edge change. Generated from the guides and the demonstration videos, then checked with FreeSki's scoring code. It is not a real skier and not an examiner's standard."}
      />
      <StandardMotionViewer zh={zh} initial={initial} />
    </div>
  );
}
