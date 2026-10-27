"use client";

import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Label, Select, Hint } from "@/components/ui/field";

export function AnalysisSourceSelector({ locale, value, accountRemaining, courses }: {
  locale: Locale; value: string; accountRemaining: number;
  courses: { code: string; label: string; remaining: number }[];
}) {
  const zh = locale === "zh";
  const router = useRouter();
  return <div className="space-y-2">
    <Label htmlFor="analysis-source">{zh ? "选择使用的次数" : "Choose your credit source"}</Label>
    <Select id="analysis-source" value={value} onChange={event => {
      const source = event.target.value;
      router.replace(source === "account" ? "/video-analysis?source=account#workspace" : `/video-analysis?lesson=${encodeURIComponent(source)}#workspace`, { scroll: false });
    }}>
      <option value="account">{zh ? `教练发放 · 我的账号 · 可用 ${accountRemaining} 次` : `Coach-issued · My account · ${accountRemaining} available`}</option>
      {courses.map(course => <option key={course.code} value={course.code}>{course.label} · {zh ? `可用 ${course.remaining} 次` : `${course.remaining} available`}</option>)}
    </Select>
    <Hint>{zh ? "账号次数可用于自己的滑雪视频；课程次数在对应课程中共用。上传、分析和报告都在这里完成。" : "Account credits can analyse your own skiing videos; lesson credits are shared within that lesson. Upload, analyse and read your report here."}</Hint>
  </div>;
}
