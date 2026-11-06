"""A 3D kinematic skier for one right turn, edge change to edge change.

Every channel is a short Fourier series over the turn phase phi in [0, 1]: a channel that changes
sign with the turn direction (heading, lean, roll) uses odd harmonics of pi, one that does not
(height, stance) uses even harmonics. The next turn is this turn mirrored, so a run of any length
joins without a seam. Bones keep their length: legs and arms are solved with two-bone IK.

Coordinates are slope coordinates: u across the slope (+u is the skier's right looking downhill),
v down the fall line, w along the slope normal. Metres.
"""
from __future__ import annotations

from dataclasses import dataclass, field, fields, replace

import numpy as np

JOINTS = ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder",
          "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip",
          "left_knee", "right_knee", "left_ankle", "right_ankle", "left_bigtoe", "left_smalltoe", "left_heel",
          "right_bigtoe", "right_smalltoe", "right_heel")
SKI_POINTS = ("left_ski_tip_a", "left_ski_tip_b", "left_ski_tail_a", "left_ski_tail_b",
              "right_ski_tip_a", "right_ski_tip_b", "right_ski_tail_a", "right_ski_tail_b")
POLE_POINTS = ("left_pole_tip", "right_pole_tip")
POINTS = JOINTS + SKI_POINTS + POLE_POINTS
INDEX = {name: i for i, name in enumerate(POINTS)}


@dataclass(frozen=True)
class Body:
    shin: float = .43
    thigh: float = .44
    hip_width: float = .22
    spine: float = .53
    shoulder_width: float = .37
    upper_arm: float = .29
    forearm: float = .27
    neck: float = .21          # shoulder centre to head centre
    ankle_height: float = .15  # ankle above the ski base: binding plus boot
    heel_back: float = .09
    toe_front: float = .16
    ski_length: float = 1.70
    ski_width: float = .09
    ski_tip_forward: float = .90  # binding sits a little behind the ski's middle
    pole_length: float = 1.20


BODY = Body()


@dataclass(frozen=True)
class Motion:
    """One turn's channels. Angles in radians, lengths in metres, phases in turn fractions."""
    duration: float = 2.0          # seconds, edge change to edge change
    speed: float = 9.0             # m/s along the path
    # Ski heading from the fall line: -theta at the edge change in, +theta at the edge change out.
    theta: float = .8
    theta_phase: float = .5
    theta3: float = 0.
    theta3_phase: float = .5
    # Travel direction relative to the heading: 1 follows the ski (carved), 0 runs down the fall line (skidded).
    travel: float = .85
    travel_lag: float = .03
    # Hip centre relative to the feet, in the skis' own frame (right, forward, normal).
    lat: float = .35
    lat_phase: float = 0.
    lat3: float = 0.
    lat3_phase: float = 0.
    height: float = .85
    height2: float = 0.
    height2_phase: float = 0.
    height4: float = 0.
    height4_phase: float = 0.
    fore: float = -.05
    fore2: float = 0.
    fore2_phase: float = 0.
    # Feet: distance between foot centres, and the inside foot's lead.
    width: float = .24
    width2: float = 0.
    width2_phase: float = .5
    lead: float = .05
    lead_phase: float = 0.
    # Knees steer toward the turn's centre.
    knee: float = .35
    knee_phase: float = 0.
    knee_forward: float = .0
    # Pelvis.
    pelvis_yaw: float = .4
    pelvis_yaw_phase: float = .5
    pelvis_roll: float = .3
    pelvis_roll_phase: float = 0.
    pelvis_pitch: float = .35
    # Torso.
    torso_tilt: float = .2
    torso_tilt_phase: float = .1
    torso_tilt3: float = 0.
    torso_tilt3_phase: float = 0.
    torso_pitch: float = .35
    torso_pitch2: float = 0.
    torso_pitch2_phase: float = 0.
    # Shoulder line.
    shoulder_yaw: float = .2
    shoulder_yaw_phase: float = .5
    shoulder_roll: float = .2
    shoulder_roll_phase: float = 0.
    shoulder_roll3: float = 0.
    shoulder_roll3_phase: float = 0.
    # Hands, in the shoulders' frame.
    hand_reach: float = .42
    hand_forward: float = .32
    hand_drop: float = .33
    hand_shift: float = 0.
    hand_shift_phase: float = 0.
    hand_turn: float = 0.          # inside hand lower than outside hand
    pole_plant: float = .92        # phase of the next inside pole's plant; None-like when strength is 0
    pole_strength: float = 1.
    # Action-specific movements. Each is 0 for ordinary parallel turns.
    wedge: float = 0.              # intro to parallel: tip-in angle before the skis match
    wedge_opens: float = .08
    wedge_full: float = .25
    wedge_matches: float = .72     # phase where the skis are parallel again, below the fall line
    inside_lift: float = 0.        # javelin and hop turns: the inside ski held off the snow
    lift_from: float = .08
    lift_to: float = .85
    lift_cross: float = 0.         # javelin: the lifted ski's heading held while the outside ski steers under it
    hop: float = 0.                # hop turns: both skis off the snow around the edge change
    hop_half: float = .08
    snow: float = 0.               # bumps: snow height relative to the slope, highest at the edge change
    snow_phase: float = 0.


