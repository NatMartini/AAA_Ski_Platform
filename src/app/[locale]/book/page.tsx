import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { listBookableCoaches } from "@/lib/coach";
import { MapPin, ArrowRight } from "lucide-react";

export default async function ChooseResortPage({
  params,
}: PageProps<"/[locale]/book">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUserPage({ locale, callbackPath: `/${locale}/book` });

  const t = await getTranslations("booking");
  const zh = locale === "zh";

  const resorts = await prisma.resort.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
  });

  // Only offer a resort that actually has a bookable coach with open days.
  const withCoaches = await Promise.all(
    resorts.map(async (resort) => ({
      resort,
      coaches: await listBookableCoaches(resort.slug),
    })),
  );

  const available = withCoaches.filter((r) => r.coaches.length > 0);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("stepResort")}
      </h1>

      {available.length === 0 ? (
        <Card>
          <CardDescription>{t("noSlots")}</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {available.map(({ resort, coaches }) => (
            <Link key={resort.id} href={`/book/${resort.slug}`} className="block">
              <Card className="flex h-full flex-col gap-2 transition-colors hover:border-ice-400">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{zh ? resort.nameZh : resort.nameEn}</CardTitle>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                {resort.address && (
                  <CardDescription className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {resort.address}
                  </CardDescription>
                )}
                <p className="mt-auto pt-2 text-xs text-muted-foreground">
                  {coaches.map((c) => c.displayName).join(" · ")}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
