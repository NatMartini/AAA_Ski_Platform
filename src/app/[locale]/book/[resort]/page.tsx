import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { listBookableCoaches } from "@/lib/coach";
import { formatMoneyShort } from "@/lib/pricing";
import { LevelMatch } from "@/components/booking/level-match";
import { csiaLabel, levelLabel, skillLabel } from "@/lib/skills";
import { toLocale } from "@/i18n/routing";
import { ArrowRight, BadgeCheck } from "lucide-react";

/** How many skill chips fit on a card before it turns into a wall of text. */
const SKILL_CHIPS = 6;

export default async function ChooseCoachPage({
  params,
}: PageProps<"/[locale]/book/[resort]">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}`,
  });

  const t = await getTranslations("booking");
  const tw = await getTranslations("waiver");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const resort = await prisma.resort.findUnique({
    where: { slug: resortSlug },
  });
  if (!resort?.isActive) notFound();

  const coaches = await listBookableCoaches(resortSlug);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ink-3">
          {zh ? resort.nameZh : resort.nameEn}
        </p>
        <h1 className="text-2xl">{t("stepCoach")}</h1>
      </div>

      {coaches.length === 0 ? (
        <Card>
          <CardDescription>{t("noSlots")}</CardDescription>
        </Card>
      ) : (
        <>
          <LevelMatch
            locale={loc}
            resortSlug={resortSlug}
            copy={{
              title: t("matchTitle"),
              body: t("matchBody"),
              action: t("matchAction"),
              pick: t("matchPick"),
            }}
          />

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
              {t("orPickYourself")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="stagger grid gap-4 sm:grid-cols-2">
            {coaches.map((coach) => {
              const certs = csiaLabel(coach.csiaLevel, coach.csiaParkLevel, loc);
              const skills = coach.teachableSkills.slice(0, SKILL_CHIPS);
              const moreSkills = coach.teachableSkills.length - skills.length;
              return (
                <Link
                  key={coach.id}
                  href={`/book/${resortSlug}/${coach.userId}`}
                  className="block"
                >
                  <Card className="lift flex h-full flex-col gap-3">
                    <div className="flex items-start gap-3">
                      {coach.avatarUrl ? (
                        // Coach photo from an arbitrary host; configuring
                        // next/image remotePatterns for two avatars is not
                        // worth it.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coach.avatarUrl}
                          alt=""
                          className="size-12 shrink-0 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="font-display flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-lg font-extrabold text-accent"
                        >
                          {coach.displayName.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg">{coach.displayName}</h2>
                        {certs.length > 0 && (
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-accent">
                            {certs.map((c) => (
                              <span
                                key={c}
                                className="inline-flex items-center gap-1"
                              >
                                <BadgeCheck className="size-3.5" aria-hidden />
                                {c}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <ArrowRight
                        className="size-4 shrink-0 text-ink-3"
                        aria-hidden
                      />
                    </div>

                    {(zh ? coach.bioZh : coach.bioEn) && (
                      <CardDescription className="line-clamp-3">
                        {zh ? coach.bioZh : coach.bioEn}
                      </CardDescription>
                    )}

                    {coach.teachableLevels.length > 0 && (
                      <p className="text-xs text-ink-2">
                        <span className="font-bold text-ink-3">
                          {t("teachesLevels")}{" "}
                        </span>
                        {coach.teachableLevels
                          .map((l) => levelLabel(l, loc))
                          .join(zh ? "、" : " · ")}
                      </p>
                    )}

                    {skills.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {skills.map((key) => (
                          <li
                            key={key}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-ink-2"
                          >
                            {skillLabel(key, loc)}
                          </li>
                        ))}
                        {moreSkills > 0 && (
                          <li className="px-1 py-0.5 text-[11px] font-semibold text-ink-3">
                            {zh ? `+${moreSkills} 项` : `+${moreSkills} more`}
                          </li>
                        )}
                      </ul>
                    )}

                    <p className="mt-auto text-sm" data-numeric>
                      <strong className="font-display text-base">
                        {formatMoneyShort(coach.hourlyRateCents)}
                      </strong>
                      {zh ? " / 小时" : " / hour"}
                      <span className="text-ink-3">
                        {zh
                          ? ` · 最少 ${coach.minHours} 小时`
                          : ` · ${coach.minHours}h minimum`}
                      </span>
                    </p>
                    {/* Set expectations before they invest time in picking a slot. */}
                    <p className="text-xs text-ink-3">{tw("seasonNote")}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
