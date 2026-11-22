import type { LiftedPose } from "./skier-lift";

/**
 * A whole run's path over the snow, worked out from the video: each turn's skier is lifted into 3D, the skis' heading is
 * read off them, and the path follows that heading at a steady speed. The speed is not in the video, so the size is
 * only an estimate at the standard's speed; the shape — how evenly each turn swings round — is what the video shows.
 */
export type TrackPoint = { time: number; x: number; y: number; heading: number };
export type TrackTurn = { from: number; to: number; direction: "left" | "right";
  /** Where the turn crosses the fall line, its widest point across the slope. */
  apex: TrackPoint;
  /** How far across the slope the turns go: from this turn's widest point to its neighbours', metres at the assumed speed. */
  width: number;
  /** The share of the turn during which the skis swing at half their quickest or more: a round turn is about two thirds. */
  evenness: number;
  /** The quickest swing, degrees a second. */
  peakRate: number };
export type RunTrack = { points: TrackPoint[]; turns: TrackTurn[]; width: number; length: number; bias: number };

type Part = { start: number; end: number; lift: LiftedPose };

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Where both skis point at each sample of a lifted turn, radians from the fall line, + toward the skier's right. */
export function liftedHeadings(lift: LiftedPose): number[] {
  const { index } = lift;
  return lift.frames.map(frame => {
    let dx = 0, dy = 0;
    for (const side of ["left", "right"]) {
      const tip = index[`${side}_ski_tip_a`] * 3, tail = index[`${side}_ski_tail_a`] * 3;
      dx += frame[tip] - frame[tail];
      dy += frame[tip + 1] - frame[tail + 1];
    }
    return Math.atan2(dx, dy);
  });
}

/** Where one turn's samples meet the next, a jump bigger than this is the two turns' camera fits, not the skis. */
const SEAM = 6 * Math.PI / 180;

/**
 * The skis' heading through the run, one sample per lifted frame inside its own turn, in time order. Each turn is lifted
 * under its own fitted camera, so a turn's headings are shifted to carry on from the last turn's where they meet.
 */
export function runHeadings(parts: readonly Part[]): { time: number; heading: number }[] {
  const samples: { time: number; heading: number }[] = [];
  for (const part of [...parts].sort((a, b) => a.start - b.start)) {
    const headings = liftedHeadings(part.lift);
    let shift = 0, first = true;
    part.lift.times.forEach((time, i) => {
      if (time < part.start || time >= part.end || (samples.length && time <= samples.at(-1)!.time)) return;
      const previous = samples.at(-1);
      // Unwrapped against the sample before, so a heading never jumps by a full circle.
      let heading = previous ? previous.heading + wrap(headings[i] + shift - previous.heading) : headings[i];
      if (first && previous && time - previous.time < .25 && Math.abs(heading - previous.heading) > SEAM) {
        shift -= heading - previous.heading;
        heading = previous.heading;
      }
      first = false;
      samples.push({ time, heading });
    });
  }
  return samples;
}

/** Headings smoothed over about a tenth of a second, with weights that fall off gently: a foot's keypoints are noisy frame to frame. */
function smoothed(samples: readonly { time: number; heading: number }[], sigma = .05) {
  return samples.map((sample, i) => {
    let sum = 0, weights = 0;
    for (const step of [-1, 1]) {
      for (let k = step < 0 ? i : i + 1; k >= 0 && k < samples.length && Math.abs(samples[k].time - sample.time) <= 3 * sigma; k += step) {
        const weight = Math.exp(-((samples[k].time - sample.time) ** 2) / (2 * sigma * sigma));
        sum += samples[k].heading * weight;
        weights += weight;
      }
    }
    return { time: sample.time, heading: sum / weights };
  });
}

/**
 * The path at `speed` metres a second. A run goes down the hill on the whole, so a heading the camera's angle tilts all
 * one way is turned back by its average first.
 */
