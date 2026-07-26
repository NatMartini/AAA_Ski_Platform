"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { LEVELS } from "@/lib/skills";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Wand2 } from "lucide-react";

/**
 * "Don't make me choose" path: the student says how they ski and we pick the
 * coach. It sits above the coach list rather than replacing it, because some
 * students very much do want to pick — usually because a friend recommended
 * someone by name.
 */
export function LevelMatch({
  locale,
  resortSlug,
  copy,
}: {
  locale: Locale;
  resortSlug: string;
  copy: { title: string; body: string; action: string; pick: string };
}) {
  const router = useRouter();
  const [level, setLevel] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const zh = locale === "zh";

  return (
    <section className="fade-up rounded-2xl border border-border bg-[var(--surface-2)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base">
        <Wand2 className="size-4 text-accent" aria-hidden />
        {copy.title}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{copy.body}</p>

      <fieldset className="mt-3">
        <legend className="sr-only">{copy.pick}</legend>
        <div className="stagger grid gap-2 sm:grid-cols-2">
          {LEVELS.map((l) => {
            const on = level === l.key;
            return (
              <button
                key={l.key}
                type="button"
                aria-pressed={on}
                onClick={() => setLevel(l.key)}
                className={cn(
                  "press rounded-xl border p-3 text-left",
                  on
                    ? "border-accent bg-[var(--accent-soft)]"
                    : "border-border bg-surface hover:border-accent",
                )}
              >
                <span className="block text-sm font-bold text-ink">
                  {zh ? l.zh : l.en}
                </span>
                <span className="mt-0.5 block text-xs text-ink-2">
                  {zh ? l.zhHint : l.enHint}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button
        type="button"
        className="mt-3 w-full sm:w-auto"
        disabled={!level || going}
        onClick={() => {
          setGoing(true);
          router.push(`/book/${resortSlug}/auto?level=${level}`);
        }}
      >
        {going && <Loader2 className="animate-spin" aria-hidden />}
        {copy.action}
      </Button>
    </section>
  );
}
