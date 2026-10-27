import { ArrowRight, Video, Wand2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

/** Public project introduction; the linked analysis page requires sign-in. */
export function VideoAnalysisEntry({ locale, isCoach = false }: { locale: Locale; isCoach?: boolean }) {
  const c = (locale === "zh" ? zh : en).videoAnalysis;
  return (
    <section aria-label={c.title} className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft via-surface to-surface-2 p-5 shadow-[var(--shadow)] sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-3 sm:max-w-xl">
          <p className="inline-flex items-center gap-2 text-xs font-bold text-accent"><Video className="size-4" aria-hidden />FreeSki</p>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{c.title}</h2>
            <p className="text-sm font-semibold text-ink-2">{c.attribution}</p>
            <p className="text-sm leading-relaxed text-ink-2">{isCoach ? c.coachBody : c.body}</p>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">{c.quotaPolicy} {c.sharedPolicy}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          <span className="hidden size-12 items-center justify-center rounded-2xl border border-accent/20 bg-surface text-accent shadow-[var(--shadow-sm)] sm:flex"><Wand2 className="size-6" aria-hidden /></span>
          <Button asChild className="w-full sm:w-auto"><Link href="/video-analysis">{isCoach ? c.coachAction : c.action}<ArrowRight aria-hidden /></Link></Button>
        </div>
      </div>
    </section>
  );
}