def tunable(motion: Motion):
    return [f.name for f in fields(motion)]


def _odd(phi, a, phase, a3=0., phase3=0.):
    return a * np.sin(np.pi * (phi - phase)) + a3 * np.sin(3 * np.pi * (phi - phase3))


def _even(phi, base, a2=0., phase2=0., a4=0., phase4=0.):
    return base + a2 * np.cos(2 * np.pi * (phi - phase2)) + a4 * np.cos(4 * np.pi * (phi - phase4))


def _smooth(x):
    x = np.clip(x, 0., 1.)
    return x * x * (3 - 2 * x)


def _heading(psi):
    return np.stack([np.sin(psi), np.cos(psi), np.zeros_like(psi)], axis=-1)


def _right(psi):
    return np.stack([np.cos(psi), -np.sin(psi), np.zeros_like(psi)], axis=-1)


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


UP = np.array([0., 0., 1.])
LEG_PASSES = 5
# A skier's knees and elbows are never locked: legs and arms stop short of straight.
LEG_REACH = .975
ARM_REACH = .94


def _two_bone(root, end, first, second, pole):
    """The middle joint of root -> middle -> end, bending toward `pole`. `first` is root-middle."""
    axis = end - root
    distance = np.linalg.norm(axis, axis=-1, keepdims=True)
    reach = np.minimum(distance, first + second - 1e-3)
    axis = axis / np.maximum(distance, 1e-9)
    along = (first ** 2 - second ** 2 + reach ** 2) / (2 * reach)
    side = np.sqrt(np.maximum(first ** 2 - along ** 2, 0.))
    bend = _unit(pole - np.sum(pole * axis, axis=-1, keepdims=True) * axis)
    return root + axis * along + bend * side


def path_centre(motion: Motion, phi: np.ndarray):
    """Where the feet's centre is on the snow, with the turn starting at the origin."""
    grid = np.linspace(0., 1., 801)
    tau = motion.travel * heading_angle(motion, grid - motion.travel_lag)
    step = motion.speed * motion.duration * (grid[1] - grid[0])
    du = np.sin(tau) * step
    dv = np.cos(tau) * step
    u = np.concatenate([[0.], np.cumsum((du[1:] + du[:-1]) / 2)])
    v = np.concatenate([[0.], np.cumsum((dv[1:] + dv[:-1]) / 2)])
    return np.stack([np.interp(phi, grid, u), np.interp(phi, grid, v), np.zeros_like(phi)], axis=-1)


def heading_angle(motion: Motion, phi: np.ndarray):
    return _odd(phi, motion.theta, motion.theta_phase, motion.theta3, motion.theta3_phase)


def _wedge_angle(m: Motion, phi):
    """Tip-in angle: outside ski steered at initiation, inside ski matching below the fall line."""
    if not m.wedge:
        return np.zeros_like(phi)
    opening = _smooth((phi - m.wedge_opens) / max(1e-3, m.wedge_full - m.wedge_opens))
    closing = 1. - _smooth((phi - m.wedge_full) / max(1e-3, m.wedge_matches - m.wedge_full))
    return m.wedge * opening * closing


