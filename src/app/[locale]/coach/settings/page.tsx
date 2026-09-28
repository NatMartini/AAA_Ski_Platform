import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { CoachSettingsForm } from "@/components/coach/coach-settings-form";
import { toLocale } from "@/i18n/routing";

export default async function CoachSettingsPage({
  params,
}: PageProps<"/[locale]/coach/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });
  const profile = await prisma.coachProfile.findUnique({
    where: { userId: user.id },
    include: { rates: true },
  });

  if (!profile) {
    return (
      <p className="text-sm text-muted-foreground">
        No coach profile exists for this account yet.
      </p>
    );
  }

  return (
    <CoachSettingsForm
      locale={toLocale(locale)}
      coachId={user.id}
      initial={{
        displayName: profile.displayName,
        avatarKey: profile.avatarKey,
        bioZh: profile.bioZh ?? "",
        bioEn: profile.bioEn ?? "",
        csiaLevel: profile.csiaLevel,
        csiaParkLevel: profile.csiaParkLevel,
        teachableSkills: profile.teachableSkills,
        teachableLevels: profile.teachableLevels,
        rates: profile.rates.map((r) => ({
          lessonType: r.lessonType,
          regularCents: r.regularCents,
          earlyBirdCents: r.earlyBirdCents,
        })),
        handoverDiscountCents: profile.handoverDiscountCents,
        extraPersonCents: profile.extraPersonCents,
        maxGroupSize: profile.maxGroupSize,
        minHours: profile.minHours,
        maxHours: profile.maxHours,
        leadTimeHours: profile.leadTimeHours,
        emtEnabled: profile.emtEnabled,
        emtEmail: profile.emtEmail ?? "",
        emtName: profile.emtName ?? "",
        wechatPayEnabled: profile.wechatPayEnabled,
        wechatPayQrKey: profile.wechatPayQrKey,
        alipayEnabled: profile.alipayEnabled,
        alipayQrKey: profile.alipayQrKey,
        wechatId: profile.wechatId ?? "",
        contactEmail: profile.contactEmail ?? "",
        contactPhone: profile.contactPhone ?? "",
        cancellationPolicyZh: profile.cancellationPolicyZh ?? "",
        cancellationPolicyEn: profile.cancellationPolicyEn ?? "",
        isPublished: profile.isPublished,
        icsToken: profile.icsToken,
      }}
    />
  );
}
