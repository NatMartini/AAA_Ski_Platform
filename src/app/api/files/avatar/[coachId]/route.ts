import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { contentTypeForKey, readObject, StorageKeyError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a coach's profile photo.
 *
 * Requires sign-in for the same reason as everything else here: this site is
 * handed out as a link in a group chat and is not indexed, so a photo of one
 * of the two coaches should not be fetchable by anyone who guesses the URL.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/files/avatar/[coachId]">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { coachId } = await ctx.params;
  const profile = await prisma.coachProfile.findUnique({
    where: { userId: coachId },
    select: { avatarKey: true },
  });
  if (!profile?.avatarKey) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  try {
    const body = await readObject(profile.avatarKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeForKey(profile.avatarKey),
        // Short and private: a replaced photo should appear quickly, and a
        // shared proxy must not hold on to it.
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    if (err instanceof StorageKeyError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
