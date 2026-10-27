import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { parseBookingSelection, toBookingSelectionQuery } from "@/lib/booking/selection";

/** Recommendation remains a choice; it never changes the selected time. */
export default async function AutoAssignPage({ params, searchParams }: PageProps<"/[locale]/book/[resort]/auto">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const selection = parseBookingSelection(query);
  const suffix = selection ? new URLSearchParams(toBookingSelectionQuery(selection)).toString() : "";
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/book/${resortSlug}/auto${suffix ? `?${suffix}` : ""}` });
  if (user.role === "COACH" || user.role === "ADMIN") redirect({ href: "/coach/bookings/new", locale });
  if (!selection) return redirect({ href: { pathname: `/book/${resortSlug}`, query: { ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string")), selectionError: "missing" } }, locale });
  redirect({ href: { pathname: `/book/${resortSlug}/coaches`, query: { ...toBookingSelectionQuery(selection), recommend: "true" } }, locale });
}