export function runTrack(raw: readonly { time: number; heading: number }[], speed: number): RunTrack | null {
  if (raw.length < 8) return null;
  const samples = smoothed(raw);
  const duration = samples.at(-1)!.time - samples[0].time;
  if (duration <= 0) return null;
  let sin = 0, cos = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].time - samples[i - 1].time;
    sin += Math.sin(samples[i].heading) * dt;
    cos += Math.cos(samples[i].heading) * dt;
  }
  const bias = Math.atan2(sin, cos);
  const points: TrackPoint[] = [];
  let x = 0, y = 0;
  samples.forEach((sample, i) => {
    const heading = Math.max(-Math.PI * .47, Math.min(Math.PI * .47, wrap(sample.heading - bias)));
    if (i > 0) {
      const dt = Math.min(.25, sample.time - samples[i - 1].time), middle = (heading + points[i - 1].heading) / 2;
      x += Math.sin(middle) * speed * dt;
      y += Math.cos(middle) * speed * dt;
    }
    points.push({ time: sample.time, x, y, heading });
  });
  const xs = points.map(point => point.x);
  return { points, turns: splitTurns(points), width: Math.max(...xs) - Math.min(...xs), length: y, bias };
}

/**
 * Whole turns, from one heading extreme to the next: at an edge change the skis point furthest across the hill. An
 * extreme counts once the heading has swung back from it by `minimumSwing`, so small wobbles do not split a turn.
 */
export function splitTurns(points: readonly TrackPoint[], minimumSwing = 15 * Math.PI / 180): TrackTurn[] {
  const extremes: number[] = [];
  let direction = 0, low = 0, high = 0, extreme = 0;
  for (let i = 1; i < points.length; i++) {
    const heading = points[i].heading;
    if (direction === 0) {
      if (heading < points[low].heading) low = i;
      if (heading > points[high].heading) high = i;
      // The first clear swing: the turn it belongs to started at the opposite extreme.
      if (heading - points[low].heading >= minimumSwing) { direction = 1; extremes.push(low); extreme = i; }
      else if (points[high].heading - heading >= minimumSwing) { direction = -1; extremes.push(high); extreme = i; }
      continue;
    }
    if ((heading - points[extreme].heading) * direction > 0) { extreme = i; continue; }
    if ((points[extreme].heading - heading) * direction >= minimumSwing) {
      extremes.push(extreme);
      direction = -direction;
      // The new swing's furthest point so far, since the extreme.
      let next = extreme;
      for (let k = extreme + 1; k <= i; k++) if ((points[k].heading - points[next].heading) * direction > 0) next = k;
      extreme = next;
    }
  }
  const found: Omit<TrackTurn, "width">[] = [];
  for (let k = 1; k < extremes.length; k++) {
    const a = extremes[k - 1], b = extremes[k];
    if (b - a < 4) continue;
    const rates: number[] = [];
    for (let i = a + 1; i <= b; i++) rates.push(Math.abs(points[i].heading - points[i - 1].heading) / Math.max(1e-3, points[i].time - points[i - 1].time));
    // The quickest swing leaves out the odd spike a stray keypoint makes.
    const peak = [...rates].sort((p, q) => p - q)[Math.floor(rates.length * .9)];
    let quick = 0, total = 0;
    for (let i = a + 1; i <= b; i++) {
      const dt = points[i].time - points[i - 1].time;
      total += dt;
      if (rates[i - a - 1] >= peak / 2) quick += dt;
    }
    // The fall line is crossed halfway through the swing, where the turn is widest.
    const middle = (points[a].heading + points[b].heading) / 2;
    let apex = a;
    for (let i = a; i <= b; i++) if (Math.abs(points[i].heading - middle) < Math.abs(points[apex].heading - middle)) apex = i;
    found.push({ from: points[a].time, to: points[b].time, direction: points[b].heading > points[a].heading ? "right" : "left",
      apex: points[apex], evenness: total > 0 ? quick / total : 0, peakRate: peak * 180 / Math.PI });
  }
  // Linked turns reach to either side: a turn's width is how far its widest point is from its neighbours'.
  return found.map((turn, k) => {
    const gaps = [found[k - 1], found[k + 1]].filter(Boolean).map(other => Math.abs(other!.apex.x - turn.apex.x));
    return { ...turn, width: gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0 };
  });
}

/** The same measure on a heading curve sampled evenly through one turn, for the standard. */
export function curveEvenness(headingsDeg: readonly number[]) {
  const rates = headingsDeg.slice(1).map((value, i) => Math.abs(value - headingsDeg[i]));
  const peak = Math.max(...rates);
  return peak > 0 ? rates.filter(rate => rate >= peak / 2).length / rates.length : 0;
}
