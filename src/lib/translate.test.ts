import { afterEach, describe, expect, it, vi } from "vitest";
import { translate, translationConfigured } from "./translate";

const KEY = "DEEPL_API_KEY";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("translate", () => {
  it("reports when no key is configured rather than failing obscurely", async () => {
    vi.stubEnv(KEY, "");
    expect(translationConfigured()).toBe(false);
    expect(await translate("课前 48 小时以上取消可全额退款。", "EN")).toEqual({
      ok: false,
      reason: "not-configured",
    });
  });

  it("refuses empty input before spending a request", async () => {
    vi.stubEnv(KEY, "abc:fx");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await translate("   ", "EN")).toEqual({ ok: false, reason: "empty" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes a free key to the free host, and a paid key to the paid one", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        return {
          ok: true,
          json: async () => ({ translations: [{ text: "done" }] }),
        };
      }),
    );

    vi.stubEnv(KEY, "abc:fx");
    await translate("你好", "EN");
    vi.stubEnv(KEY, "abc");
    await translate("你好", "EN");

    expect(seen[0]).toContain("api-free.deepl.com");
    expect(seen[1]).toContain("api.deepl.com");
    expect(seen[1]).not.toContain("api-free");
  });

  it("asks for a regional English, which DeepL requires", async () => {
    let body: URLSearchParams | undefined;
    vi.stubEnv(KEY, "abc:fx");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        body = init.body;
        return { ok: true, json: async () => ({ translations: [{ text: "x" }] }) };
      }),
    );

    await translate("你好", "EN");
    expect(body?.get("target_lang")).toBe("EN-US");

    await translate("hello", "ZH");
    expect(body?.get("target_lang")).toBe("ZH");
  });

  it("returns the translation", async () => {
    vi.stubEnv(KEY, "abc:fx");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ translations: [{ text: "Full refund." }] }),
      })),
    );
    expect(await translate("全额退款。", "EN")).toEqual({
      ok: true,
      text: "Full refund.",
    });
  });

  it("treats an upstream failure as a failure, never as an empty policy", async () => {
    // Silently returning "" here would let a coach save a blank English
    // policy, which is the one outcome that must not happen.
    vi.stubEnv(KEY, "abc:fx");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await translate("全额退款。", "EN")).toEqual({
      ok: false,
      reason: "upstream",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ translations: [] }) })),
    );
    expect(await translate("全额退款。", "EN")).toEqual({
      ok: false,
      reason: "upstream",
    });
  });

  it("survives the network throwing", async () => {
    vi.stubEnv(KEY, "abc:fx");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET");
    }));
    expect(await translate("全额退款。", "EN")).toEqual({
      ok: false,
      reason: "upstream",
    });
  });
});
