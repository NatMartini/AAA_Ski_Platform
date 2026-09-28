import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { StatTile } from "@/components/coach/stat-tile";
import {
  packageHoursLeftByAccount,
  studentBalances,
  type StudentBalance,
} from "@/lib/stats";
import { loadStatBookings, loadStatPackages } from "@/lib/stats-store";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

const FILTERS = ["all", "hours", "owed"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Students, from one coach's side.
 *
 * Every coach sees every student's unused package hours, because any coach
 * can be booked with them. Everything else — money, lessons, contact details,
 * who they book for — comes only from this coach's own bookings and the
 * packages paid to this coach, as it does everywhere else in the coach area.
 */
export default async function CoachStudentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/coach/students">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const coach = await requireCoachPage({ locale });

  const { show } = await searchParams;
  const filter: Filter = FILTERS.includes(show as Filter) ? (show as Filter) : "all";
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  const [myBookings, packages] = await Promise.all([
    loadStatBookings({ coachId: coach.id, accountId: { not: null } }),
    loadStatPackages(),
  ]);
  const hoursLeft = packageHoursLeftByAccount(packages, now);
  const mine = new Map(
    studentBalances(
      myBookings,
      packages.filter((p) => p.payeeCoachId === coach.id),
      now,
    ).map((b) => [b.accountId, b]),
  );

  const accountIds = [...new Set([...mine.keys(), ...hoursLeft.keys()])];
  const users = await prisma.user.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true, email: true, wechatId: true },
  });
  const userBy = new Map(users.map((u) => [u.id, u]));

  const rows = accountIds
    .map((accountId) => ({
      accountId,
      hoursLeft: hoursLeft.get(accountId) ?? 0,
      mine: mine.get(accountId) ?? null,
    }))
    .filter((r) =>
      filter === "hours"
        ? r.hoursLeft > 0
        : filter === "owed"
          ? (r.mine?.owedCents ?? 0) > 0
          : true,
    )
    .sort(
      (a, b) =>
        b.hoursLeft - a.hoursLeft ||
        (b.mine?.owedCents ?? 0) - (a.mine?.owedCents ?? 0) ||
        (b.mine?.lastLessonAt?.getTime() ?? 0) - (a.mine?.lastLessonAt?.getTime() ?? 0),
    );

  const sumMine = (pick: (b: StudentBalance) => number) =>
    [...mine.values()].reduce((total, b) => total + pick(b), 0);
  const allHours = [...hoursLeft.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="stagger space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label={zh ? "所有学员未用课时" : "Package hours left, all students"}
          value={`${allHours} ${zh ? "小时" : "h"}`}
          sub={zh ? `${hoursLeft.size} 位学员` : `${hoursLeft.size} students`}
        />
        <StatTile label={zh ? "我的学员" : "My students"} value={String(mine.size)} />
        <StatTile
          label={zh ? "我的未结清" : "Owed to me"}
          value={formatMoneyShort(sumMine((b) => b.owedCents))}
          sub={zh ? "待付款、尾款与未付课时包" : "Unpaid bookings, balances, packages"}
        />
        <StatTile
          label={zh ? "我已收" : "Paid to me"}
          value={formatMoneyShort(sumMine((b) => b.paidCents))}
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
                owed: zh ? "欠我款项" : "Owe me money",
              }[f]
            }
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardDescription>{zh ? "没有符合的学员。" : "No students match."}</CardDescription>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map(({ accountId, hoursLeft: left, mine: b }) => {
            const user = userBy.get(accountId);
            return (
              <Link
                key={accountId}
                href={`/coach/students/${accountId}`}
                className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-accent/40"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{user?.name ?? (zh ? "学员" : "Student")}</span>
                    {/* Contact details only for this coach's own students. */}
                    {b && (
                      <span className="truncate text-xs text-ink-3">
                        {[user?.email, user?.wechatId && `WeChat ${user.wechatId}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                  <dl className="flex flex-wrap gap-1.5 text-xs" data-numeric>
                    <Fact
                      term={zh ? "剩余课时" : "Hours left"}
                      value={`${left} ${zh ? "小时" : "h"}`}
                      strong={left > 0}
                    />
                    {b && (
                      <>
                        <Fact
                          term={zh ? "欠我" : "Owes me"}
                          value={formatMoneyShort(b.owedCents)}
                          warn={b.owedCents > 0}
                        />
                        <Fact
                          term={zh ? "已付我" : "Paid me"}
                          value={formatMoneyShort(b.paidCents)}
                        />
                        <Fact
                          term={zh ? "跟我上课" : "Lessons with me"}
                          value={
                            zh
                              ? `${b.lessonCount} 次 · 已上 ${b.hoursTaken} 小时 · 待上 ${b.hoursUpcoming} 小时`
                              : `${b.lessonCount} · ${b.hoursTaken}h taken · ${b.hoursUpcoming}h to come`
                          }
                        />
                      </>
                    )}
                  </dl>
                  <p className="text-xs text-ink-3">
                    {!b
                      ? zh
                        ? "没有在你这里上课或付款"
                        : "No lessons or payments with you"
                      : b.nextLessonAt
                        ? `${zh ? "下次上课" : "Next lesson"} ${formatTorontoDate(b.nextLessonAt, loc)}`
                        : b.lastLessonAt
                          ? `${zh ? "上次上课" : "Last lesson"} ${formatTorontoDate(b.lastLessonAt, loc)}`
                          : zh
                            ? "还没有跟你上过课"
                            : "No lessons with you yet"}
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
