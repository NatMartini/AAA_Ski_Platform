import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildKey,
  contentTypeForKey,
  resolveKey,
  StorageKeyError,
} from "./storage";

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

describe("resolveKey", () => {
  it("resolves a normal key inside the storage root", () => {
    const full = resolveKey("proofs/abc123/file.webp");
    expect(full.startsWith(ROOT)).toBe(true);
    expect(full.endsWith(path.join("proofs", "abc123", "file.webp"))).toBe(true);
  });

  it("refuses parent traversal", () => {
    expect(() => resolveKey("../secrets.txt")).toThrow(StorageKeyError);
    expect(() => resolveKey("proofs/../../etc/passwd")).toThrow(StorageKeyError);
    expect(() => resolveKey("proofs/../../../.env.local")).toThrow(StorageKeyError);
  });

  it("refuses absolute paths", () => {
    expect(() => resolveKey("/etc/passwd")).toThrow(StorageKeyError);
    expect(() => resolveKey("C:\\Windows\\System32\\config\\SAM")).toThrow(
      StorageKeyError,
    );
  });

  it("refuses null bytes and empty keys", () => {
    expect(() => resolveKey("proofs/a\0.webp")).toThrow(StorageKeyError);
    expect(() => resolveKey("")).toThrow(StorageKeyError);
  });

  it("allows traversal that stays inside the root", () => {
    // "proofs/x/../y.webp" normalises to "proofs/y.webp" — still contained.
    expect(() => resolveKey("proofs/x/../y.webp")).not.toThrow();
  });
});

describe("buildKey", () => {
  it("produces a unique key under the given prefix", () => {
    const a = buildKey("proofs/booking1", "webp");
    const b = buildKey("proofs/booking1", "webp");
    expect(a).not.toBe(b);
    expect(a.startsWith("proofs/booking1/")).toBe(true);
    expect(a.endsWith(".webp")).toBe(true);
  });

  it("normalises the extension", () => {
    expect(buildKey("waivers", ".PDF").endsWith(".pdf")).toBe(true);
  });

  it("rejects extensions and prefixes that could inject separators", () => {
    expect(() => buildKey("proofs", "we/bp")).toThrow();
    expect(() => buildKey("proofs/../..", "webp")).toThrow();
    expect(() => buildKey("proofs", "")).toThrow();
  });

  it("round-trips through resolveKey", () => {
    expect(() => resolveKey(buildKey("waivers", "pdf"))).not.toThrow();
  });
});

describe("contentTypeForKey", () => {
  it("maps known extensions", () => {
    expect(contentTypeForKey("proofs/a/b.webp")).toBe("image/webp");
    expect(contentTypeForKey("waivers/x.pdf")).toBe("application/pdf");
  });

  it("falls back to octet-stream rather than guessing", () => {
    expect(contentTypeForKey("proofs/a/b.svg")).toBe("application/octet-stream");
    expect(contentTypeForKey("proofs/a/b")).toBe("application/octet-stream");
  });
});
