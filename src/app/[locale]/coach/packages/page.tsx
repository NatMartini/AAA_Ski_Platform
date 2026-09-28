import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { PackageStatusPill } from "@/components/packages/package-status-pill";
import { offerLabel, packageTotalHours } from "@/lib/packages";
import { hoursLeft, packageInclude, type LoadedPackage } from "@/lib/package-store";
import { formatMoneyShort } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";

/**
 * Packages from the coach's side: payments waiting on this coach, the
 * packages sold by this coach, and — since the coaches share their books —
 * the other coaches' too.
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

  const packages = await prisma.lessonPackage.findMany({
    include: packageInclude,
    orderBy: { createdAt: "desc" },
  });

  const mine = packages.filter((p) => p.payeeCoachId === user.id);
  const others = packages.filter((p) => p.payeeCoachId !== user.id);
  const waiting = mine.filter((p) => p.status === "PENDING_PAYMENT_REVIEW");

  const section = (title: string, rows: LoadedPackage[], empty: string) => (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">{title}</h2>
      {rows.length === 0 ? (
        <Card>
          <CardDescription>{empty}</CardDescription>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <PackageRow key={p.id} pkg={p} locale={loc} now={now} showCoach={p.payeeCoachId !== user.id} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="stagger space-y-6">
      {section(
        zh ? "待确认收款" : "Payments to check",
        waiting,
        zh ? "没有待确认的课时包付款。" : "No package payments waiting on you.",
      )}
      {section(
        zh ? "我的课时包" : "Your packages",
        mine,
        zh ? "还没有。" : "None yet.",
      )}
      {others.length > 0 &&
        section(zh ? "其他教练的课时包" : "Other coaches' packages", others, "")}
    </div>
  );
}

function PackageRow({
  pkg,
  locale,
  now,
  showCoach,
}: {
  pkg: LoadedPackage;
  locale: "zh" | "en";
  now: Date;
  showCoach: boolean;
}) {
  const zh = locale === "zh";
  const total = packageTotalHours(pkg);
  const left = pkg.status === "ACTIVE" ? hoursLeft(pkg, now) : 0;
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
          {zh ? `剩余 ${left} / ${total} 小时` : `${left} of ${total}h left`}
          {showCoach &&
            ` · ${zh ? "教练" : "coach"} ${pkg.payeeCoach.name ?? pkg.payeeCoach.email}`}
        </p>
        <p className="font-mono text-xs text-ink-3">
          {pkg.code} · {formatMoneyShort(pkg.priceCents)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
