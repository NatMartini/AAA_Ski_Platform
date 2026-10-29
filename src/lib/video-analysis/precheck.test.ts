import { describe, expect, it } from "vitest";
import { FILMING_GUIDE, filmingWarnings } from "./precheck";

describe("upload pre-check", () => {
  it("passes a landscape 1080p run of a sensible length", () => {
    expect(filmingWarnings({ durationSec: 22.3, width: 1920, height: 1080, bytes: 40_000_000 })).toEqual([]);
  });

  it("warns about clips that will not score: too short, portrait, low resolution, overlong", () => {
    const codes = (meta: Parameters<typeof filmingWarnings>[0]) => filmingWarnings(meta).map(warning => warning.code);
    expect(codes({ durationSec: 4, width: 1920, height: 1080, bytes: 1 })).toEqual(["too_short"]);
    expect(codes({ durationSec: 20, width: 1080, height: 1920, bytes: 1 })).toEqual(["portrait"]);
    expect(codes({ durationSec: 20, width: 640, height: 360, bytes: 1 })).toEqual(["low_resolution"]);
    expect(codes({ durationSec: 150, width: 3840, height: 2160, bytes: 1 })).toEqual(["too_long"]);
    expect(codes({ durationSec: 3, width: 480, height: 640, bytes: 1 })).toEqual(["too_short", "portrait", "low_resolution"]);
  });

  it("never blocks an upload and says nothing when the browser could not read the file", () => {
    expect(filmingWarnings({ durationSec: null, width: null, height: null, bytes: 1 })).toEqual([]);
    expect(filmingWarnings({ durationSec: 2, width: 100, height: 200, bytes: 1 }).every(warning => !warning.blocking)).toBe(true);
  });

  it("keeps the filming guide to a few rules in both languages", () => {
    expect(FILMING_GUIDE.length).toBeLessThanOrEqual(5);
    expect(FILMING_GUIDE.every(rule => rule.zh && rule.en)).toBe(true);
  });
});
