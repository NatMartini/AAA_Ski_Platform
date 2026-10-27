/**
 * Keep form failures on the same response path when a connection drops.
 * Never retry a mutation here: the server may already have accepted it.
 */
export async function clientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    return Response.json({ error: "network-error" }, { status: 503 });
  }
}
