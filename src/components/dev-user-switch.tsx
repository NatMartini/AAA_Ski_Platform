"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
    document.cookie = `dev-as=${encodeURIComponent(email)}; path=/; SameSite=Lax`;
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
              ? "rounded bg-red-600 px-2 py-1 font-medium text-white"
              : "rounded border border-red-500/50 px-2 py-1 hover:bg-red-500/20"
          }
        >
          {c.name ?? c.email} · {c.role}
        </button>
      ))}
    </span>
  );
}
