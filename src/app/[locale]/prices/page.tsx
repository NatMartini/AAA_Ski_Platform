import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EarlyBirdTag } from "@/components/booking/price-breakdown";
import { listBookableCoaches } from "@/lib/coach";
import { earlyBirdWindow, offeredRates } from "@/lib/rates";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { PACKAGE_OFFERS, offersOnSale } from "@/lib/packages";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, toDateKey } from "@/lib/time";
import { formatSeason } from "@/lib/season";
import { toLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ArrowRight, Package } from "lucide-react";

/**
 * The price sheet, rendered from the live rate cards rather than typed in,
 * so it can never disagree with what the booking page charges.
 *
 * Signed-in only, like every other page: prices are exactly what a signed-out
 * visitor must not be able to learn.
 */
export default async function PricesPage({
  params,
}: PageProps<"/[locale]/prices">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUserPage({ locale, callbackPath: `/${locale}/prices` });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const today = toDateKey(new Date());
  const early = earlyBirdWindow(today);
  const sale = offersOnSale(today);
  const lastDay = formatTorontoDate(new Date(`${early.lastDay}T12:00:00Z`), loc);

  const [coaches, resorts] = await Promise.all([
    listBookableCoaches(),
    prisma.resort.findMany({ where: { isActive: true } }),
  ]);
  const resortName = (slug: string) => {
    const r = resorts.find((x) => x.slug === slug);
    return r ? (zh ? r.nameZh : r.nameEn) : slug;
  };

  return (
    <div className="stagger space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {formatSeason(early.season, loc)}
        </p>
        <h1 className="mt-1 text-3xl">{zh ? "价目表" : "Prices"}</h1>
      </div>

      <p
        className="rounded-xl p-3.5 text-sm font-semibold"
        style={
          early.active
            ? { background: "var(--amber-bg)", color: "var(--amber)" }
            : undefined
        }
      >
        {early.active
          ? zh
            ? `早鸟价进行中:${lastDay}(含)之前下单,整个雪季的课都按早鸟价。`
            : `Early bird is on: book by ${lastDay} and every lesson that season is at the early-bird price.`
          : zh
            ? `早鸟价已于 ${lastDay} 截止,现按正常价收费。`
            : `The early bird ended on ${lastDay}; regular prices apply.`}
      </p>

      {/* Packages first while they are on sale: they are the best price. */}
      {PACKAGE_OFFERS.map((offer) => {
        const onSale = sale.offers.some((o) => o.key === offer.key);
        return (
          <Card key={offer.key} className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
                <Package className="size-5 text-accent" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>
                  {zh ? "课时包" : "Lesson package"} · {resortName(offer.resortSlug)}
                </CardTitle>
                <p className="mt-1 text-sm text-ink-2" data-numeric>
                  <strong className="font-display text-2xl text-ink">
                    {formatMoneyShort(offer.priceCents)}
                  </strong>{" "}
                  / {offer.hours} {zh ? "小时" : "hours"} ·{" "}
                  {lessonTypeLabel(offer.lessonType, loc)} ·{" "}
                  {zh ? "每位教练各自出售" : "from either coach"}
                </p>
              </div>
              {onSale && <EarlyBirdTag label={zh ? "早鸟专享" : "Early bird only"} />}
            </div>
            <CardDescription>
              {zh
                ? `先买 ${offer.hours} 小时,之后在${resortName(offer.resortSlug)}约${lessonTypeLabel(offer.lessonType, "zh")}时直接抵扣,可拆开用(例如 2 小时 + 2 小时)。买哪位教练的,就只能约这位教练。`
                : `Buy ${offer.hours} hours up front and spend them on ${lessonTypeLabel(offer.lessonType, "en").toLowerCase()}s at ${resortName(offer.resortSlug)} — split them up, say 2 + 2 hours. A package is bought from one coach and books only with them.`}
            </CardDescription>
            {onSale ? (
              <Button asChild className="self-start">
                <Link href="/packages">
                  {zh ? "购买课时包" : "Buy a package"}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <p className="text-sm font-semibold text-ink-3">
                {zh ? "本季已停售。" : "No longer on sale this season."}
              </p>
            )}
          </Card>
        );
      })}

      <div className="grid gap-4 sm:grid-cols-2">
        {coaches.map((coach) => (
          <Card key={coach.id} className="space-y-3">
            <CardTitle>{coach.displayName}</CardTitle>
            <table className="w-full text-sm" data-numeric>
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="pb-1.5 font-semibold">
                    <span className="sr-only">{zh ? "课程" : "Lesson"}</span>
                  </th>
                  <th
                    className={cn(
                      "pb-1.5 text-right font-semibold",
                      early.active && "text-[var(--amber)]",
                    )}
                  >
                    {zh ? "早鸟价" : "Early bird"}
                  </th>
                  <th
                    className={cn(
                      "pb-1.5 text-right font-semibold",
                      !early.active && "text-accent",
                    )}
                  >
                    {zh ? "正常价" : "Regular"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {offeredRates(coach.rates).map((r) => (
                  <tr key={r.lessonType}>
                    <th scope="row" className="py-2 pr-2 text-left font-semibold text-ink">
                      {lessonTypeLabel(r.lessonType, loc)}
                    </th>
                    <td
                      className={cn(
                        "py-2 text-right tabular-nums",
                        early.active ? "font-bold text-ink" : "text-ink-3",
                      )}
                    >
                      {r.earlyBirdCents != null
                        ? `${formatMoneyShort(r.earlyBirdCents)}${zh ? "/小时" : "/h"}`
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right tabular-nums",
                        early.active ? "text-ink-3" : "font-bold text-ink",
                      )}
                    >
                      {formatMoneyShort(r.regularCents)}
                      {zh ? "/小时" : "/h"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs leading-relaxed text-ink-3" data-numeric>
              {zh
                ? `${coach.minHours} 小时起约 · 多人课每加一人每小时 +${formatMoneyShort(coach.extraPersonCents)}`
                : `${coach.minHours}h minimum · +${formatMoneyShort(coach.extraPersonCents)}/h per extra student`}
            </p>
          </Card>
        ))}
      </div>

      <Card className="space-y-2">
        <CardTitle>{zh ? "说明" : "Good to know"}</CardTitle>
        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-ink-2">
          {(zh
            ? [
                "以上均为一对一价格。多人课(1 对 2 及以上)每多一人每小时加价,见各教练说明;多人课请先微信联系教练。",
                `早鸟价于 ${lastDay} 截止,以下单日期为准。`,
                "付款方式:Interac e-Transfer、微信。",
                "以上均为最终价,不另加税。",
                "预约按整点计,开课时间是整点后 10 分钟、到整点结束;开头这 10 分钟的课时费会从每单中减去(按该课小时价计算,例如 $60/小时减 $10)。",
              ]
            : [
                "All prices are one-on-one. Each extra student in a group lesson adds a per-hour amount, shown for each coach; message your coach on WeChat to arrange a group.",
                `Early-bird prices end on ${lastDay}, going by the day you book.`,
                "Pay by Interac e-Transfer or WeChat.",
                "All prices are final: no tax is added.",
                "Bookings are on the hour; the lesson starts ten minutes past and runs to the hour, and those ten minutes' fee is taken off every booking at its hourly rate ($10 at $60/h).",
              ]
          ).map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <Button asChild variant="secondary" className="mt-2 self-start">
          <Link href="/book">
            {zh ? "去预约" : "Book a lesson"}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </Card>
    </div>
  );
}
