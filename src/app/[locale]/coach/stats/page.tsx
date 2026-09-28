import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/coach/stat-tile";
import { MonthlyHoursChart } from "@/components/coach/monthly-hours-chart";
import { seasonStats, type Breakdown } from "@/lib/stats";
import { loadCoaches, loadStatBookings, loadStatPackages } from "@/lib/stats-store";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { formatMoneyShort } from "@/lib/pricing";
import {
  bookingHorizon,
  formatSeason,
  parseSeasonStartYear,
  seasonOf,
  seasonRange,
  type Season,
} from "@/lib/season";
import { addDaysToDateKey, toDateKey, torontoWallTimeToUtc } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** Chart colours stop at eight; any further coaches share an "Other" slot. */
const MAX_SERIES = 8;

/**
 * A season's numbers for the whole coaching team: lessons, hours, money in
 * and still owed, packages, and how that splits by coach, lesson type, resort
 * and month. Every coach sees the same page.
 */
export default async function CoachStatsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/coach/stats">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireCoachPage({ locale });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  const seasons = await availableSeasons(now);
  const { season: asked } = await searchParams;
  const season =
    typeof asked === "string" && seasons.includes(asked) ? asked : seasons[0];

  const range = seasonRange(season);
  const [bookings, packages, coaches, resorts] = await Promise.all([
    loadStatBookings({
      startAt: {
        gte: torontoWallTimeToUtc(range.start, 0),
        lt: torontoWallTimeToUtc(addDaysToDateKey(range.end, 1), 0),
      },
    }),
    loadStatPackages({ season }),
    loadCoaches(),
    prisma.resort.findMany({ select: { id: true, nameEn: true, nameZh: true } }),
  ]);

  const stats = seasonStats({
    season,
    bookings,
    packages,
    coachIds: coaches.map((c) => c.userId),
    now,
  });
  const coachName = new Map(coaches.map((c) => [c.userId, c.displayName]));
  const resortName = new Map(
    resorts.map((r) => [r.id, zh ? r.nameZh : r.nameEn]),
  );
  const h = zh ? "小时" : "h";

  // Chart series in the fixed coach order; a ninth coach onward folds into
  // "Other" rather than taking a generated colour.
  const chartSeries =
    coaches.length <= MAX_SERIES
      ? coaches.map((c) => ({ id: c.userId, name: c.displayName }))
      : [
          ...coaches
            .slice(0, MAX_SERIES - 1)
            .map((c) => ({ id: c.userId, name: c.displayName })),
          { id: "other", name: zh ? "其他" : "Other" },
        ];
  const monthLabel = (month: string) => {
    const m = Number(month.slice(5));
    return zh ? `${m} 月` : new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" });
  };
  const chartMonths = stats.months.map((m) => {
    const values = chartSeries.map((s, i) =>
      s.id === "other"
        ? coaches
            .slice(i)
            .reduce((sum, c) => sum + (m.hoursByCoach[c.userId] ?? 0), 0)
        : (m.hoursByCoach[s.id] ?? 0),
    );
    return { month: m.month, label: monthLabel(m.month), values };
  });

  const priceMixTotal = stats.earlyBirdHours + stats.regularHours + stats.packageHours;
  const share = (n: number) =>
    priceMixTotal === 0 ? "—" : `${Math.round((n / priceMixTotal) * 100)}%`;

  return (
    <div className="stagger space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label={zh ? "雪季" : "Season"}>
        {seasons.map((s) => (
          <Link
            key={s}
            href={`/coach/stats?season=${s}`}
            aria-current={s === season ? "page" : undefined}
            className={cn(
              "press rounded-xl border px-3.5 py-2 text-sm font-semibold",
              s === season
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-ink-2 hover:border-accent",
            )}
          >
            {formatSeason(s, loc)}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label={zh ? "已收款" : "Received"}
          value={formatMoneyShort(stats.receivedCents)}
          sub={
            zh
              ? `其中课时包 ${formatMoneyShort(stats.packageReceivedCents)}`
              : `${formatMoneyShort(stats.packageReceivedCents)} from packages`
          }
        />
        <StatTile
          label={zh ? "未结清" : "Outstanding"}
          value={formatMoneyShort(stats.owedCents)}
          sub={
            zh
              ? `其中 ${formatMoneyShort(stats.awaitingReviewCents)} 待确认收款`
              : `${formatMoneyShort(stats.awaitingReviewCents)} waiting to be checked`
          }
        />
        <StatTile
          label={zh ? "已上课时" : "Hours taught"}
          value={`${stats.hoursTaught} ${h}`}
          sub={
            zh
              ? `另有 ${stats.hoursScheduled} 小时已排课`
              : `${stats.hoursScheduled}h more booked`
          }
        />
        <StatTile
          label={zh ? "课程" : "Lessons"}
          value={String(stats.lessonCount)}
          sub={zh ? `学员 ${stats.studentCount} 人` : `${stats.studentCount} students`}
        />
        <StatTile
          label={zh ? "课时包售出" : "Packages sold"}
          value={String(stats.packagesSold)}
          sub={formatMoneyShort(stats.packageReceivedCents)}
        />
        <StatTile
          label={zh ? "课时包未用" : "Package hours unused"}
          value={`${stats.packageHoursLeft} ${h}`}
          sub={
            zh
              ? `折合 ${formatMoneyShort(stats.packageValueLeftCents)}`
              : `Worth ${formatMoneyShort(stats.packageValueLeftCents)}`
          }
        />
      </div>

      <Card>
        <MonthlyHoursChart
          series={chartSeries}
          months={chartMonths}
          labels={{
            title: zh ? "每月课时(按教练)" : "Lesson hours by month",
            hours: zh ? "小时" : "hours",
            total: zh ? "合计" : "Total",
            empty: zh ? "这个雪季还没有确认的课。" : "No confirmed lessons this season yet.",
            table: zh ? "查看数据表" : "Show as a table",
            month: zh ? "月份" : "Month",
          }}
        />
      </Card>

      <Card className="space-y-3">
        <CardTitle>{zh ? "按教练" : "By coach"}</CardTitle>
        {/* Seven columns do not fit a phone; there each coach is a card. */}
        <div className="space-y-3 sm:hidden">
          {stats.byCoach.map((line) => (
            <div key={line.coachId} className="rounded-xl border border-border p-3">
              <p className="font-bold text-ink">{coachName.get(line.coachId) ?? "—"}</p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    [zh ? "课程" : "Lessons", String(line.lessonCount)],
                    [
                      zh ? "课时" : "Hours",
                      zh
                        ? `${line.hours}(课时包 ${line.packageHours})`
                        : `${line.hours} (${line.packageHours} package)`,
                    ],
                    [zh ? "课费收款" : "Lesson income", formatMoneyShort(line.lessonReceivedCents)],
                    [zh ? "课时包收款" : "Package income", formatMoneyShort(line.packageReceivedCents)],
                    [zh ? "未结清" : "Outstanding", formatMoneyShort(line.owedCents)],
                  ] as const
                ).map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-2">
                    <dt className="text-ink-3">{term}</dt>
                    <dd className="tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-3">
                <th className="py-2 pr-3 font-semibold">{zh ? "教练" : "Coach"}</th>
                <Num head>{zh ? "课程" : "Lessons"}</Num>
                <Num head>{zh ? "课时" : "Hours"}</Num>
                <Num head>{zh ? "其中课时包" : "From packages"}</Num>
                <Num head>{zh ? "课费收款" : "Lesson income"}</Num>
                <Num head>{zh ? "课时包收款" : "Package income"}</Num>
                <Num head>{zh ? "未结清" : "Outstanding"}</Num>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.byCoach.map((line) => (
                <tr key={line.coachId}>
                  <th scope="row" className="py-2 pr-3 font-semibold text-ink">
                    {coachName.get(line.coachId) ?? "—"}
                  </th>
                  <Num>{line.lessonCount}</Num>
                  <Num>{line.hours}</Num>
                  <Num>{line.packageHours}</Num>
                  <Num>{formatMoneyShort(line.lessonReceivedCents)}</Num>
                  <Num>{formatMoneyShort(line.packageReceivedCents)}</Num>
                  <Num>{formatMoneyShort(line.owedCents)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-3">
          {zh ? "教练之间的课时包结算见" : "For settling package hours between coaches, see "}
          <Link href="/coach/packages" className="font-semibold text-accent underline underline-offset-2">
            {zh ? "课时包" : "Packages"}
          </Link>
          {zh ? "。" : "."}
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <BreakdownCard
          title={zh ? "按课程类型" : "By lesson type"}
          keyHead={zh ? "课程" : "Lesson"}
          rows={stats.byLessonType}
          label={(key) => lessonTypeLabel(key, loc)}
          zh={zh}
        />
        <BreakdownCard
          title={zh ? "按雪场" : "By resort"}
          keyHead={zh ? "雪场" : "Resort"}
          rows={stats.byResort}
          label={(key) => resortName.get(key) ?? key}
          zh={zh}
        />
      </div>

      <Card className="space-y-3">
        <CardTitle>{zh ? "按价格" : "By price"}</CardTitle>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="py-2 pr-3 font-semibold">{zh ? "价格" : "Price"}</th>
              <Num head>{zh ? "课时" : "Hours"}</Num>
              <Num head>{zh ? "占比" : "Share"}</Num>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              [zh ? "早鸟价" : "Early bird", stats.earlyBirdHours],
              [zh ? "正常价" : "Regular", stats.regularHours],
              [zh ? "课时包" : "Package", stats.packageHours],
            ].map(([name, hours]) => (
              <tr key={name}>
                <th scope="row" className="py-2 pr-3 font-semibold text-ink">
                  {name}
                </th>
                <Num>{hours}</Num>
                <Num>{share(Number(hours))}</Num>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <details className="rounded-2xl border border-border bg-surface p-4 text-xs leading-relaxed text-ink-2">
        <summary className="cursor-pointer font-semibold">
          {zh ? "口径说明" : "How these are counted"}
        </summary>
        <ul className="mt-2 list-inside list-disc space-y-1">
          {(zh
            ? [
                "课程:已确认的课(不含锁定中、待付款和已取消的订单),按上课日期归入雪季。",
                "已收款:教练已确认收到的课费,加上已生效课时包的价格。已取消订单的收款不计入,因为退款在线下处理、这里没有记录。",
                "未结清:仍占着时段的订单还没付的部分(含课后尾款),加上未付款的课时包订单。",
                "课时包按购买时的雪季统计;未用课时按课时包单价折算。",
              ]
            : [
                "Lessons: confirmed bookings only (not holds, unpaid or cancelled ones), placed in a season by lesson date.",
                "Received: lesson payments a coach has confirmed, plus paid-up packages. Payments on cancelled bookings are left out, since refunds happen outside the site and are not recorded.",
                "Outstanding: the unpaid part of every booking still holding its slot (including balances after a lesson), plus unpaid package orders.",
                "Packages count towards the season they were sold for; unused hours are valued at the package's price per hour.",
              ]
          ).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Seasons with any data, newest first, always including the one on sale now. */
async function availableSeasons(now: Date): Promise<Season[]> {
  const current = bookingHorizon(toDateKey(now)).season;
  const [span, packageSeasons] = await Promise.all([
    prisma.booking.aggregate({ _min: { startAt: true }, _max: { startAt: true } }),
    prisma.lessonPackage.findMany({ select: { season: true }, distinct: ["season"] }),
  ]);
  const years = new Set<number>([parseSeasonStartYear(current)]);
  for (const instant of [span._min.startAt, span._max.startAt]) {
    const s = instant ? seasonOf(instant) : null;
    if (s) years.add(parseSeasonStartYear(s));
  }
  for (const p of packageSeasons) years.add(parseSeasonStartYear(p.season));
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const out: Season[] = [];
  for (let y = hi; y >= lo; y--) {
    out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  }
  return out;
}

function BreakdownCard({
  title,
  keyHead,
  rows,
  label,
  zh,
}: {
  title: string;
  keyHead: string;
  rows: Breakdown[];
  label: (key: string) => string;
  zh: boolean;
}) {
  return (
    <Card className="space-y-3">
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">{zh ? "暂无数据。" : "Nothing yet."}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="py-2 pr-3 font-semibold">{keyHead}</th>
              <Num head>{zh ? "课程" : "Lessons"}</Num>
              <Num head>{zh ? "课时" : "Hours"}</Num>
              <Num head>{zh ? "课费收款" : "Income"}</Num>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="py-2 pr-3 font-semibold text-ink">
                  {label(row.key)}
                </th>
                <Num>{row.lessonCount}</Num>
                <Num>{row.hours}</Num>
                <Num>{formatMoneyShort(row.receivedCents)}</Num>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** A right-aligned, tabular-figure cell, so columns of numbers line up. */
function Num({ children, head }: { children: React.ReactNode; head?: boolean }) {
  return head ? (
    <th className="py-2 pl-3 text-right font-semibold">{children}</th>
  ) : (
    <td className="py-2 pl-3 text-right tabular-nums text-ink">{children}</td>
  );
}