def _lift_window(m: Motion, phi):
    if not m.inside_lift:
        return np.zeros_like(phi)
    ramp = max(.04, (m.lift_to - m.lift_from) * .22)
    return _smooth((phi - m.lift_from) / ramp) * (1. - _smooth((phi - (m.lift_to - ramp)) / ramp))


def _hop_height(m: Motion, phi):
    if not m.hop:
        return np.zeros_like(phi)
    # Around the edge change at either end of the turn.
    x = np.minimum(np.abs(phi), np.abs(1. - phi)) / m.hop_half
    return m.hop * np.clip(1. - x * x, 0., 1.)


def _plant_bump(m: Motion, x):
    """How far a hand has reached for its pole plant; x is the phase after the plant instant."""
    rise = _smooth((x + .22) / .22)
    fall = 1. - _smooth(x / .22)
    return rise * fall * m.pole_strength


def build_turn(motion: Motion, phi: np.ndarray, body: Body = BODY, channels: dict | None = None) -> np.ndarray:
    """All POINTS for a right turn at phases `phi`: an array (len(phi), len(POINTS), 3).

    `channels`, when given, is filled with the readable curves behind the points.
    """
    m, b = motion, body
    phi = np.asarray(phi, dtype=float)
    psi = heading_angle(m, phi)
    h, r = _heading(psi), _right(psi)
    centre = path_centre(m, phi)
    snow = _even(phi, 0., m.snow, m.snow_phase)
    centre[:, 2] = snow

    # Feet and skis. The right foot is on the +right side in both turns; the inside foot leads.
    width = _even(phi, m.width, m.width2, m.width2_phase)[:, None]
    lead = _odd(phi, m.lead, m.lead_phase)[:, None]
    wedge = _wedge_angle(m, phi)
    window = _lift_window(m, phi)
    psi_left = psi + wedge / 2
    psi_right = psi - wedge / 2 - window * m.lift_cross
    hop = _hop_height(m, phi)
    lift_right = window * m.inside_lift + hop
    lift_left = hop
    foot_left = centre - r * width / 2 - h * lead / 2 + UP * lift_left[:, None]
    foot_right = centre + r * width / 2 + h * lead / 2 + UP * lift_right[:, None]

    # Hips.
    lateral = _odd(phi, m.lat, m.lat_phase, m.lat3, m.lat3_phase)[:, None]
    fore = _even(phi, m.fore, m.fore2, m.fore2_phase)[:, None]
    height = _even(phi, m.height, m.height2, m.height2_phase, m.height4, m.height4_phase)[:, None]
    # The hips ride above the snow's average, so bumps are absorbed by the legs.
    pelvis = centre * np.array([1., 1., 0.]) + r * lateral + h * fore + UP * height + UP * hop[:, None] * .6
    yaw_p = _odd(phi, m.pelvis_yaw, m.pelvis_yaw_phase)
    roll_p = _odd(phi, m.pelvis_roll, m.pelvis_roll_phase)
    f_p, r_p = _heading(yaw_p), _right(yaw_p)
    cp, sp = np.cos(m.pelvis_pitch), np.sin(m.pelvis_pitch)
    u_p = UP * cp + f_p * sp
    hip_axis = r_p * np.cos(roll_p)[:, None] - u_p * np.sin(roll_p)[:, None]
    hip_left = pelvis - hip_axis * b.hip_width / 2
    hip_right = pelvis + hip_axis * b.hip_width / 2

    # A boot, its binding and its ski are one rigid piece that rolls with the shin, low edge on the snow, so
    # the ankle sits above the ski along the ski's normal. The roll depends on the shin, so this settles in a few passes.
    def ski_normal(psi_ski, roll):
        return UP * np.cos(roll)[:, None] + _right(psi_ski) * np.sin(roll)[:, None]

    def ski_base(foot, roll):
        return foot + UP * (b.ski_width / 2 * np.abs(np.sin(roll)))[:, None]

    def shin_roll(knee, ankle, psi_ski):
        shin = _unit(knee - ankle)
        return np.arctan2(np.sum(shin * _right(psi_ski), axis=-1), np.maximum(shin[:, 2], 1e-6))

    steer = _odd(phi, m.knee, m.knee_phase)
    pole = h * np.cos(steer)[:, None] + r * np.sin(steer)[:, None] + h * m.knee_forward
    roll_l, roll_r = np.zeros_like(phi), np.zeros_like(phi)
    pelvis_free, hip_left_free, hip_right_free = pelvis, hip_left, hip_right
    for settle in range(LEG_PASSES):
        # Ankles sit above the boots; shins and thighs from two-bone IK, knees steered toward the turn.
        ankle_left = ski_base(foot_left, roll_l) + ski_normal(psi_left, roll_l) * b.ankle_height - _heading(psi_left) * .02
        ankle_right = ski_base(foot_right, roll_r) + ski_normal(psi_right, roll_r) * b.ankle_height - _heading(psi_right) * .02
        pelvis, hip_left, hip_right = pelvis_free, hip_left_free, hip_right_free
        # A hip out of a leg's reach comes back along that leg, so the bones keep their length.
        for _ in range(3):
            for hip, ankle in ((hip_left, ankle_left), (hip_right, ankle_right)):
                leg = hip - ankle
                length = np.linalg.norm(leg, axis=-1, keepdims=True)
                pull = leg / np.maximum(length, 1e-9) * np.maximum(length - (b.shin + b.thigh) * LEG_REACH, 0.)
                pelvis, hip_left, hip_right = pelvis - pull, hip_left - pull, hip_right - pull
        knee_left = _two_bone(ankle_left, hip_left, b.shin, b.thigh, pole)
        knee_right = _two_bone(ankle_right, hip_right, b.shin, b.thigh, pole)
        if settle < LEG_PASSES - 1:
            roll_l = (roll_l + shin_roll(knee_left, ankle_left, psi_left)) / 2
            roll_r = (roll_r + shin_roll(knee_right, ankle_right, psi_right)) / 2

    # Torso and shoulder line.
    yaw_s = _odd(phi, m.shoulder_yaw, m.shoulder_yaw_phase)
    f_s, r_s = _heading(yaw_s), _right(yaw_s)
    tilt = _odd(phi, m.torso_tilt, m.torso_tilt_phase, m.torso_tilt3, m.torso_tilt3_phase)
    pitch = _even(phi, m.torso_pitch, m.torso_pitch2, m.torso_pitch2_phase)
    u_t = _unit(UP * (np.cos(pitch) * np.cos(tilt))[:, None] + f_s * np.sin(pitch)[:, None]
                + r_s * (np.sin(tilt) * np.cos(pitch))[:, None])
    shoulder_centre = pelvis + u_t * b.spine
    roll_s = _odd(phi, m.shoulder_roll, m.shoulder_roll_phase, m.shoulder_roll3, m.shoulder_roll3_phase)
    axis_s = _unit(r_s * np.cos(roll_s)[:, None] - UP * np.sin(roll_s)[:, None])
    shoulder_left = shoulder_centre - axis_s * b.shoulder_width / 2
    shoulder_right = shoulder_centre + axis_s * b.shoulder_width / 2

    # Head: quieter than the shoulders, looking where the skier is going.
    u_h = _unit(u_t * .45 + UP * .55)
    yaw_h = yaw_s * .6
    f_h, r_h = _heading(yaw_h), _right(yaw_h)
    head = shoulder_centre + u_h * b.neck
    nose = head + f_h * .10 - u_h * .015
    eye_left = head + f_h * .085 - r_h * .032 + u_h * .02
    eye_right = head + f_h * .085 + r_h * .032 + u_h * .02
    ear_left = head - r_h * .075
    ear_right = head + r_h * .075

    # Hands and poles. The hand about to plant reaches forward and a little down.
    shift = _odd(phi, m.hand_shift, m.hand_shift_phase)[:, None]
    inside_low = _odd(phi, m.hand_turn, 0.)[:, None]
    plant_left = _plant_bump(m, phi - m.pole_plant)[:, None]      # left is the next turn's inside hand
    plant_right = _plant_bump(m, phi + 1. - m.pole_plant)[:, None]
    hand_left = (shoulder_centre - r_s * m.hand_reach + r_s * shift + f_s * m.hand_forward - u_t * m.hand_drop
                 + UP * inside_low + f_s * .10 * plant_left)
    hand_right = (shoulder_centre + r_s * m.hand_reach + r_s * shift + f_s * m.hand_forward - u_t * m.hand_drop
                  - UP * inside_low + f_s * .10 * plant_right)

    def within_reach(hand, shoulder):
        arm = hand - shoulder
        length = np.linalg.norm(arm, axis=-1, keepdims=True)
        return shoulder + arm * np.minimum(1., (b.upper_arm + b.forearm) * ARM_REACH / np.maximum(length, 1e-9))

    hand_left, hand_right = within_reach(hand_left, shoulder_left), within_reach(hand_right, shoulder_right)
    elbow_left = _two_bone(shoulder_left, hand_left, b.upper_arm, b.forearm, -r_s - UP * .8 - f_s * .3)
    elbow_right = _two_bone(shoulder_right, hand_right, b.upper_arm, b.forearm, r_s - UP * .8 - f_s * .3)

    def pole_tip(hand, side, plant):
        trailing = _unit(-f_s * .66 + side * .22 - UP * .72)
        planted = _unit(f_s * .34 + side * .26 - UP * .90)
        direction = _unit(trailing * (1. - plant) + planted * plant)
        # A pole is rigid: where it would go into the snow it swings up instead.
        drop = np.minimum((hand[:, 2] - snow) / b.pole_length, 1.)
        steep = -direction[:, 2] > drop
        flat = np.sqrt(np.maximum(1. - drop ** 2, 0.)) / np.maximum(np.linalg.norm(direction[:, :2], axis=1), 1e-9)
        direction[steep, 0] *= flat[steep]
        direction[steep, 1] *= flat[steep]
        direction[steep, 2] = -drop[steep]
        return hand + direction * b.pole_length

    pole_left = pole_tip(hand_left, -r_s, plant_left)
    pole_right = pole_tip(hand_right, r_s, plant_right)

    # Skis roll with the shin's sideways tilt: the boot locks them together, so both change edge together.
    def foot_points(foot, psi_ski, roll, outer):
        h_s, r_ski = _heading(psi_ski), _right(psi_ski)
        normal = ski_normal(psi_ski, roll)
        across = r_ski * np.cos(roll)[:, None] - UP * np.sin(roll)[:, None]
        base = ski_base(foot, roll)
        heel = base - h_s * b.heel_back + normal * .03
        toe = base + h_s * b.toe_front + normal * .03 - across * outer * .02
        little = base + h_s * b.toe_front * .8 + normal * .03 + across * outer * .05
        half = b.ski_width / 2
        tip = base + h_s * b.ski_tip_forward
        tail = base - h_s * (b.ski_length - b.ski_tip_forward)
        # "a" is the ski's outer corner, so a mirrored turn maps a to a.
        side = across * outer * half
        return heel, toe, little, tip + side, tip - side, tail + side, tail - side

    heel_l, toe_l, small_l, tip_la, tip_lb, tail_la, tail_lb = foot_points(foot_left, psi_left, roll_l, -1.)
    heel_r, toe_r, small_r, tip_ra, tip_rb, tail_ra, tail_rb = foot_points(foot_right, psi_right, roll_r, 1.)

    points = {
        "nose": nose, "left_eye": eye_left, "right_eye": eye_right, "left_ear": ear_left, "right_ear": ear_right,
        "left_shoulder": shoulder_left, "right_shoulder": shoulder_right, "left_elbow": elbow_left, "right_elbow": elbow_right,
        "left_wrist": hand_left, "right_wrist": hand_right, "left_hip": hip_left, "right_hip": hip_right,
        "left_knee": knee_left, "right_knee": knee_right, "left_ankle": ankle_left, "right_ankle": ankle_right,
        "left_bigtoe": toe_l, "left_smalltoe": small_l, "left_heel": heel_l,
        "right_bigtoe": toe_r, "right_smalltoe": small_r, "right_heel": heel_r,
        "left_ski_tip_a": tip_la, "left_ski_tip_b": tip_lb, "left_ski_tail_a": tail_la, "left_ski_tail_b": tail_lb,
        "right_ski_tip_a": tip_ra, "right_ski_tip_b": tip_rb, "right_ski_tail_a": tail_ra, "right_ski_tail_b": tail_rb,
        "left_pole_tip": pole_left, "right_pole_tip": pole_right,
    }
    frames = np.stack([points[name] for name in POINTS], axis=1)
    if channels is not None:
        pole_mid = (foot_left + foot_right) / 2
        pelvis_up = pelvis - pole_mid
        channels.update({
            "headingDeg": np.degrees(psi), "travelDeg": np.degrees(m.travel * heading_angle(m, phi - m.travel_lag)),
            "leftEdgeDeg": np.degrees(roll_l), "rightEdgeDeg": np.degrees(roll_r),
            "bodyLeanDeg": np.degrees(np.arctan2(np.sum(pelvis_up * r, axis=-1), pelvis_up[:, 2])),
            "torsoTiltDeg": np.degrees(tilt), "pelvisYawDeg": np.degrees(yaw_p), "shoulderYawDeg": np.degrees(yaw_s),
            "pelvisRollDeg": np.degrees(roll_p), "shoulderRollDeg": np.degrees(roll_s),
            "hipHeightM": pelvis[:, 2] - snow, "stanceWidthM": width[:, 0], "insideLiftM": lift_right - hop, "hopM": hop,
            "wedgeDeg": np.degrees(wedge + window * m.lift_cross), "snowHeightM": snow,
            "shinTiltLeftDeg": np.degrees(np.arctan2(np.linalg.norm(knee_left[:, :2] - ankle_left[:, :2], axis=1), (knee_left - ankle_left)[:, 2])),
            "shinTiltRightDeg": np.degrees(np.arctan2(np.linalg.norm(knee_right[:, :2] - ankle_right[:, :2], axis=1), (knee_right - ankle_right)[:, 2])),
        })
    return frames


