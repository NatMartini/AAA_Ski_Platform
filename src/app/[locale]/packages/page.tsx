import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EarlyBirdTag } from "@/components/booking/price-breakdown";
import { PackageBuyForm } from "@/components/packages/package-buy-form";
import { PackageStatusPill } from "@/components/packages/package-status-pill";
import { listBookableCoaches } from "@/lib/coach";
import { offerLabel, offersOnSale, packageTotalHours } from "@/lib/packages";
import { hoursLeft, packageInclude } from "@/lib/package-store";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, toDateKey } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";

export default async function PackagesPage({
  params,
}: PageProps<"/[locale]/packages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/packages`,
  });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const sale = offersOnSale(toDateKey(new Date()));
  const lastDay = formatTorontoDate(new Date(`${sale.lastDay}T12:00:00Z`), loc);

  const [coaches, resorts, mine] = await Promise.all([
    listBookableCoaches(),
    prisma.resort.findMany({ where: { isActive: true } }),
    prisma.lessonPackage.findMany({
      where: { accountId: user.id },
      include: packageInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const now = new Date();

  return (
    <div className="stagger space-y-6">
      <h1 className="text-3xl">{zh ? "课时包" : "Lesson packages"}</h1>

      {sale.offers.length === 0 ? (
        <Card>
          <CardDescription>
            {zh
              ? `课时包是早鸟专享,本季已于 ${lastDay} 停售。`
              : `Packages are an early-bird offer and came off sale on ${lastDay}.`}{" "}
            <Link href="/prices" className="font-bold text-accent underline underline-offset-2">
              {zh ? "查看价目表" : "See prices"}
            </Link>
          </CardDescription>
        </Card>
      ) : (
        sale.offers.map((offer) => {
          const resort = resorts.find((r) => r.slug === offer.resortSlug);
          return (
            <Card key={offer.key} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{zh ? offer.zh : offer.en}</CardTitle>
                  <p className="mt-1 text-sm text-ink-2" data-numeric>
                    <strong className="font-display text-2xl text-ink">
                      {formatMoneyShort(offer.priceCents)}
                    </strong>{" "}
                    / {offer.hours} {zh ? "小时" : "hours"} ·{" "}
                    {lessonTypeLabel(offer.lessonType, loc)} ·{" "}
                    {resort ? (zh ? resort.nameZh : resort.nameEn) : offer.resortSlug}
                  </p>
                </div>
                <EarlyBirdTag
                  label={zh ? `${lastDay} 截止` : `Until ${lastDay}`}
                />
              </div>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink-2">
                {(zh
                  ? [
                      "买哪位教练的课时包,就只能约这位教练上课。",
                      "可以拆开用,例如 2 小时 + 2 小时;每次预约最少 2 小时。",
                      `仅限 ${sale.season} 雪季内使用;付款截图需在 ${lastDay} 前提交。`,
                    ]
                  : [
                      "A package books lessons only with the coach you bought it from.",
                      "Split it up, say 2 hours + 2 hours; each booking is at least 2 hours.",
                      `For lessons in the ${sale.season} season; send the payment screenshot by ${lastDay}.`,
                    ]
                ).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {coaches.length > 0 && (
                <PackageBuyForm
                  locale={loc}
                  offerKey={offer.key}
                  coaches={coaches.map((c) => ({
                    userId: c.userId,
                    displayName: c.displayName,
                  }))}
                />
              )}
            </Card>
          );
        })
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {zh ? "我的课时包" : "My packages"}
        </h2>
        {mine.length === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "还没有课时包。" : "No packages yet."}
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {mine.map((p) => {
              const left = p.status === "ACTIVE" ? hoursLeft(p, now) : 0;
              const total = packageTotalHours(p);
              return (
                <Link
                  key={p.id}
                  href={`/packages/${p.code}`}
                  className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-accent/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{offerLabel(p.offerKey, loc)}</span>
                      <PackageStatusPill status={p.status} locale={loc} />
                    </div>
                    <p className="text-sm text-ink-2" data-numeric>
                      {zh
                        ? `剩余 ${left} / ${total} 小时 · 教练 ${p.payeeCoach.name ?? p.payeeCoach.email}`
                        : `${left} of ${total} hours left · coach ${p.payeeCoach.name ?? p.payeeCoach.email}`}
                    </p>
                    <p className="font-mono text-xs text-ink-3">
                      {p.code} · {formatMoneyShort(p.priceCents)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
