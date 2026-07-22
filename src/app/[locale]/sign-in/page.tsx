import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { googleEnabled } from "@/auth";
import { getUser } from "@/lib/auth/require-user";
import { Card } from "@/components/ui/card";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { DevSignIn } from "@/components/dev-sign-in";
import { devBypassChoices, devBypassEnabled } from "@/lib/auth/dev-bypass";
import { toLocale } from "@/i18n/routing";
import { Snowflake, TriangleAlert } from "lucide-react";

export default async function SignInPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { reason, callbackUrl } = await searchParams;
  const user = await getUser();
  if (user) redirect({ href: "/", locale });

  const t = await getTranslations("signIn");

  const notice =
    reason === "session-invalid"
      ? t("reasonSessionInvalid")
      : reason === "expired"
        ? t("reasonExpired")
        : reason
          ? t("reasonError")
          : null;

  return (
    <div className="mx-auto max-w-sm py-10">
      <Card className="space-y-5 text-center">
        <Snowflake className="mx-auto size-8 text-ice-500" aria-hidden />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("body")}
          </p>
        </div>

        {notice && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-800 dark:text-amber-200"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        )}

        {googleEnabled && (
          <GoogleSignInButton
            label={t("google")}
            callbackUrl={typeof callbackUrl === "string" ? callbackUrl : `/${locale}`}
          />
        )}

        {/* Development sign-in. Renders only when DEV_AUTH_BYPASS=1, which is
            impossible in production — see lib/auth/dev-bypass.ts. */}
        {devBypassEnabled() ? (
          <DevSignIn
            locale={toLocale(locale)}
            accounts={await devBypassChoices()}
            callbackUrl={
              typeof callbackUrl === "string" ? callbackUrl : `/${locale}`
            }
          />
        ) : (
          !googleEnabled && (
            <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
              {t("unavailable")}
            </p>
          )
        )}
      </Card>
    </div>
  );
}
