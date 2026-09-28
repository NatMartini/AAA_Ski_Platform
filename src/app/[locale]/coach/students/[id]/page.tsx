import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/coach/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { packageHoursLeftByAccount, studentBalances } from "@/lib/stats";
import { loadStatBookings } from "@/lib/stats-store";
import { hoursUsed, offerLabel } from "@/lib/packages";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { formatSeason } from "@/lib/season";
import { toLocale } from "@/i18n/routing";

/**
 * One student from one coach's side: the package hours they have left (any
 * coach sees those), and — only if they are this coach's student — what they
 * owe and have paid this coach and their lessons with this coach.
 */
export default async function CoachStudentPage({
  params,
}: PageProps<"/[locale]/coach/students/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const coach = await requireCoachPage({ locale });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  const [user, myBookings, packages] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, wechatId: true, phone: true },
    }),
    loadStatBookings({ accountId: id, coachId: coach.id }),
    prisma.lessonPackage.findMany({
      where: { accountId: id },
      include: {
        bookings: {
          select: { coachId: true, hours: true, status: true, holdExpiresAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!user) notFound();

  const myPackages = packages.filter((p) => p.payeeCoachId === coach.id);
  const hoursLeft = packageHoursLeftByAccount(packages, now).get(id) ?? 0;
  const isMine = myBookings.length > 0 || myPackages.length > 0;
  // Nothing of theirs is this coach's to see.
  if (!isMine && hoursLeft === 0) notFound();

  const [balance] = isMine ? studentBalances(myBookings, myPackages, now) : [];
  const withHours = packages
    .filter((p) => p.status === "ACTIVE")
    .map((p) => ({ ...p, left: p.hours - hoursUsed(p.bookings, now) }))
    .filter((p) => p.left > 0);
  const newestFirst = [...myBookings].sort(
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
        <h2 className="mt-2 text-2xl">{user.name ?? (zh ? "学员" : "Student")}</h2>
        {isMine && (
          <p className="text-sm text-ink-2">
            {[user.email, user.wechatId && `WeChat ${user.wechatId}`, user.phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      <Card className="space-y-2">
        <CardTitle data-numeric>
          {zh ? `剩余课时 ${hoursLeft} 小时` : `${hoursLeft} package hours left`}
        </CardTitle>
        {withHours.length === 0 ? (
          <CardDescription>{zh ? "没有可用的课时包。" : "No package hours to spend."}</CardDescription>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {withHours.map((p) => {
              const paidToMe = p.payeeCoachId === coach.id;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="space-y-0.5">
                    {/* Only the coach who sold a package can open it. */}
                    {paidToMe ? (
                      <Link
                        href={`/packages/${p.code}`}
                        className="font-semibold text-accent underline underline-offset-2"
                      >
                        {offerLabel(p.offerKey, loc)}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink">{offerLabel(p.offerKey, loc)}</span>
                    )}
                    <span className="block text-xs text-ink-3">
                      {formatSeason(p.season, loc)}
                      {paidToMe ? ` · ${p.code} · ${zh ? "付给我" : "paid to you"}` : ""}
                    </span>
                  </span>
                  <strong className="text-ink" data-numeric>
                    {zh ? `剩余 ${p.left} / ${p.hours} 小时` : `${p.left} of ${p.hours}h left`}
                  </strong>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {!isMine ? (
        <Card>
          <CardDescription>
            {zh
              ? "这位学员没有在你这里上课或付款,其他情况只有对应的教练能看到。"
              : "This student has no lessons or payments with you; the rest is visible only to the coach concerned."}
          </CardDescription>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label={zh ? "欠我" : "Owes me"} value={formatMoneyShort(balance.owedCents)} />
            <StatTile label={zh ? "已付我" : "Paid me"} value={formatMoneyShort(balance.paidCents)} />
            <StatTile
              label={zh ? "跟我上课" : "Lessons with me"}
              value={String(balance.lessonCount)}
              sub={
                zh
                  ? `已上 ${balance.hoursTaken} 小时 · 待上 ${balance.hoursUpcoming} 小时`
                  : `${balance.hoursTaken}h taken · ${balance.hoursUpcoming}h to come`
              }
              className="col-span-2 sm:col-span-1"
            />
          </div>

          {balance.participantNames.length > 0 && (
            <Card className="space-y-2">
              <CardTitle>{zh ? "上课学员" : "Participants"}</CardTitle>
              <p className="text-sm text-ink-2">
                {balance.participantNames.join(zh ? "、" : ", ")}
              </p>
            </Card>
          )}

          <Card className="space-y-2">
            <CardTitle>{zh ? "跟我的课" : "Lessons with me"}</CardTitle>
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
                        {lessonTypeLabel(b.lessonType, loc)} · {b.hours} {zh ? "小时" : "h"}
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
        </>
      )}
    </div>
  );
}
