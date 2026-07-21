import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { listBookableCoaches } from "@/lib/coach";
import { formatMoneyShort } from "@/lib/pricing";
import { ArrowRight } from "lucide-react";

export default async function ChooseCoachPage({
  params,
}: PageProps<"/[locale]/book/[resort]">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}`,
  });

  const t = await getTranslations("booking");
  const tw = await getTranslations("waiver");
  const zh = locale === "zh";

  const resort = await prisma.resort.findUnique({
    where: { slug: resortSlug },
  });
  if (!resort?.isActive) notFound();

  const coaches = await listBookableCoaches(resortSlug);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          {zh ? resort.nameZh : resort.nameEn}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("stepCoach")}
        </h1>
      </div>

      {coaches.length === 0 ? (
        <Card>
          <CardDescription>{t("noSlots")}</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {coaches.map((coach) => (
            <Link
              key={coach.id}
              href={`/book/${resortSlug}/${coach.userId}`}
              className="block"
            >
              <Card className="flex h-full flex-col gap-2 transition-colors hover:border-ice-400">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{coach.displayName}</CardTitle>
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </div>
                {(zh ? coach.bioZh : coach.bioEn) && (
                  <CardDescription>
                    {zh ? coach.bioZh : coach.bioEn}
                  </CardDescription>
                )}
                <p className="text-sm">
                  <strong>{formatMoneyShort(coach.hourlyRateCents)}</strong>
                  {zh ? " / 小时" : " / hour"}
                  <span className="text-muted-foreground">
                    {zh
                      ? ` · 最少 ${coach.minHours} 小时`
                      : ` · ${coach.minHours}h minimum`}
                  </span>
                </p>
                {/* Set expectations before they invest time in picking a slot. */}
                <p className="mt-auto pt-2 text-xs text-muted-foreground">
                  {tw("seasonNote")}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
