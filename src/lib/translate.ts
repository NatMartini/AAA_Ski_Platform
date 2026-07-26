/**
 * Machine translation for the cancellation policy.
 *
 * Used for exactly one thing: letting a coach write the policy in one language
 * and get a first draft of the other. It is a drafting aid, never applied
 * silently — the coach sees the result in the textarea and has to save it.
 * That matters, because this text is frozen onto every booking as the terms
 * the student agreed to, and a mistranslated refund rule is a real dispute.
 *
 * The text is sent to DeepL, which is a third party. That is inherent to the
 * feature and the UI says so. Nothing personal goes through here: the policy
 * is the coach's own published terms.
 *
 * DeepL rather than Google: the free tier needs no billing account, and the
 * endpoint is a single form POST with no SDK.
 */

export type TranslateLang = "ZH" | "EN";

export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not-configured" | "upstream" | "empty" };

/** Free keys end in ":fx" and use a different host. */
function endpoint(key: string): string {
  return key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
}

export function translationConfigured(): boolean {
  return Boolean(process.env.DEEPL_API_KEY);
}

export async function translate(
  text: string,
  target: TranslateLang,
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const key = process.env.DEEPL_API_KEY;
  if (!key) return { ok: false, reason: "not-configured" };

  // DeepL wants a regional variant for English; ZH needs none.
  const targetLang = target === "EN" ? "EN-US" : "ZH";

  try {
    const res = await fetch(endpoint(key), {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text: trimmed,
        target_lang: targetLang,
        // The policy is prose with line breaks that carry meaning (one rule
        // per line); preserving them keeps the draft readable.
        preserve_formatting: "1",
      }),
      // A coach is sitting waiting for this. Fail fast rather than hang.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { ok: false, reason: "upstream" };

    const body = (await res.json()) as {
      translations?: { text?: string }[];
    };
    const out = body.translations?.[0]?.text;
    if (!out) return { ok: false, reason: "upstream" };

    return { ok: true, text: out };
  } catch {
    return { ok: false, reason: "upstream" };
  }
}