MIRROR = np.array([INDEX[name.replace("left_", "\0").replace("right_", "left_").replace("\0", "right_")] for name in POINTS])


def mirrored(points: np.ndarray) -> np.ndarray:
    """The same frames as a left turn: u flips and left and right swap."""
    out = points[:, MIRROR].copy()
    out[:, :, 0] *= -1
    return out


def build_run(motion: Motion, fps: float, turns: int, body: Body = BODY, lead_in: float = 0.):
    """A run of alternating turns on a uniform clock: (frames, POINTS, 3) and the frame time of each edge change."""
    duration = motion.duration
    times = np.arange(0., duration * turns + lead_in + 1e-9, 1. / fps)
    frames = np.zeros((len(times), len(POINTS), 3))
    origin = np.zeros(3)
    edges = []
    for index in range(turns):
        start = lead_in + index * duration
        edges.append(start)
        mask = (times >= start - 1e-9) & (times < start + duration - 1e-9)
        phi = (times[mask] - start) / duration
        part = build_turn(motion, phi, body)
        end = build_turn(motion, np.array([1.]), body)
        if index % 2:
            part, end = mirrored(part), mirrored(end)
        # Continue from where the previous turn's feet ended (slope plane only).
        frames[mask] = part + origin
        foot_end = path_centre(motion, np.array([1.]))[0]
        if index % 2:
            foot_end = foot_end * np.array([-1., 1., 1.])
        origin = origin + foot_end
    edges.append(lead_in + turns * duration)
    keep = times <= lead_in + turns * duration - 1. / fps / 2
    return times[keep], frames[keep], edges


@dataclass(frozen=True)
class Camera:
    azimuth: float = 180.      # degrees about the slope normal: 0 from behind, 180 from the front
    elevation: float = 8.      # degrees above the slope plane
    slope: float = 18.         # slope pitch; the picture's up follows gravity


def camera_axes(camera: Camera):
    a, e, s = np.radians(camera.azimuth), np.radians(camera.elevation), np.radians(camera.slope)
    forward = np.array([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), -np.sin(e)])
    world_up = np.array([0., -np.sin(s), np.cos(s)])
    up = _unit(world_up - np.dot(world_up, forward) * forward)
    right = np.cross(forward, up)
    return right, up, forward


def project(points: np.ndarray, camera: Camera) -> np.ndarray:
    """Orthographic picture coordinates: x to the picture's right, y down the picture. Metres."""
    right, up, _ = camera_axes(camera)
    return np.stack([points @ right, -(points @ up)], axis=-1)


__all__ = ["BODY", "Body", "Camera", "INDEX", "JOINTS", "MIRROR", "Motion", "POINTS", "POLE_POINTS", "SKI_POINTS",
           "build_run", "build_turn", "camera_axes", "field", "heading_angle", "mirrored", "path_centre", "project",
           "replace", "tunable"]
