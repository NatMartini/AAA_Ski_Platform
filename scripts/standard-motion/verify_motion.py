"""Score a standard motion with FreeSki's own turn detector, metric code and score card.

A run of linked turns is filmed by a simulated camera the way the demonstrations were: from the
front, following the skier with a lag, with the keypoint jitter measured on that group's gold poses.
The metrics come out of FreeSki's unmodified functions and `build_scorecard`, against the
demonstration group's per-turn distribution on the same edge-change cuts.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Mapping, Optional

import numpy as np

from skier_model import Camera, INDEX, JOINTS, Motion, build_run, project

METRICS = ("turn_tempo", "rotation_rate", "upper_body_quiet_index", "parallel_skis", "turn_closure",
           "turn_completion_direction", "rhythm_continuity", "edge_angle", "edge_change_sync", "flexion_range",
           "inner_ski_lift_pct")
# Jitter relative to the torso and leg joints, which is what the group's figure measures.
JITTER_SHARE = {"wrist": 1.05, "elbow": 1.05, "toe": 1.3, "heel": 1.3, "ear": .9, "eye": .9, "nose": .9}
FPS = 30.
SIZE_PX = 420.


@dataclass(frozen=True)
class Filming:
    """The nuisance a camera adds to the hip path in the picture; none of it belongs to the standard."""
    follow_x: float = .6           # seconds the panning lags the skier
    follow_y: float = .3
    path_elevation: float = 12.    # how much of the descent shows as movement down the picture, degrees
    jitter: float = .01            # keypoint noise, shoulder-to-ankle heights per frame


def _freeski(server: Path):
    if str(server) not in sys.path:
        sys.path.insert(0, str(server))
    from engines import scorecard
    from engines.scoring_engine import _load_action_rubric
    from engines.turn_detector import detect_turns
    from rubrics.metric_polarity_loader import get_polarity_map
    from shared.config import METRIC_DEFINITIONS
    return scorecard, detect_turns, {k: v.value for k, v in get_polarity_map().items()}, _load_action_rubric, METRIC_DEFINITIONS


def _lagging(series: np.ndarray, tau: float, dt: float) -> np.ndarray:
    out = np.zeros_like(series)
    out[0] = series[0]
    alpha = 1. - np.exp(-dt / max(tau, 1e-3))
    for i in range(1, len(series)):
        out[i] = out[i - 1] + (series[i] - out[i - 1]) * alpha
    return out


def film(motion: Motion, camera: Camera, filming: Filming, turns: int = 14, seed: Optional[int] = 7) -> np.ndarray:
    """(frames, 133, 3) keypoints in FreeSki's layout, as its pose pipeline would report the run."""
    _, frames, _ = build_run(motion, FPS, turns)
    centre = (frames[:, INDEX["left_ankle"]] + frames[:, INDEX["right_ankle"]]) / 2
    view = project(frames[:, :len(JOINTS)], camera)
    hip = (view[:, INDEX["left_hip"]] + view[:, INDEX["right_hip"]]) / 2
    shoulder = (view[:, INDEX["left_shoulder"]] + view[:, INDEX["right_shoulder"]]) / 2
    ankle = (view[:, INDEX["left_ankle"]] + view[:, INDEX["right_ankle"]]) / 2
    height = np.median(np.linalg.norm(shoulder - ankle, axis=1))
    # Descent toward the camera shows as movement down the picture.
    descent = centre[:, 1] * np.sin(np.radians(filming.path_elevation))
    view = view + np.stack([np.zeros(len(view)), descent], axis=1)[:, None, :]
    hip_y = hip[:, 1] + descent
    shot = np.stack([_lagging(hip[:, 0], filming.follow_x, 1 / FPS), _lagging(hip_y, filming.follow_y, 1 / FPS)], axis=1)
    pixels = (view - shot[:, None, :]) * (SIZE_PX / height) + np.array([960., 560.])
    if seed is not None and filming.jitter:
        rng = np.random.default_rng(seed)
        for j, name in enumerate(JOINTS):
            share = next((v for k, v in JITTER_SHARE.items() if k in name), 1.)
            pixels[:, j] += rng.normal(0., filming.jitter * share * SIZE_PX, (len(pixels), 2))
    keypoints = np.zeros((len(pixels), 133, 3))
    keypoints[:, :len(JOINTS), :2] = pixels
    keypoints[:, :len(JOINTS), 2] = .9
    return keypoints


def score_run(keypoints: np.ndarray, action: str, level: int, group: Mapping, server: Path,
              reference_key: Optional[str] = None) -> dict:
    """FreeSki's score card for the run's middle turns, against the group's distribution, with raw metric values."""
    scorecard, detect_turns, polarity, load_rubric, definitions = _freeski(server)
    turns = detect_turns(keypoints, fps=FPS, frame_width=1920)
    middle = [t for t in turns if t.partial is None]
    times = np.arange(len(keypoints)) / FPS
    direct, estimated = scorecard.scoring_metrics(keypoints, times, middle, FPS)
    calibration = {"calibration_id": "standard-motion-check", "reference_generation": "gold-edge-change", "clips": [],
                   "groups": {scorecard.group_key("certification", action, level, "pass"): {"clips": group["clips"], "turns": group["turns"], "metrics": group["metrics"]}}}
    card = scorecard.build_scorecard(
        action=action, level=level, path_type="certification", turns=middle, direct_metrics=direct, estimated_metrics=estimated,
        roles={t.turn_index: "middle" for t in middle}, weights=load_rubric(action, None)["weights"], polarity=polarity,
        calibration=calibration, units={k: d.get("unit", "") for k, d in definitions.items()}, pose_share=1.)
    rows = {}
    for metric in METRICS:
        values = [merged[metric] for t in middle
                  if metric in (merged := {**estimated.get(t.turn_index, {}), **direct.get(t.turn_index, {})})]
        stats = group["metrics"].get(metric)
        if not values or not stats:
            continue
        value = float(np.median(values))
        kind = polarity.get(metric, "higher")
        rows[metric] = {"value": round(value, 3), "p25": stats["q25"], "median": stats["q50"], "p75": stats["q75"], "polarity": kind,
                        "score": scorecard.metric_score(value, stats, kind)["score"], "band": scorecard.reference_band(value, stats, kind)}
    shown = {row["key"]: row for row in card["metrics"]}
    for metric, row in rows.items():
        row["counted"] = metric in shown and shown[metric]["weight"] > 0
        row["shown"] = metric in shown
    return {"turns": len(middle), "overall": card["overall"]["score"], "metrics": rows,
            "durations": [round(float(t.duration), 3) for t in middle][:4]}


def shortfall(result: Mapping, ignore: tuple = ()) -> float:
    """How far a run sits from the group's usual range, over the metrics the score card shows."""
    total = 0.
    for metric, row in result["metrics"].items():
        if metric in ignore:
            continue
        # Flexion and edging are read from every turn even where the action's card does not list them.
        weight = 1. if row.get("counted") else .6 if row.get("shown") or metric in ("flexion_range", "edge_angle") else 0.
        total += weight * (100. - row["score"]) ** 1.5 / 10.
    return total
