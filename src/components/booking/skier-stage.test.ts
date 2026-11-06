import { describe, expect, it } from "vitest";
import { cameraAxes } from "@/lib/freeski/standard-motion";
import { shotToCanvas, STANDARD_LOOK, USER_LOOK, type Shot } from "./skier-stage";

const axes = cameraAxes({ azimuth: 180, elevation: 9, slope: 18 });
const shot = (rect: Shot["rect"], focus: Shot["focus"] = [0, 0, 1]): Shot => ({ rect, axes, slopeDeg: 18, focus, frameHeight: 3, snowAt: [0, 0], figures: [] });

describe("where a shot shows a point", () => {
  it("puts what the camera looks at in the middle of its part of the canvas", () => {
    expect(shotToCanvas(shot({ x: 0, y: 0, width: 1, height: 1 }), 1000, 500)(0, 0, 1)[0]).toBeCloseTo(500, 6);
    expect(shotToCanvas(shot({ x: 0, y: 0, width: 1, height: 1 }), 1000, 500)(0, 0, 1)[1]).toBeCloseTo(250, 6);
    expect(shotToCanvas(shot({ x: .5, y: 0, width: .5, height: 1 }), 1000, 500)(0, 0, 1)[0]).toBeCloseTo(750, 6);
  });

  it("covers the frame's height in metres, with up the picture's up", () => {
    const toCanvas = shotToCanvas(shot({ x: 0, y: 0, width: 1, height: 1 }), 1000, 500);
    const [, top] = toCanvas(axes.up[0] * 1.5, axes.up[1] * 1.5, 1 + axes.up[2] * 1.5);
    expect(top).toBeCloseTo(0, 6);
  });

  it("shows the skier's right on the picture's left when filmed from the front", () => {
    const toCanvas = shotToCanvas(shot({ x: 0, y: 0, width: 1, height: 1 }), 1000, 500);
    expect(toCanvas(.3, 0, 1)[0]).toBeLessThan(500);
  });

  it("makes nearer things larger, as a lens does", () => {
    const toCanvas = shotToCanvas(shot({ x: 0, y: 0, width: 1, height: 1 }), 1000, 500);
    // From the front, downhill is toward the camera.
    const near = Math.abs(toCanvas(.3, 1, 1)[0] - toCanvas(0, 1, 1)[0]), far = Math.abs(toCanvas(.3, -1, 1)[0] - toCanvas(0, -1, 1)[0]);
    expect(near).toBeGreaterThan(far);
  });
});

describe("the two skiers", () => {
  it("wear different jackets", () => {
    expect(USER_LOOK.jacket).not.toBe(STANDARD_LOOK.jacket);
  });
});
