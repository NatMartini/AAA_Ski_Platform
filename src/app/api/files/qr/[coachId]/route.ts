import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { contentTypeForKey, readObject, StorageKeyError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a coach's payment QR code.
 *
 * Requires sign-in: the QR is a payment destination and there is no reason for
 * it to be fetchable by anyone who guesses the URL. The coach may always see
 * their own; students see it because they need to pay.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/files/qr/[coachId]">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { coachId } = await ctx.params;
  const url = new URL(_req.url);
  const kind = url.searchParams.get("kind") === "alipay" ? "alipay" : "wechat";

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: coachId },
    select: {
      wechatPayQrKey: true,
      alipayQrKey: true,
      wechatPayEnabled: true,
      alipayEnabled: true,
    },
  });
  if (!profile) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const key =
    kind === "alipay"
      ? profile.alipayEnabled
        ? profile.alipayQrKey
        : null
      : profile.wechatPayEnabled
        ? profile.wechatPayQrKey
        : null;

  if (!key) return NextResponse.json({ error: "not-found" }, { status: 404 });

  try {
    const body = await readObject(key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeForKey(key),
        // Private: never let a shared proxy hold on to a payment destination.
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
