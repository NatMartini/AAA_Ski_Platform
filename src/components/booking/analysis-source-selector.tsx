"use client";

import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Label, Select } from "@/components/ui/field";

/** Which videos to show: the personal wallet or one lesson's, each with its own credits. Shown only with lessons to choose from. */
export function AnalysisSourceSelector({ locale, value, accountRemaining, accountUnlimited = false, courses }: {
  locale: Locale; value: string; accountRemaining: number; accountUnlimited?: boolean;
  courses: { code: string; label: string; remaining: number }[];
}) {
  const zh = locale === "zh";
  const router = useRouter();
  return <div className="flex flex-wrap items-center gap-2">
    <Label htmlFor="analysis-source" className="shrink-0 text-ink-2">{zh ? "视频来源" : "Videos from"}</Label>
    <Select id="analysis-source" value={value} className="min-w-0 flex-1 sm:max-w-xl" onChange={event => {
      const source = event.target.value;
      router.replace(source === "account" ? "/video-analysis?source=account#workspace" : `/video-analysis?lesson=${encodeURIComponent(source)}#workspace`, { scroll: false });
    }}>
      {/* The count is in the page's title already. */}
      <option value="account">{accountUnlimited || !accountRemaining ? (zh ? "我的视频" : "My videos") : zh ? `我的视频 · 可用 ${accountRemaining} 次` : `My videos · ${accountRemaining} available`}</option>
      {courses.map(course => <option key={course.code} value={course.code}>{zh ? "课程视频" : "Lesson videos"} · {course.label}</option>)}
    </Select>
  </div>;
}
