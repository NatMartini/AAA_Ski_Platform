"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
