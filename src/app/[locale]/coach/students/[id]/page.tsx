import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/coach/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { PackageStatusPill } from "@/components/packages/package-status-pill";
import { studentBalances } from "@/lib/stats";
import { loadCoaches, loadStatBookings } from "@/lib/stats-store";
import { hoursUsed, offerLabel, packageTotalHours } from "@/lib/packages";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { formatSeason } from "@/lib/season";
import { toLocale } from "@/i18n/routing";

/**
 * One student's account from the coaches' side: package hours left, money
 * still owed, and every lesson with either coach, each linking to its booking.
 */
export default async function CoachStudentPage({
  params,
}: PageProps<"/[locale]/coach/students/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireCoachPage({ locale });

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, wechatId: true, phone: true },
  });
  if (!user) notFound();

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  const [bookings, packages, coaches, participants] = await Promise.all([
    loadStatBookings({ accountId: id }),
    prisma.lessonPackage.findMany({
      where: { accountId: id },
      include: {
        bookings: {
          select: { coachId: true, hours: true, status: true, holdExpiresAt: true },
        },
        adjustments: { select: { hours: true } },
        payeeCoach: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    loadCoaches(),
    prisma.participant.findMany({
      where: { accountId: id, archivedAt: null },
      orderBy: [{ isSelf: "desc" }, { fullName: "asc" }],
      select: { id: true, fullName: true, isMinor: true, isSelf: true },
    }),
  ]);
  if (bookings.length === 0 && packages.length === 0) notFound();

  const [balance] = studentBalances(bookings, packages, now);
  const coachName = new Map(coaches.map((c) => [c.userId, c.displayName]));
  const newestFirst = [...bookings].sort(
    (a, b) => b.startAt.getTime() - a.startAt.getTime(),
  );

  return (
    <div className="stagger space-y-5">
      <div>
        <Link
          href="/coach/students"
          className="text-sm font-semibold text-accent underline underline-offset-2"
        >
          {zh ? "← 全部学员" : "← All students"}
        </Link>
        <h2 className="mt-2 text-2xl">{user.name ?? user.email}</h2>
        <p className="text-sm text-ink-2">
          {[user.email, user.wechatId && `WeChat ${user.wechatId}`, user.phone]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label={zh ? "剩余课时" : "Package hours left"}
          value={`${balance.packageHoursLeft} ${zh ? "小时" : "h"}`}
        />
        <StatTile
          label={zh ? "课时包余额" : "Package balance"}
          value={formatMoneyShort(balance.packageValueLeftCents)}
        />
        <StatTile
          label={zh ? "未结清" : "Outstanding"}
          value={formatMoneyShort(balance.owedCents)}
        />
        <StatTile
          label={zh ? "已付" : "Paid"}
          value={formatMoneyShort(balance.paidCents)}
          sub={
            zh
              ? `上课 ${balance.lessonCount} 次 · 已上 ${balance.hoursTaken} 小时`
              : `${balance.lessonCount} lessons · ${balance.hoursTaken}h taken`
          }
        />
      </div>

      {packages.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>{zh ? "课时包" : "Lesson packages"}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {packages.map((p) => {
              const total = packageTotalHours(p);
              const left =
                p.status === "ACTIVE" ? Math.max(0, total - hoursUsed(p.bookings, now)) : 0;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="space-y-0.5">
                    <Link
                      href={`/packages/${p.code}`}
                      className="font-semibold text-accent underline underline-offset-2"
                    >
                      {offerLabel(p.offerKey, loc)}
                    </Link>
                    <span className="block text-xs text-ink-3" data-numeric>
                      {p.code} · {formatSeason(p.season, loc)} ·{" "}
                      {zh ? "付给" : "paid to"} {p.payeeCoach.name ?? p.payeeCoach.email} ·{" "}
                      {formatMoneyShort(p.priceCents)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2" data-numeric>
                    {p.status === "ACTIVE" && (
                      <strong className="text-ink">
                        {zh ? `剩余 ${left} / ${total} 小时` : `${left} of ${total}h left`}
                      </strong>
                    )}
                    <PackageStatusPill status={p.status} locale={loc} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {participants.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>{zh ? "上课学员" : "Participants"}</CardTitle>
          <p className="text-sm text-ink-2">
            {participants
              .map(
                (p) =>
                  `${p.fullName}${p.isSelf ? (zh ? "(本人)" : " (account holder)") : ""}${p.isMinor ? (zh ? " · 未成年" : " · under 18") : ""}`,
              )
              .join(zh ? "、" : "; ")}
          </p>
        </Card>
      )}

      <Card className="space-y-2">
        <CardTitle>{zh ? "全部课程" : "All lessons"}</CardTitle>
        {newestFirst.length === 0 ? (
          <p className="text-sm text-ink-2">{zh ? "还没有预约。" : "No bookings yet."}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {newestFirst.map((b) => {
              const owing = Math.max(0, b.totalCents - b.amountPaidCents);
              return (
                <li key={b.code} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {formatTorontoDate(b.startAt, loc)} {formatTorontoTime(b.startAt, loc)}
                    </span>
                    <StatusPill status={b.status} locale={loc} />
                  </div>
                  <p className="text-xs text-ink-2" data-numeric>
                    {coachName.get(b.coachId) ?? "—"} · {lessonTypeLabel(b.lessonType, loc)} ·{" "}
                    {b.hours} {zh ? "小时" : "h"}
                    {b.participantName ? ` · ${b.participantName}` : ""} ·{" "}
                    {b.paymentPlan === "PACKAGE"
                      ? zh
                        ? "课时包"
                        : "package"
                      : `${formatMoneyShort(b.totalCents)}${
                          owing > 0 && b.status !== "CANCELLED" && b.status !== "EXPIRED"
                            ? zh
                              ? `(未付 ${formatMoneyShort(owing)})`
                              : ` (${formatMoneyShort(owing)} unpaid)`
                            : ""
                        }`}
                  </p>
                  <Link
                    href={`/booking/${b.code}`}
                    className="font-mono text-xs font-bold text-accent underline underline-offset-2"
                  >
                    {b.code}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
