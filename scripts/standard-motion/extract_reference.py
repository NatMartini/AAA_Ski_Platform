"""What the CSIA gold demonstrations do through a turn, for fitting the standard motions.

Reads FreeSki's gold poses read-only and writes reference/gold_turns.json: for each demonstration
group the median turn (edge change to edge change, 21 phases, hips at the origin, in shoulder-to-ankle
heights, mirrored so every turn curves to the picture's left) and the per-turn metric distribution on
those same cuts, with the spread floors FreeSki's scorecard uses.

    python scripts/standard-motion/extract_reference.py --freeski J:/Freeski/FreeSkiclaude/server
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import logging
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
PHASES = np.linspace(0, 1, 21)
SWAP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 20, 21, 22, 17, 18, 19]
FLOOR_SHARE = .25


def turn_curve(keypoints, start, end, direction):
    part = keypoints[start:end + 1][:, :23]
    confidence = part[:, :, 2]
    if (confidence[:, [5, 6, 11, 12, 15, 16]] > .3).all(axis=1).mean() < .85:
        return None
    clock = np.linspace(0, 1, len(part))
    frames = np.full((len(PHASES), 23, 2), np.nan)
    for joint in range(23):
        seen = confidence[:, joint] > .3
        if seen.sum() >= len(part) * .5:
            for axis in (0, 1):
                frames[:, joint, axis] = np.interp(PHASES, clock[seen], part[seen, joint, axis])
    hip = (frames[:, 11] + frames[:, 12]) / 2
    shoulder = (frames[:, 5] + frames[:, 6]) / 2
    ankle = (frames[:, 15] + frames[:, 16]) / 2
    height = np.median(np.linalg.norm(shoulder - ankle, axis=1))
    if not height > 20:
        return None
    frames = (frames - hip[:, None, :]) / height
    if direction == "right":
        frames[:, :, 0] *= -1
        frames = frames[:, SWAP]
    return frames


def pose_jitter(keypoints, fps):
    """Frame-to-frame keypoint noise at 30 fps, in shoulder-to-ankle heights: robust second differences."""
    frames = keypoints[::max(1, int(round(fps / 30)))]
    seen = (frames[:, [5, 6, 15, 16], 2] > .3).all(axis=1)
    if seen.sum() < 30:
        return None
    height = np.median(np.abs((frames[seen, 15, 1] + frames[seen, 16, 1]) / 2 - (frames[seen, 5, 1] + frames[seen, 6, 1]) / 2))
    values = []
    for joint in (5, 6, 11, 12, 13, 14, 15, 16):
        good = (frames[:-2, joint, 2] > .3) & (frames[1:-1, joint, 2] > .3) & (frames[2:, joint, 2] > .3)
        if good.sum() > 20:
            second = (frames[2:, joint, :2] - 2 * frames[1:-1, joint, :2] + frames[:-2, joint, :2])[good]
            values.append(np.median(np.abs(second)) / (.6745 * np.sqrt(6)) / height)
    return float(np.median(values)) if values else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--freeski", type=Path, default=Path("J:/Freeski/FreeSkiclaude/server"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.ERROR)
    sys.path.insert(0, str(args.freeski))
    from engines import scorecard
    from scripts.build_scorecard_calibration import load_gold

    groups = defaultdict(lambda: {"curves": [], "values": defaultdict(list), "clips": 0, "durations": [], "apex": [], "jitter": []})
    pooled = defaultdict(list)
    for clip in load_gold():
        jitter = pose_jitter(clip.keypoints, clip.fps)
        turns = scorecard.shot_turns(clip.keypoints, clip.fps, clip.width, clip.decisions)
        evidence = scorecard.turn_evidence(clip.keypoints, turns, width=clip.width, height=clip.height,
                                           decisions=clip.decisions, candidates=clip.candidates)
        times = np.arange(len(clip.keypoints)) / clip.fps
        direct, estimated = scorecard.scoring_metrics(clip.keypoints, times, turns, clip.fps)
        group = groups[f"{clip.action}|{clip.level}|{clip.label}"]
        used = 0
        for turn in turns:
            if evidence.get(turn.turn_index) or turn.turn_index not in direct:
                continue
            used += 1
            for metric, value in {**estimated.get(turn.turn_index, {}), **direct[turn.turn_index]}.items():
                group["values"][metric].append(value)
                pooled[metric].append(value)
            group["durations"].append(turn.duration)
            group["apex"].append((turn.apex_frame - turn.start_frame) / max(1, turn.end_frame - turn.start_frame))
            curve = turn_curve(clip.keypoints, turn.start_frame, turn.end_frame, turn.direction)
            if curve is not None:
                group["curves"].append(curve)
        group["clips"] += 1 if used else 0
        if used and jitter is not None:
            group["jitter"].append(jitter)
        print(clip.name, used, flush=True)

    floors = {metric: FLOOR_SHARE * float(np.subtract(*np.percentile(values, [75, 25]))) / 1.349
              for metric, values in pooled.items()}
    out = {"phases": PHASES.tolist(), "groups": {}}
    for key, group in sorted(groups.items()):
        if not group["curves"]:
            continue
        metrics = {metric: scorecard.distribution(values, floors[metric]) for metric, values in sorted(group["values"].items())
                   if len(values) >= 3}
        for stats in metrics.values():
            stats.pop("values")
            for name, value in stats.items():
                stats[name] = round(value, 5) if isinstance(value, float) else value
        curve = np.nanmedian(np.stack(group["curves"]), axis=0)
        out["groups"][key] = {"clips": group["clips"], "turns": len(group["curves"]),
                              "duration": round(float(np.median(group["durations"])), 3),
                              "apex": round(float(np.median(group["apex"])), 3),
                              "jitter": round(float(np.median(group["jitter"])), 5) if group["jitter"] else None,
                              "metrics": metrics,
                              "curve": [[[None if np.isnan(v) else round(float(v), 4) for v in joint] for joint in frame] for frame in curve]}
    (HERE / "reference").mkdir(exist_ok=True)
    (HERE / "reference" / "gold_turns.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("groups", len(out["groups"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
