"use client";

import { skillsByTier, type SkillTrack } from "@/lib/skills";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/**
 * Multi-select of individual CSIA manoeuvres.
 *
 * Toggle chips rather than a multi-select listbox: on a phone this is one tap
 * per item with no scrolling inside a scroll, and the selected set stays
 * visible. Each chip is a real button with aria-pressed so it is reachable by
 * keyboard and announced correctly.
 *
 * Grouped by the certification level a manoeuvre belongs to, in syllabus
 * order, so a beginner finds what they want at the top and does not have to
 * read past the halfpipe to get there.
 *
 * `allowed` narrows the list to what a given coach teaches; leaving it
 * undefined shows everything.
 */
export function SkillPicker({
  locale,
  selected,
  onChange,
  allowed,
  labels,
}: {
  locale: Locale;
  selected: string[];
  onChange: (next: string[]) => void;
  allowed?: string[];
  labels: { alpine: string; park: string; tier: string };
}) {
  const allow = allowed && allowed.length > 0 ? new Set(allowed) : null;

  function toggle(key: string) {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );
  }

  const tracks: { track: SkillTrack; label: string }[] = [
    { track: "alpine", label: labels.alpine },
    { track: "park", label: labels.park },
  ];

  return (
    <div className="space-y-4">
      {tracks.map(({ track, label }) => {
        const groups = skillsByTier(track)
          .map((g) => ({
            ...g,
            skills: g.skills.filter((s) => !allow || allow.has(s.key)),
          }))
          .filter((g) => g.skills.length > 0);
        if (groups.length === 0) return null;

        return (
          <div key={track} className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
              {label}
            </p>
            {groups.map(({ tier, skills }) => (
              <div key={tier} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-3">
                  {labels.tier.replace("{n}", String(tier))}
                </span>
                {skills.map((skill) => {
                  const on = selected.includes(skill.key);
                  return (
                    <button
                      key={skill.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(skill.key)}
                      className={cn(
                        "press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                        on
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border bg-surface text-ink-2 hover:border-accent hover:text-ink",
                      )}
                    >
                      {on && <Check className="size-3" aria-hidden />}
                      {locale === "zh" ? skill.zh : skill.en}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
