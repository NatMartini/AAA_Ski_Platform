"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label } from "@/components/ui/field";
import { GraduationCap, Loader2, TriangleAlert, User } from "lucide-react";
import type { Locale } from "@/i18n/routing";

export type DevAccount = {
  email: string;
  name: string | null;
  role: string;
};

const COPY = {
  zh: {
    title: "开发模式登录",
    body: "Google 登录尚未配置。选择一个账号直接进入,无需认证。",
    warn: "这是开发用的登录方式,生产环境下不可用。",
    coach: "教练",
    customer: "学员",
    admin: "管理员",
    other: "以其他邮箱登录",
    emailLabel: "账号邮箱",
    go: "登录",
    notFound: "找不到该邮箱对应的账号。",
    none: "数据库里还没有账号。先运行 npm run dev:demo。",
  },
  en: {
    title: "Development sign-in",
    body: "Google sign-in is not configured. Pick an account to continue — no authentication required.",
    warn: "This sign-in method is for development only and is unavailable in production.",
    coach: "Coach",
    customer: "Student",
    admin: "Admin",
    other: "Sign in as another address",
    emailLabel: "Account email",
    go: "Sign in",
    notFound: "No account with that email address.",
    none: "No accounts exist yet. Run npm run dev:demo first.",
  },
} as const;

export function DevSignIn({
  accounts,
  locale,
  callbackUrl,
}: {
  accounts: DevAccount[];
  locale: Locale;
  callbackUrl: string;
}) {
  const c = COPY[locale];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  function signInAs(email: string) {
    setError(null);
    if (!accounts.some((a) => a.email === email)) {
      setError(c.notFound);
      return;
    }
    setDevUser(email);
    startTransition(() => {
      router.replace(callbackUrl);
      router.refresh();
    });
  }

  const roleLabel = (role: string) =>
    role === "COACH" ? c.coach : role === "ADMIN" ? c.admin : c.customer;

  return (
    <div className="space-y-4 text-left">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{c.title}</h2>
        <p className="text-sm text-muted-foreground">{c.body}</p>
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
          {c.none}
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                disabled={pending}
                onClick={() => signInAs(a.email)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-ice-400 disabled:opacity-50"
              >
                {a.role === "COACH" || a.role === "ADMIN" ? (
                  <GraduationCap className="size-5 shrink-0 text-ice-500" aria-hidden />
                ) : (
                  <User className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {a.name ?? a.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.email}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {roleLabel(a.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm">{c.other}</summary>
        <div className="mt-3 space-y-2">
          <Label htmlFor="dev-email">{c.emailLabel}</Label>
          <Input
            id="dev-email"
            type="email"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") signInAs(custom.trim().toLowerCase());
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || !custom.trim()}
            onClick={() => signInAs(custom.trim().toLowerCase())}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {c.go}
          </Button>
        </div>
      </details>

      <FieldError>{error}</FieldError>

      <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {c.warn}
      </p>
      <Hint>DEV_AUTH_BYPASS=1</Hint>
    </div>
  );
}

/**
 * Outside the component: the compiler's immutability rule rejects assigning
 * document.cookie inside a render function, and this is a plain side effect.
 */
function setDevUser(email: string): void {
  document.cookie = `dev-as=${encodeURIComponent(email)}; path=/; SameSite=Lax`;
}
