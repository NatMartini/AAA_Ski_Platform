"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton({
  label,
  devMode,
}: {
  label: string;
  /** True when signed in through the development bypass rather than Google. */
  devMode?: boolean;
}) {
  const router = useRouter();

  function handleSignOut() {
    if (devMode) {
      // There is no NextAuth session to end — clearing the impersonation
      // cookie is what signs you out.
      clearDevUser();
      router.replace("/");
      router.refresh();
      return;
    }
    void signOut({ callbackUrl: "/" });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}

/** Kept out of the component: assigning document.cookie is a side effect. */
function clearDevUser(): void {
  document.cookie = "dev-as=; path=/; Max-Age=0; SameSite=Lax";
}
