import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ expectedCoachId: z.string().min(1).max(128),
  analysisCreditPriceCents: z.number().int().min(1).max(1_000_000).nullable() });
export async function GET() {
  const auth = await requireCoach();
  if (!auth.ok) return auth.response;
  const profile = await prisma.coachProfile.findUnique({ where: { userId: auth.user.id }, select: { analysisCreditPriceCents: true } });
  return profile ? NextResponse.json(profile) : NextResponse.json({ error: "not-found" }, { status: 404 });
}
export async function PATCH(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "analysis-settings");
  if (limited) return limited;
  const auth = await requireCoach();
  if (!auth.ok) return auth.response;
  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const body = schema.safeParse(jsonBody.data);
  if (!body.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  if (body.data.expectedCoachId !== auth.user.id) return NextResponse.json({ error: "session-changed" }, { status: 409 });
  const profile = await prisma.coachProfile.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const updated = await prisma.coachProfile.update({ where: { id: profile.id },
    data: { analysisCreditPriceCents: body.data.analysisCreditPriceCents },
    select: { analysisCreditPriceCents: true } });
  return NextResponse.json(updated);
}
