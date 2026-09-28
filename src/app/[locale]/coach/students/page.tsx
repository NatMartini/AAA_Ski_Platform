import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { StatTile } from "@/components/coach/stat-tile";
import { studentBalances, type StudentBalance } from "@/lib/stats";
import { loadCoaches, loadStatBookings, loadStatPackages } from "@/lib/stats-store";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

const FILTERS = ["all", "hours", "owed"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Every student, for every coach: package hours left, what they still owe and
 * what they have paid. Any coach may teach from any package, so each needs the
 * whole picture rather than only their own bookings.
 */
export default async function CoachStudentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/coach/students">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireCoachPage({ locale });

  const { show } = await searchParams;
  const filter: Filter = FILTERS.includes(show as Filter) ? (show as Filter) : "all";
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  const [bookings, packages, coaches] = await Promise.all([
    loadStatBookings({ accountId: { not: null } }),
    loadStatPackages(),
    loadCoaches(),
  ]);
  const balances = studentBalances(bookings, packages, now);
  const users = await prisma.user.findMany({
    where: { id: { in: balances.map((b) => b.accountId) } },
    select: { id: true, name: true, email: true, wechatId: true },
  });
  const userBy = new Map(users.map((u) => [u.id, u]));
  const coachName = new Map(coaches.map((c) => [c.userId, c.displayName]));

  const shown = balances
    .filter((b) =>
      filter === "hours"
        ? b.packageHoursLeft > 0
        : filter === "owed"
          ? b.owedCents > 0
          : true,
    )
    .sort(
      (a, b) =>
        b.packageHoursLeft - a.packageHoursLeft ||
        b.owedCents - a.owedCents ||
        (b.lastLessonAt?.getTime() ?? 0) - (a.lastLessonAt?.getTime() ?? 0),
    );

  const sum = (pick: (b: StudentBalance) => number) =>
    balances.reduce((total, b) => total + pick(b), 0);

  return (
    <div className="stagger space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={zh ? "学员" : "Students"} value={String(balances.length)} />
        <StatTile
          label={zh ? "未用课时" : "Package hours left"}
          value={`${sum((b) => b.packageHoursLeft)} ${zh ? "小时" : "h"}`}
        />
        <StatTile
          label={zh ? "课时包余额" : "Package balance"}
          value={formatMoneyShort(sum((b) => b.packageValueLeftCents))}
          sub={zh ? "按课时包单价折算" : "At each package's hourly value"}
        />
        <StatTile
          label={zh ? "未结清" : "Outstanding"}
          value={formatMoneyShort(sum((b) => b.owedCents))}
          sub={zh ? "待付款、尾款与未付课时包" : "Unpaid bookings, balances, packages"}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={zh ? "筛选" : "Filter"}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/coach/students" : `/coach/students?show=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={cn(
              "press rounded-xl border px-3.5 py-2 text-sm font-semibold",
              filter === f
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-ink-2 hover:border-accent",
            )}
          >
            {
              {
                all: zh ? "全部" : "All",
                hours: zh ? "有剩余课时" : "Hours left",
                owed: zh ? "有未结清" : "Money owed",
              }[f]
            }
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardDescription>{zh ? "没有符合的学员。" : "No students match."}</CardDescription>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((b) => {
            const user = userBy.get(b.accountId);
            return (
              <Link
                key={b.accountId}
                href={`/coach/students/${b.accountId}`}
                className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-accent/40"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{user?.name ?? user?.email ?? "—"}</span>
                    <span className="truncate text-xs text-ink-3">
                      {[user?.email, user?.wechatId && `WeChat ${user.wechatId}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {b.participantNames.length > 0 && (
                    <p className="text-xs text-ink-2">
                      {zh ? "学员:" : "Participants: "}
                      {b.participantNames.join(zh ? "、" : ", ")}
                    </p>
                  )}
                  <dl className="flex flex-wrap gap-1.5 text-xs" data-numeric>
                    <Fact
                      term={zh ? "剩余课时" : "Hours left"}
                      value={`${b.packageHoursLeft} ${zh ? "小时" : "h"} · ${formatMoneyShort(b.packageValueLeftCents)}`}
                      strong={b.packageHoursLeft > 0}
                    />
                    <Fact
                      term={zh ? "未结清" : "Owed"}
                      value={formatMoneyShort(b.owedCents)}
                      warn={b.owedCents > 0}
                    />
                    <Fact term={zh ? "已付" : "Paid"} value={formatMoneyShort(b.paidCents)} />
                    <Fact
                      term={zh ? "上课" : "Lessons"}
                      value={
                        zh
                          ? `${b.lessonCount} 次 · 已上 ${b.hoursTaken} 小时 · 待上 ${b.hoursUpcoming} 小时`
                          : `${b.lessonCount} · ${b.hoursTaken}h taken · ${b.hoursUpcoming}h to come`
                      }
                    />
                  </dl>
                  <p className="text-xs text-ink-3">
                    {b.nextLessonAt
                      ? `${zh ? "下次上课" : "Next lesson"} ${formatTorontoDate(b.nextLessonAt, loc)}`
                      : b.lastLessonAt
                        ? `${zh ? "上次上课" : "Last lesson"} ${formatTorontoDate(b.lastLessonAt, loc)}`
                        : zh
                          ? "还没有上过课"
                          : "No lessons yet"}
                    {b.coachIds.length > 0 &&
                      ` · ${b.coachIds.map((id) => coachName.get(id) ?? "—").join(" / ")}`}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({
  term,
  value,
  strong,
  warn,
}: {
  term: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className="inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1"
      style={
        warn
          ? { background: "var(--amber-bg)", borderColor: "var(--amber-border)" }
          : { borderColor: "var(--border)" }
      }
    >
      <dt className="text-ink-3">{term}</dt>
      <dd className={cn("font-semibold", strong || warn ? "text-ink" : "text-ink-2")}>
        {value}
      </dd>
    </div>
  );
}
