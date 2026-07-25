"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

/**
 * Freehand signature capture.
 *
 * Draws at device pixel ratio so the exported PNG is crisp when it lands in
 * the PDF, and uses pointer events so a finger, stylus and mouse all behave
 * the same. `touch-action: none` (in globals.css) stops a stroke from
 * scrolling the page on a phone, which is where most of these get signed.
 */
export function SignaturePad({
  onChange,
  label,
  clearLabel,
}: {
  onChange: (dataUrl: string | null) => void;
  label: string;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Always black ink: the PNG is composited onto white paper in the PDF, so
    // a theme-coloured stroke could come out invisible.
    ctx.strokeStyle = "#000000";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    emit();
  }

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(hasInk.current ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        aria-label={label}
        className="signature-pad h-36 w-full rounded-xl border-2 border-dashed border-border-strong bg-white transition-colors hover:border-accent"
      />
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Eraser aria-hidden />
          {clearLabel}
        </Button>
        {empty && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            —
          </span>
        )}
      </div>
    </div>
  );
}
