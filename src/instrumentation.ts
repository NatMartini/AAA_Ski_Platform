/**
 * Runs once when the server boots.
 *
 * Its only job right now is to refuse to start a production server that still
 * has the development auth bypass configured — a misconfiguration that would
 * otherwise silently expose every booking, waiver and payment screenshot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertNotProduction } = await import("./lib/auth/dev-bypass");
    assertNotProduction();
  }
}
