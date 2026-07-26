import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { pickCoachForLevel } from "@/lib/coach";
import { isLevelKey } from "@/lib/skills";

/**
 * Resolves "pick a coach for me" into a real coach and forwards to their
 * calendar.
 *
 * A static segment, so it can never be mistaken for a coach id (those are
 * cuids). Nothing is stored here — the choice only decides which calendar the
 * student lands on, and they can still go back and pick someone else.
 */
export default async function AutoAssignPage({
  params,
  searchParams,
}: PageProps<"/[locale]/book/[resort]/auto">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}`,
  });

  const { level } = await searchParams;
  const wanted = typeof level === "string" && isLevelKey(level) ? level : null;

  const coachId = await pickCoachForLevel(resortSlug, wanted);
  if (!coachId) redirect({ href: `/book/${resortSlug}`, locale });

  redirect({
    href: {
      pathname: `/book/${resortSlug}/${coachId}`,
      query: wanted ? { level: wanted } : {},
    },
    locale,
  });
}
