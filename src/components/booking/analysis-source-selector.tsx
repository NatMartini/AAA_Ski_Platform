"use client";

import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Label, Select, Hint } from "@/components/ui/field";

/** Which library to show: the personal wallet or one lesson's shared credits. */
export function AnalysisSourceSelector({ locale, value, accountRemaining, courses }: {
  locale: Locale; value: string; accountRemaining: number;
  courses: { code: string; label: string; remaining: number }[];
}) {
  const zh = locale === "zh";
  const router = useRouter();
  return <div className="space-y-2">
    <Label htmlFor="analysis-source">{zh ? "视频来源" : "Video source"}</Label>
    <Select id="analysis-source" value={value} onChange={event => {
      const source = event.target.value;
      router.replace(source === "account" ? "/video-analysis?source=account#workspace" : `/video-analysis?lesson=${encodeURIComponent(source)}#workspace`, { scroll: false });
    }}>
      <option value="account">{zh ? `我的视频 · 教练发放次数 · 可用 ${accountRemaining} 次` : `My videos · Coach-issued credits · ${accountRemaining} available`}</option>
      {courses.map(course => <option key={course.code} value={course.code}>{zh ? "课程视频" : "Lesson videos"} · {course.label} · {zh ? `可用 ${course.remaining} 次` : `${course.remaining} available`}</option>)}
    </Select>
    <Hint>{zh ? "我的视频使用账号次数；课程视频使用该课程的共享次数。上传、分析和报告都在下面的视频库里。" : "My videos use your account credits; lesson videos use that lesson's shared credits. Upload, analyse and open reports in the library below."}</Hint>
  </div>;
}
