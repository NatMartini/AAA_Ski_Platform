import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { PackageStatusPill } from "@/components/packages/package-status-pill";
import { hoursUsed, offerLabel, settlementFor } from "@/lib/packages";
import { packageInclude } from "@/lib/package-store";
import { isSelfServeHoldExpired } from "@/lib/booking/hold";
import { formatMoneyShort } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";

/**
 * Packages from the coach's side: payments waiting on them, packages they
 * were paid for, and who owes whom when one coach teaches hours another coach
 * was paid for.
 */
export default async function CoachPackagesPage({
  params,
}: PageProps<"/[locale]/coach/packages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCoachPage({ locale });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const now = new Date();

  // Paid to me, or taught by me from someone else's package.
  const packages = await prisma.lessonPackage.findMany({
    where: {
      OR: [
        { payeeCoachId: user.id },
        { bookings: { some: { coachId: user.id } } },
      ],
    },
    include: packageInclude,
    orderBy: { createdAt: "desc" },
  });

  const paidToMe = packages.filter((p) => p.payeeCoachId === user.id);
  const waiting = paidToMe.filter((p) => p.status === "PENDING_PAYMENT_REVIEW");

  const settlement = settlementFor(
    user.id,
    packages.map((p) => ({
      payeeCoachId: p.payeeCoachId,
      priceCents: p.priceCents,
      hours: p.hours,
      uses: p.bookings
        .filter((b) => !isSelfServeHoldExpired(b, now))
        .map((b) => ({ coachId: b.coachId, hours: b.hours })),
    })),
  );
  const names = new Map(
    (
      await prisma.coachProfile.findMany({
        where: { userId: { in: settlement.map((l) => l.otherCoachId) } },
        select: { userId: true, displayName: true },
      })
    ).map((c) => [c.userId, c.displayName]),
  );

  return (
    <div className="stagger space-y-6">
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {zh ? "待确认收款" : "Payments to check"}
        </h2>
        {waiting.length === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "没有待确认的课时包付款。" : "No package payments waiting on you."}
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {waiting.map((p) => (
              <PackageRow key={p.id} pkg={p} locale={loc} now={now} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {zh ? "教练间结算" : "Settling up between coaches"}
        </h2>
        <Card className="space-y-3">
          <CardDescription>
            {zh
              ? "课时包的钱付给了一位教练,课却可能由另一位教练上。以下按已预约和已上的课时、按课时包单价折算。"
              : "A package is paid to one coach but its hours may be taught by another. This counts hours booked or taught, at the package's price per hour."}
          </CardDescription>
          {settlement.length === 0 ? (
            <p className="text-sm text-ink-2">
              {zh ? "目前两清,无需结算。" : "Nothing to settle."}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-numeric>
              {settlement.map((line) => {
                const name = names.get(line.otherCoachId) ?? "—";
                return (
                  <li key={line.otherCoachId} className="space-y-1 py-2.5">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <strong className="text-ink">{name}</strong>
                      <strong
                        style={{
                          color:
                            line.netCents >= 0 ? "var(--success)" : "var(--amber)",
                        }}
                      >
                        {line.netCents === 0
                          ? zh
                            ? "两清"
                            : "Even"
                          : line.netCents > 0
                            ? zh
                              ? `${name} 应付你 ${formatMoneyShort(line.netCents)}`
                              : `${name} owes you ${formatMoneyShort(line.netCents)}`
                            : zh
                              ? `你应付 ${name} ${formatMoneyShort(-line.netCents)}`
                              : `You owe ${name} ${formatMoneyShort(-line.netCents)}`}
                      </strong>
                    </p>
                    <p className="text-xs text-ink-3">
                      {zh
                        ? `${name} 上了你收款的课时包 ${line.theyTaughtHours} 小时(${formatMoneyShort(line.iOweCents)});你上了 ${name} 收款的课时包 ${line.iTaughtHours} 小时(${formatMoneyShort(line.owedToMeCents)})`
                        : `${name} taught ${line.theyTaughtHours}h from packages paid to you (${formatMoneyShort(line.iOweCents)}); you taught ${line.iTaughtHours}h from packages paid to ${name} (${formatMoneyShort(line.owedToMeCents)})`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {zh ? "付给我的课时包" : "Packages paid to you"}
        </h2>
        {paidToMe.length === 0 ? (
          <Card>
            <CardDescription>{zh ? "还没有。" : "None yet."}</CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {paidToMe.map((p) => (
              <PackageRow key={p.id} pkg={p} locale={loc} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PackageRow({
  pkg,
  locale,
  now,
}: {
  pkg: {
    code: string;
    offerKey: string;
    status: Parameters<typeof PackageStatusPill>[0]["status"];
    hours: number;
    priceCents: number;
    account: { name: string | null; email: string };
    bookings: Parameters<typeof hoursUsed>[0];
  };
  locale: "zh" | "en";
  now: Date;
}) {
  const zh = locale === "zh";
  const left = pkg.hours - hoursUsed(pkg.bookings, now);
  return (
    <Link
      href={`/packages/${pkg.code}`}
      className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-accent/40"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{pkg.account.name ?? pkg.account.email}</span>
          <PackageStatusPill status={pkg.status} locale={locale} />
        </div>
        <p className="text-sm text-ink-2" data-numeric>
          {offerLabel(pkg.offerKey, locale)} ·{" "}
          {zh ? `剩余 ${left} / ${pkg.hours} 小时` : `${left} of ${pkg.hours}h left`}
        </p>
        <p className="font-mono text-xs text-ink-3">
          {pkg.code} · {formatMoneyShort(pkg.priceCents)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
