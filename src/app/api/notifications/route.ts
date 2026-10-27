import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { loadNotifications } from "@/lib/notification-store";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const items = await loadNotifications(auth.user);
    return NextResponse.json({ userId: auth.user.id, items }, { headers });
  } catch {
    return NextResponse.json({ error: "Notifications unavailable" }, { status: 503, headers });
  }
}
