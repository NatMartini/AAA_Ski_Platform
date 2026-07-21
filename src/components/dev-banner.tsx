import { devBypassChoices, devBypassEnabled } from "@/lib/auth/dev-bypass";
import type { ActiveUser } from "@/lib/auth/require-user";
import { DevUserSwitch } from "./dev-user-switch";

/**
 * Loud, unmissable banner shown whenever the auth bypass is active.
 *
 * The point is that nobody can look at a screenshot of this site and mistake
 * it for a real signed-in session. It renders nothing at all in production,
 * where the bypass cannot be enabled.
 */
export async function DevBanner({ user }: { user: ActiveUser | null }) {
  if (!devBypassEnabled()) return null;
  const choices = await devBypassChoices();

  return (
    <div className="no-print border-b-2 border-red-500 bg-red-500/15 px-4 py-2 text-red-900 dark:text-red-100">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:px-2">
        <span className="font-semibold uppercase tracking-wide">
          Dev mode · sign-in bypassed
        </span>
        <span className="opacity-80">
          Everyone is signed in as{" "}
          <strong>
            {user ? `${user.name ?? user.email} (${user.role})` : "nobody"}
          </strong>
          . Never run this with real student data.
        </span>
        <DevUserSwitch choices={choices} current={user?.email ?? ""} />
      </div>
    </div>
  );
}
