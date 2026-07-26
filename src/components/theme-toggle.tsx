"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { themeCookieString, type Theme } from "@/lib/theme";

/**
 * Light/dark switch.
 *
 * The current theme is read from the live `data-theme` attribute rather than
 * held in component state, so it stays correct no matter who set it — the
 * server render, this button, or another tab. useSyncExternalStore gives the
 * server render an explicit `null` (no DOM to read), which avoids a hydration
 * mismatch without an effect that immediately calls setState.
 */
const listeners = new Set<() => void>();

function subscribeToTheme(onChange: () => void): () => void {
  listeners.add(onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // Track the OS preference too, for users who never pressed the button.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);

  return () => {
    listeners.delete(onChange);
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle({ label }: { label: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => null);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    // The MutationObserver above turns this into a re-render.
    document.documentElement.setAttribute("data-theme", next);
    // Persisted as a cookie so the next server render already knows.
    document.cookie = themeCookieString(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      // aria-pressed communicates the state to screen readers, since the icon
      // alone does not.
      aria-pressed={isDark}
      className="press flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink"
    >
      {/* Both icons render and cross-fade so the swap rotates instead of
          popping. Until the theme resolves on the client, neither is shown. */}
      <span className="relative block size-4">
        <Sun
          className={`absolute inset-0 size-4 transition-all duration-300 ${
            theme === null
              ? "opacity-0"
              : isDark
                ? "rotate-90 scale-0 opacity-0"
                : "rotate-0 scale-100 opacity-100"
          }`}
          aria-hidden
        />
        <Moon
          className={`absolute inset-0 size-4 transition-all duration-300 ${
            theme === null
              ? "opacity-0"
              : isDark
                ? "rotate-0 scale-100 opacity-100"
                : "-rotate-90 scale-0 opacity-0"
          }`}
          aria-hidden
        />
      </span>
    </button>
  );
}
