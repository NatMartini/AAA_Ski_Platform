"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Kept outside the component: the compiler's immutability rule objects to
 * assigning `document.cookie` inside a render function, and this is a plain
 * side effect rather than component state.
 */
function setDevUser(email: string): void {
  document.cookie = `dev-as=${encodeURIComponent(email)}; path=/; SameSite=Lax`;
}

/** Flips the `dev-as` cookie so both sides of the app can be inspected. */
export function DevUserSwitch({
  choices,
  current,
}: {
  choices: { email: string; name: string | null; role: string }[];
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (choices.length === 0) return null;

  function switchTo(email: string) {
    setDevUser(email);
    startTransition(() => router.refresh());
  }

  return (
    <span className="ml-auto flex items-center gap-1" aria-busy={pending}>
      {choices.map((c) => (
        <button
          key={c.email}
          type="button"
          onClick={() => switchTo(c.email)}
          aria-current={c.email === current ? "true" : undefined}
          className={
            c.email === current
              ? "inline-flex min-h-8 items-center rounded-lg bg-red-600 px-2.5 font-semibold text-white"
              : "inline-flex min-h-8 items-center rounded-lg border border-red-500/50 px-2.5 hover:bg-red-500/20"
          }
        >
          {c.name ?? c.email} · {c.role}
        </button>
      ))}
    </span>
  );
}
