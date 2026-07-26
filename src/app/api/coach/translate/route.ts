import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, translateSchema } from "@/lib/validators";
import { translate } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drafts the other language of a coach's cancellation policy.
 *
 * Coach-only, and deliberately not a general translation proxy: it exists so
 * the two coaches can keep both language versions in step, not so the app
 * becomes an open relay to a paid API on someone else's key.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "translate");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const parsed = translateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const result = await translate(parsed.data.text, parsed.data.target);
  if (!result.ok) {
    // 501 for "no key configured" so the UI can say something specific rather
    // than blaming the network.
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not-configured" ? 501 : 502 },
    );
  }

  return NextResponse.json({ text: result.text });
}
