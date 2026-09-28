import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { contentTypeForKey, readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a package payment screenshot to the buyer or the coach they paid —
 * not to other coaches, who can see the package but not how it was paid. Like
 * a booking's, the screenshot may show an account number and balance.
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
  if (!accessForPackage(pkg, r.user).canSeeProof) {
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
