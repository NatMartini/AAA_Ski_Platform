import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { contentTypeForKey, readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a package payment screenshot to the buyer and the coaches. Like a
 * booking's, it may show an account number and balance, so nobody else.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/packages/[code]/proof">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const pkg = await loadPackage(code);
  if (!pkg?.paymentProofKey) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (!accessForPackage(pkg, r.user).canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await readObject(pkg.paymentProofKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeForKey(pkg.paymentProofKey),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
