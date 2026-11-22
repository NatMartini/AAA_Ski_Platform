import { setRequestLocale } from "next-intl/server";
import { Check, Minus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import { FILMING_GUIDE } from "@/lib/video-analysis/precheck";
import { LESSON_ANALYSES } from "@/lib/video-analysis/quota";
import { ANALYSIS_TIERS, FREE_ANALYSES_PER_DAY, priceLabel, TIER_HALVES, TIER_INFO } from "@/lib/video-analysis/tiers";
import { DISCLAIMER, REPORT_SECTIONS, TIER_CONTENTS } from "@/lib/video-analysis/guide-content";
import { readCurrentSeason } from "@/lib/season-update/season-store";
import { PageHeader } from "@/components/ui/page-header";
import { FreeSkiLogo } from "@/components/booking/freeski-brand";

/**
 * Everything about video analysis in one place, in the order it is used: the steps, the tiers, credits, filming, reading
 * the report, keeping videos, and the disclaimer. The rest of the section keeps its notes short and links here.
 */
export default async function AnalysisGuidePage({ params }: PageProps<"/[locale]/video-analysis/guide">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis/guide` });
  const zh = toLocale(locale) === "zh";
  const t = (cn: string, en: string) => zh ? cn : en;
  const season = readCurrentSeason();
  const sections = [
    { id: "steps", title: t("流程", "How it works") },
    { id: "tiers", title: t("分析档位", "Analysis tiers") },
    { id: "credits", title: t("分析次数", "Credits") },
    { id: "filming", title: t("怎么拍", "Filming") },
    { id: "report", title: t("怎么看报告", "Reading the report") },
    { id: "keeping", title: t("保存和隐私", "Keeping and privacy") },
    { id: "standards", title: t("标准示范", "The standards") },
    { id: "disclaimer", title: t("免责声明", "Disclaimer") },
  ];
  const steps = [
    t("上传视频：MP4 或 MOV，最大 200MB。", "Upload a video: MP4 or MOV, up to 200MB."),
    t("选视频里的动作（不选就由 FreeSki 自动识别，认错了可以改）和分析档位。", "Choose the action in the video (or leave it to FreeSki to recognise, and correct it if wrong) and the analysis tier."),
    t("等报告：评分一般 3–5 分钟，排队时更久；这一档的内容全部生成好之后报告才出现，深度和完全档会再多等几分钟。可以先离开。",
      "Wait for the report: scoring usually takes 3–5 minutes, longer in a queue, and the report appears once everything its tier shows has been made, a few minutes more at deep and complete. You can leave meanwhile."),
    t("看报告：结论 → 看问题 → 动作讲解 → 怎么练 → 数据。", "Read the report: summary → watch → explained → practise → data."),
    t("跟着练，过一阵再拍一段同样的动作，报告会和上一次对比。", "Practise, then film the same run again; the report compares it with last time."),
  ];
  const card = "scroll-mt-28 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5";

  return <div className="space-y-6">
    <PageHeader icon={<FreeSkiLogo />} tone="video" eyebrow="FreeSki" title={t("使用指南", "Guide")}
      description={t("视频分析从上传到练习的全部说明，按使用顺序排。", "Everything about video analysis, from upload to practice, in the order you use it.")} />
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <nav aria-label={t("目录", "Contents")} className="scrollbar-none mb-4 flex gap-1.5 overflow-x-auto lg:sticky lg:top-24 lg:mb-0 lg:flex-col lg:self-start">
        <p className="hidden px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3 lg:block">{t("目录", "Contents")}</p>
        {sections.map((section, i) => <a key={section.id} href={`#${section.id}`}
          className="press flex min-h-10 shrink-0 items-center rounded-full border border-border bg-surface px-3.5 text-xs font-semibold text-ink-2 hover:text-ink lg:min-h-9 lg:rounded-lg lg:border-0 lg:bg-transparent lg:px-2 lg:text-sm lg:font-medium">
          <span className="mr-1 text-ink-3">{i + 1}</span>{section.title}</a>)}
      </nav>
      <div className="min-w-0 space-y-4">
        <section id="steps" className={card}>
          <h2 className="text-base font-semibold">1. {sections[0].title}</h2>
          <ol className="space-y-2">{steps.map((step, i) => <li key={i} className="flex gap-3 text-sm leading-relaxed">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>{step}</li>)}</ol>
          <Link href="/video-analysis" className="inline-flex text-sm font-semibold text-accent hover:underline">{t("去我的分析 →", "Go to my analyses →")}</Link>
        </section>

        <section id="tiers" className={card}>
          <h2 className="text-base font-semibold">2. {sections[1].title}</h2>
          <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-xs sm:text-sm">
            <thead><tr className="text-xs text-ink-3"><th className="w-[40%] py-2 pr-2 font-medium">{t("内容", "Contents")}</th>
              {ANALYSIS_TIERS.map(tier => <th key={tier} className="px-1 py-2 text-center font-semibold text-ink">{zh ? TIER_INFO[tier].zh : TIER_INFO[tier].en}
                <span className="block text-xs font-normal text-ink-3">{priceLabel(TIER_HALVES[tier], zh)}</span></th>)}</tr></thead>
            <tbody>{TIER_CONTENTS.map(row => <tr key={row.en} className="border-t border-border">
              <td className="py-2 pr-2 text-ink-2">{zh ? row.zh : row.en}</td>
              {ANALYSIS_TIERS.map(tier => <td key={tier} className="px-1 py-2 text-center">{ANALYSIS_TIERS.indexOf(tier) >= ANALYSIS_TIERS.indexOf(row.from)
                ? <Check className="mx-auto size-4 text-success" aria-label={t("有", "Included")} /> : <Minus className="mx-auto size-4 text-ink-3" aria-label={t("没有", "Not included")} />}</td>)}
            </tr>)}</tbody>
          </table></div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>{t(`简单和标准免费，每人每天最多 ${FREE_ANALYSES_PER_DAY} 次；教练不限。`, `Simple and standard are free, up to ${FREE_ANALYSES_PER_DAY} a day per person; coaches have no limit.`)}</li>
            <li>{t("分析完成后还能改档位：免费档之间随便改；往上改只扣差价（例如深度改完全再扣 0.5 次）；往下改不退次数，之后再改回付过的档位也不再扣。改档后，新档位的内容生成好才显示。", "You can change the tier afterwards: free tiers swap freely; going up costs only the difference (deep to complete is 0.5 more); going down refunds nothing, and going back to a tier you paid for is free. The report shows again once the new tier's content has been made.")}</li>
            <li>{t("自动识别认错了动作时，在报告里改成正确的动作重新分析一次：已付的次数带到新的分析上，不退也不重复扣，也不占当天的免费次数。", "If automatic recognition got the action wrong, correct it in the report and the clip is analysed once more: what you paid carries over to the new analysis, with no refund, no second charge, and no use of the day's free analyses.")}</li>
          </ul>
        </section>

        <section id="credits" className={card}>
          <h2 className="text-base font-semibold">3. {sections[2].title}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>{t(`注册送 3 次，每上完一节课再送 ${LESSON_ANALYSES} 次（一起上课、有账号的同伴各自也有），都进你的账户，什么时候用都行。`, `3 on joining and ${LESSON_ANALYSES} more for every completed lesson (each companion with an account gets their own), all in your account to use any time.`)}</li>
            <li>{t("教练也可以发放次数，或者通过微信购买。", "Coaches can issue more, or you can buy them by WeChat.")}</li>
            <li>{t("分析失败或无法评分不扣次数。", "A failed or ungradable analysis uses no credit.")}</li>
          </ul>
        </section>

        <section id="filming" className={card}>
          <h2 className="text-base font-semibold">4. {sections[3].title}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">{FILMING_GUIDE.map((rule, i) => <li key={i}>{zh ? rule.zh : rule.en}</li>)}</ol>
        </section>

        <section id="report" className={card}>
          <h2 className="text-base font-semibold">5. {sections[4].title}</h2>
          <dl className="space-y-2 text-sm">{REPORT_SECTIONS.map(section => <div key={section.en} className="grid gap-1 sm:grid-cols-[6rem_1fr]">
            <dt className="font-semibold">{zh ? section.zh : section.en}</dt><dd className="text-ink-2">{zh ? section.textZh : section.textEn}</dd></div>)}</dl>
          <p className="text-xs text-ink-3">{t("3D 画面都能拖动转视角。受力箭头是按标准动作算的示意，不是你的测量值；滑行轨迹的大小按标准速度估算。", "Every 3D view can be dragged round. Force arrows are worked out for the standard, not measured on you; your path's size assumes the standard's speed.")}</p>
        </section>

        <section id="keeping" className={card}>
          <h2 className="text-base font-semibold">6. {sections[5].title}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>{t("视频保存到这个雪季结束（5 月 31 日）后自动删除；分析报告一直保留，也可以下载 PDF。", "Videos are kept until the ski season ends (May 31), then deleted; reports stay and can be downloaded as PDF.")}</li>
            <li>{t("个人视频和报告只有你自己能看，可以逐个授权教练人工点评。", "Personal videos and reports are yours alone; you can ask a coach to review a clip.")}</li>
            <li>{t("课程视频只有这节课的学员和教练能看。", "Lesson videos are seen only by that lesson's students and coach.")}</li>
          </ul>
        </section>

        <section id="standards" className={card}>
          <h2 className="text-base font-semibold">7. {sections[6].title}</h2>
          <p className="text-sm text-ink-2">{t(`${season.season} 雪季的 ${season.actions.length} 个 CSIA 考核动作，各有一个按考官指南和示范视频生成的标准动作，用来对比和讲解。它不是真人示范，也不是考官认定的标准。`,
            `The ${season.actions.length} CSIA exam runs of the ${season.season} season each have a standard generated from the candidate guides and demonstration videos, for comparison and explanation. It is not a real skier and not an examiner's standard.`)}</p>
          <Link href="/video-analysis/standards" className="inline-flex text-sm font-semibold text-accent hover:underline">{t("打开标准动作库 →", "Open the standards →")}</Link>
        </section>

        <section id="disclaimer" className={card}>
          <h2 className="text-base font-semibold">8. {sections[7].title}</h2>
          <p className="text-sm leading-relaxed text-ink">{zh ? DISCLAIMER.zh : DISCLAIMER.en}</p>
        </section>
      </div>
    </div>
  </div>;
}
