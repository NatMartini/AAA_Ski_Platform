"""Fit a Motion to a demonstration group's median turn, as seen from the front."""
from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from csia_specs import PITCH, SPEED, Spec
from skier_model import Camera, INDEX, JOINTS, Motion, build_turn, project

HERE = Path(__file__).resolve().parent
PHASES = np.linspace(0, 1, 21)
FITTED_JOINTS = [name for name in JOINTS if name not in ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_smalltoe", "right_smalltoe")]
WEIGHTS = {"left_wrist": .5, "right_wrist": .5, "left_elbow": .4, "right_elbow": .4, "left_bigtoe": .9, "right_bigtoe": .9, "left_heel": .9, "right_heel": .9,
           "left_knee": 1.4, "right_knee": 1.4, "left_ankle": 1.4, "right_ankle": 1.4, "left_shoulder": 1.2, "right_shoulder": 1.2}

# name: (start, low, high). Angles in radians, lengths in metres, phases in turn fractions.
# A front view cannot see fore and aft, so those ranges come from how skiers stand: hips over the boots,
# shins pressed forward, trunk ahead of the hips.
FREE = {
    "theta": (.7, .1, 1.45), "theta_phase": (.5, .3, .7), "theta3": (0., -.25, .25),
    "lat": (.35, 0., .9), "lat_phase": (0., -.25, .25), "lat3": (0., -.2, .2), "lat3_phase": (0., -.33, .33),
    "height": (.85, .45, 1.02), "height2": (0., -.2, .2), "height2_phase": (0., -.5, .5),
    "fore": (-.04, -.12, .05), "fore2": (0., -.05, .05), "fore2_phase": (0., -.5, .5),
    "width": (.25, .1, .7), "width2": (0., -.25, .25), "width2_phase": (.5, 0., 1.),
    "lead": (.05, -.2, .25), "lead_phase": (0., -.3, .3),
    "knee": (.3, -.2, 1.2), "knee_phase": (0., -.3, .3),
    "pelvis_yaw": (.3, 0., 1.3), "pelvis_yaw_phase": (.5, .2, .8), "pelvis_roll": (.3, 0., .75), "pelvis_roll_phase": (0., -.3, .3),
    "torso_tilt": (.2, 0., .8), "torso_tilt_phase": (.1, -.25, .35), "torso_tilt3": (0., -.15, .15), "torso_tilt3_phase": (0., -.33, .33),
    "torso_pitch": (.42, .24, .9), "torso_pitch2": (0., -.2, .2), "torso_pitch2_phase": (0., -.5, .5),
    "shoulder_yaw": (.3, 0., 1.3), "shoulder_yaw_phase": (.5, .2, .8), "shoulder_roll": (.2, 0., .7), "shoulder_roll_phase": (0., -.35, .35),
    "shoulder_roll3": (0., -.15, .15), "shoulder_roll3_phase": (0., -.33, .33),
    "hand_reach": (.42, .2, .75), "hand_drop": (.33, .1, .55), "hand_shift": (0., -.2, .2), "hand_shift_phase": (0., -.5, .5), "hand_turn": (0., -.15, .15),
}
# Pull weak channels back toward no movement rather than fitting the medians' noise.
PRIOR = {"theta3": .25, "lat3": .25, "torso_tilt3": .25, "shoulder_roll3": .25, "height2": .05, "fore2": .15, "width2": .05, "hand_shift": .15, "hand_turn": .15, "lead": .2}
CAMERA_ELEVATION = (8., 0., 22.)
# Channels a guide's words define: the fit may adjust them around the spec's value but not lose them.
ACTION_FREE = {"wedge": (.3, .1, .8), "snow": (.1, 0., .3)}
ACTION_CAP = {"wedge": .05, "snow": .1}


def load_reference(path: Path = HERE / "reference" / "gold_turns.json") -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def gold_curve(group: dict) -> np.ndarray:
    return np.array([[[np.nan if v is None else v for v in joint] for joint in frame] for frame in group["curve"]], dtype=float)


def normalised_view(points: np.ndarray, camera: Camera) -> np.ndarray:
    """Front-view pose as the gold curves are stored: hips at the origin, in shoulder-to-ankle heights."""
    view = project(points, camera)
    hip = (view[:, INDEX["left_hip"]] + view[:, INDEX["right_hip"]]) / 2
    shoulder = (view[:, INDEX["left_shoulder"]] + view[:, INDEX["right_shoulder"]]) / 2
    ankle = (view[:, INDEX["left_ankle"]] + view[:, INDEX["right_ankle"]]) / 2
    height = np.median(np.linalg.norm(shoulder - ankle, axis=1))
    return (view - hip[:, None, :]) / height


def base_motion(spec: Spec, duration: float) -> Motion:
    motion = Motion(duration=duration, speed=SPEED[spec.speed] * spec.speed_share, travel=spec.travel)
    return replace(motion, **spec.extras)


def fit(spec: Spec, group: dict, duration: float):
    """(motion, camera elevation, rms error in shoulder-to-ankle heights)."""
    target = gold_curve(group)
    base = base_motion(spec, duration)
    free = dict(FREE)
    for name, value in spec.extras.items():
        if name in ACTION_FREE:
            start, low, high = ACTION_FREE[name]
            free[name] = (value, low, high)
    names = list(free)
    start = np.array([free[n][0] for n in names] + [CAMERA_ELEVATION[0]])
    lower = np.array([free[n][1] for n in names] + [CAMERA_ELEVATION[1]])
    upper = np.array([free[n][2] for n in names] + [CAMERA_ELEVATION[2]])
    slope = PITCH[spec.pitch]
    joints = [INDEX[n] for n in FITTED_JOINTS]
    weights = np.array([WEIGHTS.get(n, 1.) for n in FITTED_JOINTS])[None, :, None]
    known = np.isfinite(target[:, joints])
    prior_names = [(i, PRIOR[n]) for i, n in enumerate(names) if n in PRIOR]
    action_names = [(i, ACTION_CAP[n], spec.extras[n]) for i, n in enumerate(names) if n in ACTION_CAP]

    def motion_of(vector):
        return replace(base, **{n: float(v) for n, v in zip(names, vector)})

    def residual(vector):
        view = normalised_view(build_turn(motion_of(vector), PHASES), Camera(180., vector[-1], slope))
        diff = (view[:, joints] - target[:, joints]) * weights
        out = diff[known]
        extras = [strength * vector[i] * .1 for i, strength in prior_names]
        extras += [(vector[i] - value) * cap for i, cap, value in action_names]
        return np.concatenate([out, np.array(extras)]) if extras else out

    result = least_squares(residual, start, bounds=(lower, upper), x_scale=np.maximum(upper - lower, .1), max_nfev=120, ftol=1e-5, xtol=1e-5)
    motion = motion_of(result.x)
    view = normalised_view(build_turn(motion, PHASES), Camera(180., result.x[-1], slope))
    error = float(np.sqrt(np.nanmean((view[:, joints] - target[:, joints]) ** 2)))
    return motion, float(result.x[-1]), error
