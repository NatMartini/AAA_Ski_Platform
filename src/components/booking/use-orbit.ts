"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * A camera the viewer turns around the skier: drag sideways to walk round, drag up or down (with a mouse or pen) to look
 * from higher or lower, ctrl + wheel or a pinch on a trackpad to zoom. On a touchscreen a vertical drag still scrolls
 * the page; the angle buttons change the height there.
 */
export type Orbit = { azimuth: number; elevation: number; zoom: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const ELEVATION_RANGE = [2, 84] as const;
export const ZOOM_RANGE = [.3, 4] as const;

export function useOrbit(element: RefObject<HTMLElement | null>, initial: Orbit) {
  const [orbit, setOrbitState] = useState(initial);
  const live = useRef(initial);
  // Whether the viewer has turned the camera since it was last set.
  const [moved, setMoved] = useState(false);
  const setOrbit = useCallback((next: Orbit, byViewer = false) => {
    const value = { azimuth: ((next.azimuth % 360) + 360) % 360, elevation: clamp(next.elevation, ...ELEVATION_RANGE), zoom: clamp(next.zoom, ...ZOOM_RANGE) };
    live.current = value;
    setOrbitState(value);
    setMoved(byViewer);
  }, []);

  useEffect(() => {
    const box = element.current;
    if (!box) return;
    let drag: { id: number; x: number; y: number; touch: boolean } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" };
      if (!drag.touch) box.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const now = live.current;
      // Like turning the scene by hand: dragging right walks the camera left round the skier, dragging down lifts it.
      setOrbit({ azimuth: now.azimuth + dx * .45, elevation: drag.touch ? now.elevation : now.elevation + dy * .3, zoom: now.zoom }, true);
    };
    const up = (event: PointerEvent) => { if (drag && event.pointerId === drag.id) drag = null; };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setOrbit({ ...live.current, zoom: live.current.zoom * Math.exp(event.deltaY * .004) }, true);
    };
    const key = (event: KeyboardEvent) => {
      const now = live.current, step = event.shiftKey ? 30 : 10;
      const next = event.key === "ArrowLeft" ? { ...now, azimuth: now.azimuth - step } : event.key === "ArrowRight" ? { ...now, azimuth: now.azimuth + step }
        : event.key === "ArrowUp" ? { ...now, elevation: now.elevation + step / 2 } : event.key === "ArrowDown" ? { ...now, elevation: now.elevation - step / 2 }
        : event.key === "+" || event.key === "=" ? { ...now, zoom: now.zoom / 1.2 } : event.key === "-" ? { ...now, zoom: now.zoom * 1.2 } : null;
      if (!next) return;
      event.preventDefault();
      setOrbit(next, true);
    };
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("keydown", key);
    return () => {
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", up);
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("keydown", key);
    };
  }, [element, setOrbit]);

  return { orbit, live, moved, setOrbit };
}
