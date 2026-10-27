import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";
import { toLocale } from "@/i18n/routing";
import { VideoReviewWorkspace } from "@/components/coach/video-review-workspace";

export default async function CoachVideoReviewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCoachPage({ locale, callbackPath: `/${locale}/coach/video-reviews` });
  return <VideoReviewWorkspace key={user.id} locale={toLocale(locale)} coachId={user.id} />;
}
