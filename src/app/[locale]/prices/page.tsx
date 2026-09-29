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
import { toLocale, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ArrowRight, Clock, Mountain, Package } from "lucide-react";

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
  // Resorts with a package first (Blue Mountain), as on the price sheet.
  const hasPackage = (slug: string) =>
    PACKAGE_OFFERS.some((o) => o.resortSlug === slug);
  const orderedResorts = [...resorts].sort(
    (a, b) =>
      Number(hasPackage(b.slug)) - Number(hasPackage(a.slug)) ||
      a.nameEn.localeCompare(b.nameEn),
  );
  // The coaches set the group surcharge themselves; it is $20 on the sheet.
  const extras = [...new Set(coaches.map((c) => c.extraPersonCents))];
  const extra =
    extras.length === 1
      ? formatMoneyShort(extras[0])
      : extras.map((c) => formatMoneyShort(c)).join(" / ");

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

      {/* One section per resort, as on the printed price sheet. Rates are the
          coach's own and the same everywhere; a resort's package, if it has
          one, heads its section. */}
      {orderedResorts.map((resort) => (
        <section key={resort.id} className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl">
            <Mountain className="size-5 text-accent" aria-hidden />
            {zh ? resort.nameZh : resort.nameEn}
            {zh && (
              <span className="text-sm font-semibold text-ink-3">{resort.nameEn}</span>
            )}
          </h2>

          {PACKAGE_OFFERS.filter((o) => o.resortSlug === resort.slug).map((offer) => {
            const onSale = sale.offers.some((o) => o.key === offer.key);
            return (
              <Card key={offer.key} className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
                    <Package className="size-5 text-accent" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle>{zh ? "课时包" : "Lesson package"}</CardTitle>
                    <p className="mt-1 text-sm text-ink-2" data-numeric>
                      <strong className="font-display text-2xl text-ink">
                        {formatMoneyShort(offer.priceCents)}
                      </strong>{" "}
                      / {offer.hours} {zh ? "小时" : "hours"} ·{" "}
                      {lessonTypeLabel(offer.lessonType, loc)} ·{" "}
                      {zh ? "可选任意教练" : "any coach"}
                    </p>
                  </div>
                  {onSale && <EarlyBirdTag label={zh ? "早鸟期限定" : "Early bird only"} />}
                </div>
                <CardDescription>
                  {zh
                    ? `先买 ${offer.hours} 小时,之后在${resortName(offer.resortSlug)}约${lessonTypeLabel(offer.lessonType, "zh")}时直接抵扣,可拆开用(例如 2 小时 + 2 小时),两位教练都能约。`
                    : `Buy ${offer.hours} hours up front and spend them on ${lessonTypeLabel(offer.lessonType, "en").toLowerCase()}s at ${resortName(offer.resortSlug)} — split them up, say 2 + 2 hours, with either coach.`}
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
              <RateCard key={coach.id} coach={coach} zh={zh} loc={loc} earlyActive={early.active} />
            ))}
          </div>
        </section>
      ))}

      {/* The ten minutes are about when the lesson runs, so they are
          explained here rather than next to the prices. */}
      <Card className="space-y-2">
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-accent" aria-hidden />
          {zh ? "上课时间" : "Lesson times"}
        </CardTitle>
        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-ink-2">
          {(zh
            ? [
                "至少 2 小时,按整小时约。2 小时是平衡体力和练习肌肉记忆的黄金时长。",
                "开课时间是整点后 10 分钟:例如约了 10:00–12:00,实际上课 10:10–12:00。前 10 分钟是和上一位学员的交接时间。",
                "这 10 分钟不收费,每单直接减!",
              ]
            : [
                "Two hours minimum, booked in whole hours. Two hours is the sweet spot for stamina and muscle memory.",
                "Lessons start ten minutes past the hour: book 10:00–12:00 and the lesson runs 10:10–12:00. The first ten minutes are the handover from the previous student.",
                "Those ten minutes are free: their fee comes straight off every booking.",
              ]
          ).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-2">
        <CardTitle>{zh ? "说明" : "Good to know"}</CardTitle>
        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-ink-2">
          {(zh
            ? [
                "以上均为每小时、一对一价格,2 小时起。",
                `1 对 2 / 1 对 3:每多一位学员每小时 +${extra},请先微信联系教练。`,
                `早鸟价于 ${lastDay} 截止,以下单日期为准。`,
                "付款方式:Interac e-Transfer、微信。",
                "以上均为最终价,不另加税。",
              ]
            : [
                "All prices are per hour, one-on-one, two hours minimum.",
                `1-on-2 / 1-on-3: +${extra} per hour for each extra student; message your coach on WeChat first.`,
                `Early-bird prices end on ${lastDay}, going by the day you book.`,
                "Pay by Interac e-Transfer or WeChat.",
                "All prices are final: no tax is added.",
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

type RateCoach = Awaited<ReturnType<typeof listBookableCoaches>>[number];

/** One coach's rate card: early-bird and regular price per lesson type. */
function RateCard({
  coach,
  zh,
  loc,
  earlyActive,
}: {
  coach: RateCoach;
  zh: boolean;
  loc: Locale;
  earlyActive: boolean;
}) {
  return (
    <Card className="space-y-3">
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
                earlyActive && "text-[var(--amber)]",
              )}
            >
              {zh ? "早鸟价" : "Early bird"}
            </th>
            <th
              className={cn(
                "pb-1.5 text-right font-semibold",
                !earlyActive && "text-accent",
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
                  earlyActive ? "font-bold text-ink" : "text-ink-3",
                )}
              >
                {r.earlyBirdCents != null
                  ? `${formatMoneyShort(r.earlyBirdCents)}${zh ? "/小时" : "/h"}`
                  : "—"}
              </td>
              <td
                className={cn(
                  "py-2 text-right tabular-nums",
                  earlyActive ? "text-ink-3" : "font-bold text-ink",
                )}
              >
                {formatMoneyShort(r.regularCents)}
                {zh ? "/小时" : "/h"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
