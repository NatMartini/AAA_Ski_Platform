"""The skier the 3D stage draws: a person in ski clothes, with boots, skis and poles.

Every garment is a distance field around the bones of a skiing stance, folds included. Each is meshed
with marching cubes, reduced to as many vertices as it needs, darkened where the others shade it, and
weighted to the bones. The bones are the ones src/lib/freeski/skier-rig.ts computes from a motion's points.

    python scripts/standard-motion/build_skier_mesh.py

Output: public/standard-motions/skier-mesh.bin, read by src/components/booking/skier-stage.ts.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import struct
import sys
from typing import Callable

from numba import njit
import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import map_coordinates
from skimage.measure import marching_cubes

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[1]

from skier_model import BODY, INDEX, Motion, POINTS, build_turn  # noqa: E402

OUT = ROOT / "public" / "standard-motions" / "skier-mesh.bin"
POSITION_SCALE = 8192
BONES = ("pelvis", "abdomen", "chest", "neck", "head",
         "left_upper_arm", "left_forearm", "left_hand", "right_upper_arm", "right_forearm", "right_hand",
         "left_thigh", "left_shin", "left_foot", "right_thigh", "right_shin", "right_foot", "left_pole", "right_pole")
BONE = {name: i for i, name in enumerate(BONES)}
SIDES = {"left": -1., "right": 1.}

# The stance the clothes are modelled in, so the folds are right when the skier is skiing.
STANCE = Motion(duration=1., speed=0., theta=0., lat=0., height=.86, fore=-.07, width=.24, lead=0., knee=0., pelvis_yaw=0., pelvis_roll=0.,
                pelvis_pitch=.3, torso_tilt=0., torso_pitch=.38, shoulder_yaw=0., shoulder_roll=0., hand_reach=.41, hand_forward=.29, hand_drop=.29, pole_strength=0.)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def dot(a, b):
    return np.sum(a * b, axis=-1)


def step(low, high, x):
    t = np.clip((x - low) / (high - low), 0., 1.)
    return t * t * (3. - 2. * t)


def smin(a, b, k):
    h = np.clip(.5 + .5 * (b - a) / k, 0., 1.)
    return b + (a - b) * h - k * h * (1. - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


NOISE_TABLE = np.random.default_rng(7).random(1 << 16)


def noise(p):
    """Value noise in [0, 1]."""
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3. - 2. * f)

    def corner(dx, dy, dz):
        return NOISE_TABLE[(((i[..., 0] + dx) * 73856093) ^ ((i[..., 1] + dy) * 19349663) ^ ((i[..., 2] + dz) * 83492791)) & 0xffff]

    x00 = corner(0, 0, 0) + (corner(1, 0, 0) - corner(0, 0, 0)) * f[..., 0]
    x10 = corner(0, 1, 0) + (corner(1, 1, 0) - corner(0, 1, 0)) * f[..., 0]
    x01 = corner(0, 0, 1) + (corner(1, 0, 1) - corner(0, 0, 1)) * f[..., 0]
    x11 = corner(0, 1, 1) + (corner(1, 1, 1) - corner(0, 1, 1)) * f[..., 0]
    y0 = x00 + (x10 - x00) * f[..., 1]
    y1 = x01 + (x11 - x01) * f[..., 1]
    return y0 + (y1 - y0) * f[..., 2]


def fbm(p, octaves=3):
    """Layered noise in about [-1, 1]."""
    total, weight, sum_weight = 0., 1., 0.
    for k in range(octaves):
        total = total + weight * noise(p * 2 ** k + k * 17.13)
        sum_weight += weight
        weight *= .5
    return total / sum_weight * 2. - 1.


def ellipsoid(q, radii):
    r = np.asarray(radii)
    k0 = np.linalg.norm(q / r, axis=-1)
    k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1.) / np.maximum(k1, 1e-9)


def rbox(q, half, r):
    d = np.abs(q) - (np.asarray(half) - r)
    return np.linalg.norm(np.maximum(d, 0.), axis=-1) + np.minimum(np.max(d, axis=-1), 0.) - r


def round_cone(p, a, b, ra, rb):
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    ba = b - a
    l2 = dot(ba, ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1. / l2
    pa = p - a
    y = dot(pa, ba)
    z = y - l2
    w = pa * l2 - ba[None] * y[..., None] if p.ndim > 1 else pa * l2 - ba * y
    x2 = dot(w, w)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    return np.where(np.sign(z) * a2 * z2 > k, np.sqrt(x2 + z2) * il2 - rb,
                    np.where(np.sign(y) * a2 * y2 < k, np.sqrt(x2 + y2) * il2 - ra, (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra))


class Frame:
    """An origin and three axes: points go to and from its local coordinates."""

    def __init__(self, origin, x, y, z):
        self.o, self.x, self.y, self.z = np.asarray(origin, dtype=float), np.asarray(x), np.asarray(y), np.asarray(z)

    def local(self, p):
        q = p - self.o
        return np.stack([dot(q, self.x), dot(q, self.y), dot(q, self.z)], axis=-1)

    def world(self, q):
        q = np.asarray(q, dtype=float)
        return self.o + q[..., :1] * self.x + q[..., 1:2] * self.y + q[..., 2:3] * self.z


class Loft:
    """A limb or trunk along a -> b with a changing cross-section. Stations: metres from a, half-width, half-depth, depth offset."""

    def __init__(self, a, b, front, stations, power=2.):
        self.a = np.asarray(a, dtype=float)
        self.z = unit(np.asarray(b, dtype=float) - self.a)
        self.y = unit(np.asarray(front, dtype=float) - dot(np.asarray(front, dtype=float), self.z) * self.z)
        self.x = np.cross(self.y, self.z)
        table = np.array([row if len(row) == 4 else (*row, 0.) for row in stations], dtype=float)
        self.t0, self.t1 = table[0, 0], table[-1, 0]
        self.grid = np.linspace(self.t0, self.t1, 256)
        self.rx = PchipInterpolator(table[:, 0], table[:, 1])(self.grid)
        self.ry = PchipInterpolator(table[:, 0], table[:, 2])(self.grid)
        self.oy = PchipInterpolator(table[:, 0], table[:, 3])(self.grid)
        self.power = power

    def along(self, p):
        return dot(p - self.a, self.z)

    def __call__(self, p):
        q = p - self.a
        t, x, y = dot(q, self.z), dot(q, self.x), dot(q, self.y)
        c = np.clip(t, self.t0, self.t1)
        rx, ry, oy = np.interp(c, self.grid, self.rx), np.interp(c, self.grid, self.ry), np.interp(c, self.grid, self.oy)
        n = self.power
        radial = ((np.abs(x) / rx) ** n + (np.abs(y - oy) / ry) ** n) ** (1. / n)
        dr = (radial - 1.) * np.minimum(rx, ry)
        dt = np.maximum(self.t0 - t, t - self.t1)
        return np.sqrt(np.maximum(dr, 0.) ** 2 + np.maximum(dt, 0.) ** 2) + np.minimum(np.maximum(dr, dt), 0.)


def ripple(p, centre, axis, wavelength, amount, reach, side=None, seed=0.):
    """Cloth bunching across a limb: ridges along `axis`, fading away from `centre`, optionally on one side only."""
    q = p - centre
    # Soft ridges with sharper valleys, as cloth folds have.
    wave = 1.2 - 2. * np.abs(np.sin(np.pi * dot(q, axis) / wavelength + fbm(p * 8. + seed, 2) * 1.8 + seed)) ** .7
    fade = np.exp(-dot(q, q) / (reach * reach))
    if side is not None:
        flat = q - dot(q, axis)[..., None] * axis
        fade = fade * step(-.25, .55, dot(unit(flat), side))
    return amount * wave * fade


# ------------------------------------------------------------------------------------------------
# The stance
# ------------------------------------------------------------------------------------------------

BIND = build_turn(STANCE, np.array([.5]), BODY)[0]
J = {name: BIND[i] for name, i in INDEX.items()}
X, Y, Z = np.eye(3)
HIPS = (J["left_hip"] + J["right_hip"]) / 2
SHOULDERS = (J["left_shoulder"] + J["right_shoulder"]) / 2
HEAD = (J["left_ear"] + J["right_ear"]) / 2
SPINE = float(np.linalg.norm(SHOULDERS - HIPS))
_spine_z = unit(SHOULDERS - HIPS)
TRUNK = Frame(HIPS, X, np.cross(_spine_z, X), _spine_z)
_head_x = unit(J["right_ear"] - J["left_ear"])
_head_z = unit(np.cross(_head_x, J["nose"] - HEAD))
SKULL = Frame(HEAD, _head_x, np.cross(_head_z, _head_x), _head_z)
NECK_AXIS = unit(HEAD - SHOULDERS)


def limb(side, top, middle, end):
    return J[f"{side}_{top}"], J[f"{side}_{middle}"], J[f"{side}_{end}"]


def hand_frame(side):
    """The fist closes around the pole: its first axis is the pole, its third points back up the forearm."""
    wrist, elbow, tip = J[f"{side}_wrist"], J[f"{side}_elbow"], J[f"{side}_pole_tip"]
    pole = unit(tip - wrist)
    back = unit((elbow - wrist) - dot(elbow - wrist, pole) * pole)
    return Frame(wrist, pole, np.cross(back, pole), back)


def ski_origin(side):
    return (J[f"{side}_ski_tip_a"] + J[f"{side}_ski_tip_b"] + J[f"{side}_ski_tail_a"] + J[f"{side}_ski_tail_b"]) / 4 - Y * (BODY.ski_tip_forward - BODY.ski_length / 2)


# ------------------------------------------------------------------------------------------------
# Trunk and arms: the jacket
# ------------------------------------------------------------------------------------------------

HEM_BACK, HEM_FRONT = -.165, -.095
JACKET_TRUNK = Loft(HIPS, SHOULDERS, TRUNK.y, [
    (-.18, .206, .165, -.016), (-.10, .198, .158, -.016), (.02, .182, .143, -.008), (.14, .172, .133, .0), (.26, .176, .133, .004),
    (.38, .190, .140, .008), (.47, .196, .134, .004), (.535, .178, .108, -.006), (.59, .122, .090, -.012), (.63, .092, .084, -.014), (.665, .082, .082, -.012)], power=2.35)


def hem_height(front):
    """How high the hem hangs along the trunk: a little higher in front."""
    return HEM_BACK + (HEM_FRONT - HEM_BACK) * step(-.06, .10, front)


def jacket_sleeve(side):
    shoulder, elbow, wrist = limb(side, "shoulder", "elbow", "wrist")
    # The crook of the arm faces the body, so "front" for the cross-section is across the bend.
    front = unit(np.cross(elbow - shoulder, wrist - elbow)) * SIDES[side]
    upper = Loft(shoulder, elbow, front, [(-.045, .070, .072), (.05, .073, .073), (.14, .066, .066), (.24, .058, .058), (.31, .054, .056)])
    fore = Loft(elbow, wrist, front, [(-.02, .054, .056), (.07, .056, .056), (.16, .051, .051), (.225, .047, .048), (.245, .049, .050)])
    deltoid = J[f"{side}_shoulder"] + X * SIDES[side] * .008 + Z * .002

    def field(p):
        return smin(smin(upper(p), fore(p), .018), np.linalg.norm(p - deltoid, axis=-1) - .075, .03)
    return field


JACKET_SLEEVES = {side: jacket_sleeve(side) for side in SIDES}
COLLAR = Loft(SHOULDERS - NECK_AXIS * .02, HEAD, TRUNK.y, [(.0, .092, .094, -.012), (.05, .082, .088, -.012), (.105, .075, .081, -.006), (.125, .073, .079, -.004), (.136, .068, .074, -.004)], power=2.2)
HOOD_CENTRE = SHOULDERS + NECK_AXIS * .055 - TRUNK.y * .088


def jacket_trunk_field(p):
    q = TRUNK.local(p)
    d = smax(JACKET_TRUNK(p), hem_height(q[..., 1]) - q[..., 2], .006)
    d = smin(d, COLLAR(p), .016)
    hood = ellipsoid(Frame(HOOD_CENTRE, X, TRUNK.y, TRUNK.z).local(p), (.098, .048, .072))
    return smin(d, hood, .014)


def jacket_field(p):
    d = smin(jacket_trunk_field(p), JACKET_SLEEVES["left"](p), .028)
    d = smin(d, JACKET_SLEEVES["right"](p), .028)
    # Bunching where the body bends, and long soft folds elsewhere.
    fold = fbm(p * 5.5 + 3.1, 3) * .006
    fold = fold + ripple(p, TRUNK.world([0., .13, .08]), unit(TRUNK.z + X * .22), .082, .0085, .17, TRUNK.y, 1.)
    fold = fold + ripple(p, TRUNK.world([.16, .03, .08]), unit(TRUNK.z - X * .3), .09, .006, .13, X, 2.)
    fold = fold + ripple(p, TRUNK.world([-.16, .03, .08]), unit(TRUNK.z + X * .3), .095, .006, .13, -X, 3.)
    fold = fold + ripple(p, TRUNK.world([0., -.13, .24]), unit(TRUNK.z + X * .15), .11, .0055, .2, -TRUNK.y, 4.)
    for side, sign in SIDES.items():
        shoulder, elbow, wrist = limb(side, "shoulder", "elbow", "wrist")
        crook = unit((shoulder + wrist) / 2 - elbow)
        fold = fold + ripple(p, elbow + crook * .03, unit(wrist - shoulder), .048, .0075, .10, crook, 5. + sign)
        fold = fold + ripple(p, (shoulder + elbow) / 2, unit(elbow - shoulder + Y * .1), .07, .0035, .1, None, 7. + sign)
        fold = fold + ripple(p, shoulder + TRUNK.y * .1 - X * sign * .07 - TRUNK.z * .08, unit(X * sign + TRUNK.z), .07, .0035, .12, None, 9. + sign)
    return d + fold


def trim_side(p):
    """Positive on the darker panels: the yoke across the shoulders and the cuffs."""
    q = TRUNK.local(p)
    trim = q[..., 2] - (.452 - .035 * step(.0, .2, np.abs(q[..., 0])))
    for side in SIDES:
        _, elbow, wrist = limb(side, "shoulder", "elbow", "wrist")
        axis = unit(wrist - elbow)
        along = dot(p - elbow, axis)
        away = np.linalg.norm((p - elbow) - along[..., None] * axis, axis=-1)
        trim = np.maximum(trim, np.minimum(along - .212, .11 - away))
    return trim


def jacket_main_field(p):
    return smax(jacket_field(p), trim_side(p), .0035)


def jacket_trim_field(p):
    return smax(jacket_field(p), -trim_side(p), .0035)


# ------------------------------------------------------------------------------------------------
# Hips and legs: the trousers
# ------------------------------------------------------------------------------------------------

TROUSER_PELVIS = Loft(HIPS, SHOULDERS, TRUNK.y, [(-.20, .120, .112, -.012), (-.13, .170, .136, -.018), (-.03, .172, .134, -.012), (.06, .160, .122, -.002), (.13, .150, .114, .0)], power=2.3)


def trouser_leg(side):
    hip, knee, ankle = limb(side, "hip", "knee", "ankle")
    thigh = Loft(hip, knee, Y, [(-.06, .100, .108, -.005), (.04, .108, .118, -.002), (.19, .098, .108, .006), (.33, .084, .090, .004), (.44, .076, .080, .002)])
    shin = Loft(knee, ankle, Y, [(-.02, .074, .078, .004), (.08, .075, .080, -.006), (.20, .077, .083, -.010), (.31, .081, .088, -.004), (.362, .084, .093, .0)])
    glute = hip + TRUNK.world([0., -.045, -.06]) - TRUNK.o

    def field(p):
        d = smin(thigh(p), shin(p), .022)
        d = smin(d, np.linalg.norm(p - knee, axis=-1) - .078, .02)
        return smin(d, ellipsoid(Frame(glute, X, TRUNK.y, TRUNK.z).local(p), (.092, .086, .10)), .03)
    return field


TROUSER_LEGS = {side: trouser_leg(side) for side in SIDES}


def trousers_field(p):
    d = smin(smin(TROUSER_LEGS["left"](p), TROUSER_LEGS["right"](p), .012), TROUSER_PELVIS(p), .05)
    # Nothing above the jacket's hem shows, so nothing is built there.
    q = TRUNK.local(p)
    d = smax(d, q[..., 2] - (hem_height(q[..., 1]) + .17), .004)
    # Under the jacket they sit well inside it, so a bending hip does not push them through.
    d = d + .03 * step(-.03, .05, q[..., 2] - hem_height(q[..., 1]))
    fold = fbm(p * 6.5 + 8.7, 3) * .005
    for side, sign in SIDES.items():
        hip, knee, ankle = limb(side, "hip", "knee", "ankle")
        along = unit(unit(knee - hip) + unit(ankle - knee))
        crook = unit((hip + ankle) / 2 - knee)
        fold = fold + ripple(p, knee + crook * .05, along, .058, .0095, .105, crook, 11. + sign)
        fold = fold + ripple(p, knee - crook * .05, along, .085, .004, .10, -crook, 13. + sign)
        fold = fold + ripple(p, hip + (unit(knee - hip) * .08 + Y * .09), unit(knee - hip + Z * .25), .066, .009, .12, Y, 15. + sign)
        shin_q = p - knee
        shin_axis = unit(ankle - knee)
        flat = shin_q - dot(shin_q, shin_axis)[..., None] * shin_axis
        drape = fbm(flat * 26. + shin_axis * dot(shin_q, shin_axis)[..., None] * 5. + sign * 4.2, 2)
        fold = fold + drape * .0035 * step(.1, .3, dot(shin_q, shin_axis)) * step(.03, -.05, np.abs(p[..., 0] - knee[0]) - .1)
    return d + fold


# ------------------------------------------------------------------------------------------------
# Head: helmet, goggles, face cover
# ------------------------------------------------------------------------------------------------

def helmet_base(q):
    return ellipsoid(q - np.array([0., -.006, .030]), (.114, .138, .120))


def helmet_field(p):
    q = SKULL.local(p)
    shell = helmet_base(q)
    edge = np.interp(q[..., 1], [-.15, -.03, .05, .13], [-.082, -.070, -.016, .034])
    d = smax(shell, edge - q[..., 2], .012)
    # Vents: slots cut a little into the shell.
    for x0, y0, half in ((0., .03, .045), (.042, .03, .040), (-.042, .03, .040), (.078, .015, .028), (-.078, .015, .028),
                         (0., -.075, .028), (.04, -.075, .024), (-.04, -.075, .024)):
        slot = np.maximum(np.abs(q[..., 0] - x0) - .0075, np.abs(q[..., 1] - y0) - half)
        groove = np.maximum(slot, -(shell + .009))
        d = smax(d, -groove, .004)
    return d


def strap_height(y):
    return np.interp(y, [-.16, .0, .10], [.012, .006, -.002])


def strap_field(p):
    q = SKULL.local(p)
    shell = helmet_base(q)
    band = np.abs(q[..., 2] - strap_height(q[..., 1])) - .0215
    return smax(smax(np.abs(shell - .001) - .0045, band, .002), q[..., 1] - .085, .002)


def goggle_coords(p, radius):
    q = SKULL.local(p)
    dy = q[..., 1] + .03
    rho = np.sqrt(q[..., 0] ** 2 + dy ** 2)
    return radius * np.arctan2(q[..., 0], dy), q[..., 2] + .006, rho - radius


def rounded_rect(a, v, half_a, half_v, r):
    da, dv = np.abs(a) - (half_a - r), np.abs(v) - (half_v - r)
    return np.sqrt(np.maximum(da, 0.) ** 2 + np.maximum(dv, 0.) ** 2) + np.minimum(np.maximum(da, dv), 0.) - r


def goggle_frame_field(p):
    a, v, w = goggle_coords(p, .126)
    face = rounded_rect(a, v, .112, .048, .024)
    d = smax(face, np.abs(w) - .017, .006)
    nose = np.sqrt((a / .024) ** 2 + ((v + .056) / .034) ** 2) - 1.
    return smax(d, -nose * .024, .005)


def goggle_lens_field(p):
    a, v, w = goggle_coords(p, .126)
    # The lens bulges toward the middle.
    w = w - .0165 + (v * v) * 2.6 + (a * a) * .35
    face = rounded_rect(a, v, .100, .039, .021)
    d = smax(face, np.abs(w) - .004, .003)
    nose = np.sqrt((a / .021) ** 2 + ((v + .051) / .027) ** 2) - 1.
    return smax(d, -nose * .021, .004)


GAITER_NECK = Loft(SHOULDERS + NECK_AXIS * .05, HEAD, SKULL.y, [(.0, .066, .072, .004), (.08, .063, .069, .006), (.13, .060, .067, .012)])


def gaiter_field(p):
    q = SKULL.local(p)
    chin = ellipsoid(q - np.array([0., .030, -.066]), (.066, .078, .074))
    nose = ellipsoid(q - np.array([0., .080, -.040]), (.024, .026, .028))
    d = smin(smin(chin, nose, .02), GAITER_NECK(p), .02)
    return smax(d, q[..., 2] + .018, .006) + fbm(p * 16. + 2.2, 2) * .0018


# ------------------------------------------------------------------------------------------------
# Hands: gloves
# ------------------------------------------------------------------------------------------------

def glove_field(side):
    hand = hand_frame(side)
    wrist, elbow = J[f"{side}_wrist"], J[f"{side}_elbow"]
    gauntlet = Loft(elbow, wrist, hand.y, [(.195, .052, .055), (.212, .053, .056), (.25, .048, .050), (.285, .043, .043)])

    def field(p):
        q = hand.local(p)
        c = q - np.array([0., 0., -.070])
        # Palm and back of the hand, then four fingers curled around the pole and a thumb across them.
        d = ellipsoid(q - np.array([0., 0., -.030]), (.043, .034, .056))
        for x0, r0 in ((-.030, .0108), (-.011, .0118), (.009, .0118), (.028, .0105)):
            ring = np.sqrt((np.sqrt(c[..., 1] ** 2 + c[..., 2] ** 2) - .023) ** 2 + (c[..., 0] - x0) ** 2) - r0
            d = smin(d, ring, .0035)
        thumb = round_cone(c, (-.046, -.012, .026), (-.041, -.019, -.015), .0135, .0108)
        d = smin(d, thumb, .006)
        d = smin(d, gauntlet(p), .012)
        return d + fbm(p * 30. + 5.5, 2) * .0008
    return field


GLOVE_FIELDS = {side: glove_field(side) for side in SIDES}


# ------------------------------------------------------------------------------------------------
# Feet: boots, bindings
# ------------------------------------------------------------------------------------------------

def boot_shell_field(side):
    foot = ski_origin(side)
    sign = SIDES[side]

    def field(p):
        q = p - foot
        q = np.stack([q[..., 0] * sign, q[..., 1], q[..., 2]], axis=-1)   # +x is the boot's outer side
        sole = rbox(q - np.array([0., .035, .052]), (.053, .158, .024), .018)
        toe = ellipsoid(q - np.array([0., .112, .082]), (.056, .090, .052))
        instep = round_cone(q, (0., .075, .090), (0., .000, .175), .047, .062)
        heel = round_cone(q, (0., -.072, .088), (0., -.040, .165), .053, .060)
        d = smin(smin(sole, toe, .02), smin(instep, heel, .03), .022)
        # Sole lugs, so the boot reads as a boot on the binding.
        d = smin(d, rbox(q - np.array([0., .178, .058]), (.038, .016, .014), .006), .004)
        d = smin(d, rbox(q - np.array([0., -.122, .058]), (.038, .012, .014), .006), .004)
        return smax(d, q[..., 2] - .205, .012)
    return field


def boot_cuff_field(side):
    knee, ankle = J[f"{side}_knee"], J[f"{side}_ankle"]
    axis = unit(knee - ankle)
    cuff = Loft(ankle - axis * .035, knee, Y, [(.0, .056, .068, .002), (.07, .058, .074, .0), (.15, .062, .076, -.002), (.195, .066, .077, -.002), (.212, .067, .077, -.002)], power=2.3)
    spine = Loft(ankle - axis * .03, knee, Y, [(.0, .016, .012, -.070), (.20, .016, .012, -.078)])

    def field(p):
        return smin(cuff(p), spine(p), .006)
    return field


def boot_strap_field(side):
    knee, ankle = J[f"{side}_knee"], J[f"{side}_ankle"]
    axis = unit(knee - ankle)
    return Loft(ankle + axis * .138, knee, Y, [(.0, .0655, .0815, -.002), (.032, .0675, .0815, -.002)], power=2.3)


def buckles_field(side):
    foot = ski_origin(side)
    sign = SIDES[side]
    knee, ankle = J[f"{side}_knee"], J[f"{side}_ankle"]
    axis = unit(knee - ankle)
    across = unit(np.cross(Y, axis))
    across = across * (1. if across[0] > 0 else -1.)     # toward +x
    front = unit(np.cross(axis, across))
    front = front * (1. if front[1] > 0 else -1.)
    upper = [ankle + axis * h + front * .058 + across * .04 * sign for h in (.07, .125)]

    def field(p):
        q = p - foot
        q = np.stack([q[..., 0] * sign, q[..., 1], q[..., 2]], axis=-1)
        d = rbox(q - np.array([.034, .090, .118]), (.022, .010, .006), .003)
        d = np.minimum(d, rbox(q - np.array([.040, .030, .155]), (.022, .010, .006), .003))
        for centre in upper:
            d = np.minimum(d, round_cone(p, centre - across * .022, centre + across * .022, .0065, .0065))
        for mark in (1., -1.):   # the rivet the cuff pivots on
            d = np.minimum(d, np.linalg.norm(p - (ankle + across * mark * .059), axis=-1) - .011)
        return d
    return field


def binding_field(side):
    foot = ski_origin(side)

    def field(p):
        q = p - foot
        q = np.stack([np.abs(q[..., 0]), q[..., 1], q[..., 2]], axis=-1)
        plate = rbox(q - np.array([0., .030, .022]), (.034, .310, .009), .004)
        toe = smin(rbox(q - np.array([0., .225, .046]), (.036, .040, .022), .010), rbox(q - np.array([0., .196, .072]), (.030, .022, .014), .008), .008)
        heel = smin(rbox(q - np.array([0., -.170, .046]), (.036, .052, .024), .010), rbox(q - np.array([0., -.132, .072]), (.030, .022, .016), .008), .008)
        brake = round_cone(q, (.038, -.095, .030), (.058, -.175, .018), .005, .004)
        return np.minimum(np.minimum(smin(plate, toe, .006), smin(heel, plate, .006)), brake)
    return field


# ------------------------------------------------------------------------------------------------
# Skis, poles and zips: built directly, they are simple shapes with crisp edges
# ------------------------------------------------------------------------------------------------

@dataclass
class Mesh:
    vertices: np.ndarray
    normals: np.ndarray
    faces: np.ndarray
    colors: np.ndarray


def ski_mesh(side) -> Mesh:
    foot = ski_origin(side)
    tail, tip = BODY.ski_tip_forward - BODY.ski_length, BODY.ski_tip_forward
    half_width = PchipInterpolator([tail, tail + .025, tail + .09, .03, tip - .24, tip - .08, tip - .02, tip], [.004, .028, .052, .0355, .060, .050, .026, .003])
    thick = PchipInterpolator([tail, tail + .14, .03, tip - .32, tip - .10, tip], [.004, .007, .017, .007, .004, .003])

    def base(s):
        rise = np.where(s > tip - .30, .062 * step(0., 1., (s - (tip - .30)) / .30) ** 2, 0.)
        rise = rise + np.where(s < tail + .13, .024 * step(0., 1., ((tail + .13) - s) / .13) ** 2, 0.)
        return rise

    # Graphics change exactly at these stations.
    edges = [tail + .10, tail + .16, tip - .50, tip - .30, tip - .26, tip - .22]
    stations = np.unique(np.concatenate([np.linspace(tail, tip, 72), np.array(edges), np.array(edges) + .0015]))

    def top_color(s):
        c = np.full((len(s), 3), .05)
        c[(s > tail + .10) & (s < tail + .16)] = .86
        c[(s > tip - .50) & (s < tip - .30)] = .86
        c[(s > tip - .26) & (s < tip - .22)] = .86
        return c

    across = np.array([-1., -.55, 0., .55, 1.])
    vertices, normals, colors, faces = [], [], [], []

    def strip(pts, nrm, col):
        start = sum(len(v) for v in vertices)
        n_s, n_a = pts.shape[:2]
        vertices.append(pts.reshape(-1, 3))
        normals.append(nrm.reshape(-1, 3))
        colors.append(col.reshape(-1, 3))
        for i in range(n_s - 1):
            for j in range(n_a - 1):
                a, b = start + i * n_a + j, start + i * n_a + j + 1
                c, d = start + (i + 1) * n_a + j, start + (i + 1) * n_a + j + 1
                faces.append((a, b, d))
                faces.append((a, d, c))

    w, t, z = half_width(stations), thick(stations), base(stations)
    slope = np.gradient(z, stations)
    # Top sheet, slightly domed.
    pts = np.stack([np.outer(w * .90, across), np.repeat(stations[:, None], 5, axis=1), z[:, None] + np.outer(t, 1. - .22 * across ** 2)], axis=-1)
    nrm = unit(np.stack([np.repeat(across[None] * .22, len(stations), axis=0), np.repeat(-slope[:, None], 5, axis=1), np.ones((len(stations), 5))], axis=-1))
    strip(pts, nrm, np.repeat(top_color(stations)[:, None], 5, axis=1))
    # Side walls, facing out.
    for sign in (-1., 1.):
        pts = np.stack([np.stack([w * sign, w * .90 * sign], axis=1), np.repeat(stations[:, None], 2, axis=1), np.stack([z, z + t * .78], axis=1)], axis=-1)
        if sign > 0:
            pts = pts[:, ::-1]
        nrm = unit(np.stack([np.full((len(stations), 2), sign), np.repeat(-slope[:, None], 2, axis=1) * .3, np.full((len(stations), 2), .35)], axis=-1))
        strip(pts, nrm, np.full(pts.shape, .10))
    # Base, with steel edges.
    pts = np.stack([np.outer(w, [1., .92, -.92, -1.]), np.repeat(stations[:, None], 4, axis=1), np.repeat(z[:, None], 4, axis=1)], axis=-1)
    nrm = unit(np.stack([np.zeros((len(stations), 4)), np.repeat(slope[:, None], 4, axis=1), -np.ones((len(stations), 4))], axis=-1))
    col = np.repeat(np.array([[.7, .7, .72], [.13, .13, .15], [.13, .13, .15], [.7, .7, .72]])[None], len(stations), axis=0)
    strip(pts, nrm, col)
    v = np.concatenate(vertices) + foot
    return Mesh(v, np.concatenate(normals), np.array(faces, dtype=np.int32), np.concatenate(colors))


def pole_mesh(side) -> Mesh:
    hand = hand_frame(side)
    fist = hand.world([0., 0., -.070])
    tip = J[f"{side}_pole_tip"]
    length = float(np.linalg.norm(tip - fist))
    axis = unit(tip - fist)
    u = unit(np.cross(axis, Y))
    v = np.cross(axis, u)
    grip_dark, shaft, plastic, steel = (.035, .035, .04), (.62, .64, .68), (.04, .04, .045), (.8, .8, .82)
    # Distance from the fist toward the tip, radius, colour.
    rows = [(-.092, .001, grip_dark), (-.090, .016, grip_dark), (-.082, .0195, grip_dark), (-.062, .0175, grip_dark), (.040, .0165, grip_dark), (.060, .0150, grip_dark),
            (.074, .0100, grip_dark), (.078, .0088, shaft), (length - .115, .0072, shaft), (length - .112, .0115, plastic), (length - .100, .0130, plastic), (length - .096, .043, plastic),
            (length - .088, .047, plastic), (length - .083, .045, plastic), (length - .078, .012, plastic), (length - .070, .0075, plastic), (length - .060, .0062, steel),
            (length - .012, .0052, steel), (length, .0015, steel)]
    sides = 10
    angle = np.linspace(0., 2. * np.pi, sides, endpoint=False)
    ring = np.outer(np.cos(angle), u) + np.outer(np.sin(angle), v)
    d = np.array([row[0] for row in rows])
    radius = np.array([row[1] for row in rows])
    slope = np.gradient(radius, d)
    vertices = (fist + np.outer(d, axis))[:, None] + radius[:, None, None] * ring[None]
    normals = unit(ring[None] - slope[:, None, None] * axis[None, None])
    colors = np.repeat(np.array([row[2] for row in rows])[:, None], sides, axis=1)
    faces = []
    for i in range(len(rows) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            c, e = (i + 1) * sides + j, (i + 1) * sides + (j + 1) % sides
            faces.append((a, c, e))
            faces.append((a, e, b))
    return Mesh(vertices.reshape(-1, 3), normals.reshape(-1, 3), np.array(faces, dtype=np.int32), colors.reshape(-1, 3))


def chunked(field, points, size=1 << 18):
    out = np.empty(len(points))
    for start in range(0, len(points), size):
        out[start:start + size] = field(points[start:start + size])
    return out


def gradient(field, points, h):
    grad = np.empty_like(points)
    for axis in range(3):
        step_vector = np.zeros(3)
        step_vector[axis] = h
        grad[:, axis] = (chunked(field, points + step_vector) - chunked(field, points - step_vector)) / (2. * h)
    return grad


def trunk_ribbon(line, start, end, half_width) -> Mesh:
    """A strip lying on the jacket's front: a zip or a pocket's opening. `line` gives (across, along the trunk) from a parameter."""
    params = np.linspace(start, end, 32)
    centres = []
    for t in params:
        x, z = line(t)
        # Walk in from outside the jacket until the surface.
        depth = np.linspace(.32, -.02, 681)
        probe = TRUNK.world(np.stack([np.full_like(depth, x), depth, np.full_like(depth, z)], axis=-1))
        inside = chunked(jacket_field, probe) < 0.
        centres.append(probe[int(np.argmax(inside))])
    centres = np.array(centres)
    normals = unit(gradient(jacket_field, centres, .004))
    along = unit(np.gradient(centres, axis=0))
    side = unit(np.cross(normals, along))
    lifted = centres + normals * .0025
    vertices = np.stack([lifted - side * half_width, lifted + side * half_width], axis=1).reshape(-1, 3)
    faces = []
    for i in range(len(params) - 1):
        a, b, c, d = i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3
        faces.append((a, b, d))
        faces.append((a, d, c))
    faces = np.array(faces, dtype=np.int32)
    p0, p1, p2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    if np.mean(dot(np.cross(p1 - p0, p2 - p0), normals[faces[:, 0] // 2])) < 0.:
        faces = faces[:, ::-1]
    return Mesh(vertices, np.repeat(normals, 2, axis=0), faces, np.ones_like(vertices))


# ------------------------------------------------------------------------------------------------
# Simplifying
# ------------------------------------------------------------------------------------------------

@njit(cache=False)
def _face_quadric(a, b, c):
    n = np.cross(b - a, c - a)
    length = np.sqrt(np.sum(n * n))
    if length < 1e-14:
        return np.zeros(10)
    n = n / length
    d = -np.sum(n * a)
    # Weighted by area, so slivers count for little.
    w = length * .5
    return w * np.array([n[0] * n[0], n[0] * n[1], n[0] * n[2], n[0] * d, n[1] * n[1], n[1] * n[2], n[1] * d, n[2] * n[2], n[2] * d, d * d])


@njit(cache=False)
def _evaluate(q, p):
    x, y, z = p[0], p[1], p[2]
    return (q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
            + q[7] * z * z + 2 * q[8] * z + q[9])


@njit(cache=False)
def _collapse_point(q, a, b):
    """Where an edge should collapse to, and the error there."""
    mid = (a + b) * .5
    m = np.array([[q[0], q[1], q[2]], [q[1], q[4], q[5]], [q[2], q[5], q[7]]])
    if abs(np.linalg.det(m)) > 1e-9:
        p = np.linalg.solve(m, -np.array([q[3], q[6], q[8]]))
        # Stay close to the edge, so thin parts cannot fold through themselves.
        if np.sum((p - mid) ** 2) < np.sum((a - b) ** 2):
            return p, _evaluate(q, p)
    best, best_error = mid, _evaluate(q, mid)
    for candidate in (a, b):
        error = _evaluate(q, candidate)
        if error < best_error:
            best, best_error = candidate, error
    return best.copy(), best_error


@njit(cache=False)
def _simplify(vertices, faces, target):
    """Quadric edge collapse: removes the edges whose loss changes the surface least, until `target` vertices are left."""
    V = vertices.copy()
    F = faces.copy()
    n, m = len(V), len(F)
    Q = np.zeros((n, 10))
    for i in range(m):
        q = _face_quadric(V[F[i, 0]], V[F[i, 1]], V[F[i, 2]])
        for j in range(3):
            Q[F[i, j]] += q
    face_dead = np.zeros(m, dtype=np.bool_)
    vertex_dead = np.zeros(n, dtype=np.bool_)
    alive = n
    for iteration in range(240):
        if alive <= target:
            break
        # Fresh adjacency.
        count = np.zeros(n + 1, dtype=np.int64)
        for i in range(m):
            if not face_dead[i]:
                for j in range(3):
                    count[F[i, j] + 1] += 1
        start = np.cumsum(count)
        fill = start[:-1].copy()
        refs = np.zeros(start[-1], dtype=np.int64)
        for i in range(m):
            if not face_dead[i]:
                for j in range(3):
                    refs[fill[F[i, j]]] = i
                    fill[F[i, j]] += 1
        threshold = 1e-12 * (iteration + 3) ** 5.5
        touched = np.zeros(n, dtype=np.bool_)
        for i in range(m):
            if alive <= target:
                break
            if face_dead[i]:
                continue
            for j in range(3):
                i0, i1 = F[i, j], F[i, (j + 1) % 3]
                if touched[i0] or touched[i1]:
                    continue
                q = Q[i0] + Q[i1]
                p, error = _collapse_point(q, V[i0], V[i1])
                if error > threshold:
                    continue
                # Refuse a collapse that would pinch the surface: the ends may share only the edge's two neighbours.
                around0 = set()
                for r in range(start[i0], start[i0 + 1]):
                    f = refs[r]
                    if not face_dead[f]:
                        for k in range(3):
                            if F[f, k] != i0:
                                around0.add(F[f, k])
                shared = 0
                around1 = set()
                for r in range(start[i1], start[i1 + 1]):
                    f = refs[r]
                    if not face_dead[f]:
                        for k in range(3):
                            if F[f, k] != i1:
                                around1.add(F[f, k])
                for value in around1:
                    if value in around0:
                        shared += 1
                if shared != 2:
                    continue
                # Nor one that would flip a face.
                bad = False
                for vertex, other in ((i0, i1), (i1, i0)):
                    for r in range(start[vertex], start[vertex + 1]):
                        f = refs[r]
                        if face_dead[f]:
                            continue
                        a, b, c = F[f, 0], F[f, 1], F[f, 2]
                        if a == other or b == other or c == other:
                            continue
                        pa = p if a == vertex else V[a]
                        pb = p if b == vertex else V[b]
                        pc = p if c == vertex else V[c]
                        before = np.cross(V[b] - V[a], V[c] - V[a])
                        after = np.cross(pb - pa, pc - pa)
                        length_before = np.sqrt(np.sum(before * before))
                        length_after = np.sqrt(np.sum(after * after))
                        if length_after < 1e-10 or np.sum(before * after) < .3 * length_before * length_after:
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    continue
                V[i0] = p
                Q[i0] = q
                vertex_dead[i1] = True
                alive -= 1
                for r in range(start[i1], start[i1 + 1]):
                    f = refs[r]
                    if face_dead[f]:
                        continue
                    a, b, c = F[f, 0], F[f, 1], F[f, 2]
                    if a == i0 or b == i0 or c == i0:
                        face_dead[f] = True
                    else:
                        for k in range(3):
                            if F[f, k] == i1:
                                F[f, k] = i0
                            touched[F[f, k]] = True
                for r in range(start[i0], start[i0 + 1]):
                    f = refs[r]
                    if not face_dead[f]:
                        for k in range(3):
                            touched[F[f, k]] = True
                break
    keep = ~vertex_dead
    remap = np.cumsum(keep) - 1
    out = np.zeros((m, 3), dtype=np.int32)
    used = 0
    for i in range(m):
        if not face_dead[i]:
            for k in range(3):
                out[used, k] = remap[F[i, k]]
            used += 1
    return V[keep], out[:used]


def simplify(vertices, faces, target):
    if not target or len(vertices) <= target:
        return vertices, faces
    # In decimetres, so the error scale suits the thresholds.
    v, f = _simplify(vertices * 10., faces.astype(np.int32), target)
    return v / 10., f


# ------------------------------------------------------------------------------------------------
# Meshing
# ------------------------------------------------------------------------------------------------

@dataclass
class Part:
    name: str
    material: str
    field: Callable | None
    voxel: float
    weights: Callable[[np.ndarray], dict[str, np.ndarray]]
    color: Callable | None = None
    mesh: Callable[[], Mesh] | None = None
    target: int = 0
    grid: tuple | None = None
    result: Mesh | None = None


FIGURE_BOX = (np.array([-.95, -.75, -.06]), np.array([.95, 1.05, 2.05]))


def grid_points(low, high, h):
    axes = [np.arange(low[i], high[i] + h, h) for i in range(3)]
    mesh = np.meshgrid(*axes, indexing="ij")
    return axes, np.stack([m.ravel() for m in mesh], axis=-1), tuple(len(a) for a in axes)


def sample(field, voxel):
    """The field on a fine grid around its surface: exact near the surface, interpolated from a coarse grid elsewhere."""
    # First a coarse look to find the part's box.
    h0 = max(.03, voxel * 3)
    axes, points, shape = grid_points(*FIGURE_BOX, h0)
    near = chunked(field, points).reshape(shape) < h0 * 2.2
    idx = np.argwhere(near)
    low = np.array([axes[i][idx[:, i].min()] for i in range(3)]) - h0
    high = np.array([axes[i][idx[:, i].max()] for i in range(3)]) + h0
    # Then coarse values inside the box, refined only near the surface.
    h1 = voxel * 3
    axes1, points1, shape1 = grid_points(low, high, h1)
    coarse = chunked(field, points1).reshape(shape1)
    axes2, points2, shape2 = grid_points(low, high, voxel)
    coords = ((points2 - low) / h1).T
    fine = map_coordinates(coarse, coords, order=1, mode="nearest")
    band = np.abs(fine) < h1 * 2.6
    fine[band] = chunked(field, points2[band])
    return low, voxel, fine.reshape(shape2)


def mesh_part(part: Part):
    if part.mesh:
        return part.mesh()
    low, h, volume = sample(part.field, part.voxel)
    part.grid = (low, h, volume)
    vertices, faces, _, _ = marching_cubes(volume, level=0., spacing=(h, h, h))
    vertices = vertices + low

    # Onto the true surface, with fewer vertices, then normals from the field itself.
    def settle(points):
        for _ in range(2):
            grad = gradient(part.field, points, h * .5)
            length2 = np.maximum(np.sum(grad * grad, axis=1), 1e-6)
            move = (chunked(part.field, points) / length2)[:, None] * grad
            points = points - np.clip(move, -h, h)
        return points

    vertices = settle(vertices)
    vertices, faces = simplify(vertices, faces, part.target)
    vertices = settle(vertices)
    normals = unit(gradient(part.field, vertices, max(.0018, h * .35)))
    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    if np.mean(dot(np.cross(b - a, c - a), normals[faces[:, 0]])) < 0.:
        faces = faces[:, ::-1]
    return Mesh(vertices, normals, faces.astype(np.int32), np.ones_like(vertices))


# ------------------------------------------------------------------------------------------------
# Weights
# ------------------------------------------------------------------------------------------------

def spine_weights(v):
    t = TRUNK.local(v)[:, 2] / SPINE
    pelvis = 1. - step(.02, .44, t)
    chest = step(.36, .84, t)
    return {"pelvis": pelvis, "abdomen": np.clip(1. - pelvis - chest, 0., 1.), "chest": chest}


def arm_weights(v, side):
    shoulder, elbow, wrist = limb(side, "shoulder", "elbow", "wrist")
    into_arm = step(-.05, .075, dot(v - shoulder, unit(elbow - shoulder)))
    bisector = unit(unit(elbow - shoulder) + unit(wrist - elbow))
    fore = step(-.06, .06, dot(v - elbow, bisector))
    return {f"{side}_upper_arm": into_arm * (1. - fore), f"{side}_forearm": fore, "chest": (1. - into_arm) * (1. - fore)}


def leg_weights(v, side):
    hip, knee, ankle = limb(side, "hip", "knee", "ankle")
    into_leg = step(-.07, .10, dot(v - hip, unit(knee - hip)))
    bisector = unit(unit(knee - hip) + unit(ankle - knee))
    shin = step(-.08, .08, dot(v - knee, bisector))
    return {f"{side}_thigh": into_leg * (1. - shin), f"{side}_shin": shin}, 1. - into_leg


def add(total, weights, share):
    for name, value in weights.items():
        total[name] = total.get(name, 0.) + value * share


def jacket_weights(v):
    trunk = jacket_trunk_field(v)
    total: dict[str, np.ndarray] = {}
    left = step(-.03, .03, trunk - JACKET_SLEEVES["left"](v))
    right = step(-.03, .03, trunk - JACKET_SLEEVES["right"](v))
    q = TRUNK.local(v)
    share = np.clip(1. - left - right, 0., 1.)
    # A lifted thigh carries the jacket's hem with it, as on a real jacket.
    hem = step(.04, -.06, q[:, 2]) * step(.03, .11, q[:, 1]) * step(.01, .06, np.abs(q[:, 0])) * .75
    add(total, spine_weights(v), share * (1. - hem))
    add(total, {"left_thigh": np.where(q[:, 0] < 0., hem, 0.), "right_thigh": np.where(q[:, 0] >= 0., hem, 0.)}, share)
    add(total, arm_weights(v, "left"), left)
    add(total, arm_weights(v, "right"), right)
    return total


def trouser_weights(v):
    total: dict[str, np.ndarray] = {}
    share_right = step(-.03, .03, v[:, 0])
    legs_left, rest_left = leg_weights(v, "left")
    legs_right, rest_right = leg_weights(v, "right")
    add(total, legs_left, 1. - share_right)
    add(total, legs_right, share_right)
    add(total, spine_weights(v), rest_left * (1. - share_right) + rest_right * share_right)
    return total


def gaiter_weights(v):
    t = dot(v - SHOULDERS, NECK_AXIS) / float(np.linalg.norm(HEAD - SHOULDERS))
    head = step(.42, .80, t)
    chest = 1. - step(.12, .5, t)
    return {"head": head, "chest": chest, "neck": np.clip(1. - head - chest, 0., 1.)}


def glove_weights(side):
    def weights(v):
        wrist, elbow = J[f"{side}_wrist"], J[f"{side}_elbow"]
        hand = step(-.014, .014, dot(v - wrist, unit(wrist - elbow)))
        return {f"{side}_hand": hand, f"{side}_forearm": 1. - hand}
    return weights


def rigid(bone):
    return lambda v: {bone: np.ones(len(v))}


def constant(value):
    return lambda p, n: np.full((len(p), 3), value)


def lens_color(p, n):
    # Mirror coatings run darker toward the bottom.
    q = SKULL.local(p)
    return np.repeat((.55 + .45 * step(-.045, .03, q[:, 2]))[:, None], 3, axis=1)


# Vertices each part ends up with: more where cloth folds, few on small hard parts.
PARTS: list[Part] = [
    Part("jacket", "jacket", jacket_main_field, .0048, jacket_weights, target=12000),
    Part("jacket_trim", "jacket_trim", jacket_trim_field, .0048, jacket_weights, target=7000),
    Part("zip", "frame", None, 0., jacket_weights, mesh=lambda: trunk_ribbon(lambda t: (.0, t), HEM_FRONT + .012, .655, .0042)),
    Part("left_pocket", "frame", None, 0., jacket_weights, mesh=lambda: trunk_ribbon(lambda t: (-.125 + (t - .02) * .32, t), .02, .13, .0024)),
    Part("right_pocket", "frame", None, 0., jacket_weights, mesh=lambda: trunk_ribbon(lambda t: (.125 - (t - .02) * .32, t), .02, .13, .0024)),
    Part("chest_pocket", "frame", None, 0., jacket_weights, mesh=lambda: trunk_ribbon(lambda t: (.075 + (t - .30) * .25, t), .30, .40, .0022)),
    Part("trousers", "trousers", trousers_field, .0055, trouser_weights, target=10000),
    Part("gaiter", "gaiter", gaiter_field, .004, gaiter_weights, target=1500),
    Part("helmet", "helmet", helmet_field, .0035, rigid("head"), target=3200),
    Part("strap", "gaiter", strap_field, .0028, rigid("head"), constant(.55), target=600),
    Part("goggle_frame", "frame", goggle_frame_field, .0022, rigid("head"), target=1500),
    Part("goggle_lens", "lens", goggle_lens_field, .0022, rigid("head"), lens_color, target=900),
]
for _side in SIDES:
    PARTS += [
        Part(f"{_side}_glove", "glove", GLOVE_FIELDS[_side], .0042, glove_weights(_side), target=1700),
        Part(f"{_side}_boot", "boot", boot_shell_field(_side), .0055, rigid(f"{_side}_foot"), target=1400),
        Part(f"{_side}_cuff", "boot", boot_cuff_field(_side), .005, rigid(f"{_side}_shin"), target=1000),
        Part(f"{_side}_boot_strap", "gaiter", boot_strap_field(_side), .0036, rigid(f"{_side}_shin"), target=220),
        Part(f"{_side}_buckles", "metal", buckles_field(_side), .0028, rigid(f"{_side}_shin"), target=320),
        Part(f"{_side}_binding", "binding", binding_field(_side), .0048, rigid(f"{_side}_foot"), target=700),
        Part(f"{_side}_ski", "ski", None, 0., rigid(f"{_side}_foot"), mesh=lambda s=_side: ski_mesh(s)),
        Part(f"{_side}_pole", "pole", None, 0., rigid(f"{_side}_pole"), mesh=lambda s=_side: pole_mesh(s)),
    ]


# ------------------------------------------------------------------------------------------------
# Shading baked into the vertices
# ------------------------------------------------------------------------------------------------

def occlusion_grid(parts):
    h = .012
    low, high = np.array([-.85, -.65, -.06]), np.array([.85, .95, 2.05])
    axes = [np.arange(low[i], high[i] + h, h) for i in range(3)]
    mesh = np.meshgrid(*axes, indexing="ij")
    points = np.stack([m.ravel() for m in mesh], axis=-1)
    union = np.full(len(points), 1.)
    for part in parts:
        if part.grid is None:
            continue
        part_low, part_h, volume = part.grid
        coords = ((points - part_low) / part_h).T
        union = np.minimum(union, map_coordinates(volume, coords, order=1, mode="constant", cval=1.))
    # The skis, as plain slabs.
    for side in SIDES:
        q = points - ski_origin(side)
        union = np.minimum(union, rbox(q - np.array([0., (BODY.ski_tip_forward - (BODY.ski_length - BODY.ski_tip_forward)) / 2, .012]), (.05, BODY.ski_length / 2, .012), .005))
    return low, h, union.reshape(tuple(len(a) for a in axes))


def bake_occlusion(mesh: Mesh, grid):
    low, h, union = grid
    count = 28
    golden = np.pi * (3. - np.sqrt(5.))
    t = (np.arange(count) + .5) / count
    local = np.stack([np.cos(golden * np.arange(count)) * np.sqrt(1. - t), np.sin(golden * np.arange(count)) * np.sqrt(1. - t), np.sqrt(t)], axis=-1)
    v, n = mesh.vertices, mesh.normals
    helper = np.where(np.abs(n[:, 2:3]) < .9, np.array([[0., 0., 1.]]), np.array([[1., 0., 0.]]))
    tu = unit(np.cross(helper, n))
    tv = np.cross(n, tu)
    occlusion = np.empty(len(v))
    for start in range(0, len(v), 4096):
        s = slice(start, start + 4096)
        directions = local[None, :, 0:1] * tu[s][:, None] + local[None, :, 1:2] * tv[s][:, None] + local[None, :, 2:3] * n[s][:, None]
        blocked = np.zeros(directions.shape[:2])
        for radius, weight in ((.024, 1.), (.045, 1.), (.08, .9), (.13, .75), (.2, .55), (.3, .35)):
            q = v[s][:, None] + n[s][:, None] * .006 + directions * radius
            coords = ((q.reshape(-1, 3) - low) / h).T
            d = map_coordinates(union, coords, order=1, mode="nearest").reshape(blocked.shape)
            blocked = np.maximum(blocked, np.clip(1. - d / (radius * .62), 0., 1.) * weight)
        occlusion[s] = 1. - np.mean(blocked, axis=1)
    return np.clip(occlusion, 0., 1.) ** 1.25


# ------------------------------------------------------------------------------------------------
# Output
# ------------------------------------------------------------------------------------------------

def skin_arrays(weights: dict[str, np.ndarray], count: int):
    names = list(weights)
    # Always four influences, unused ones with no weight.
    names += [name for name in BONES if name not in names][:max(0, 4 - len(names))]
    matrix = np.stack([np.broadcast_to(weights.get(name, 0.), (count,)) for name in names], axis=1)
    order = np.argsort(-matrix, axis=1)[:, :4]
    top = np.take_along_axis(matrix, order, axis=1)
    top = top / np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    quantised = np.round(top * 255).astype(int)
    quantised[:, 0] += 255 - quantised.sum(axis=1)
    bones = np.array([BONE[name] for name in names])[order]
    bones = np.where(quantised > 0, bones, bones[:, :1])
    return bones.astype(np.uint8), quantised.astype(np.uint8)


def write(parts):
    header = {"version": 1, "positionScale": POSITION_SCALE, "bones": BONES, "points": POINTS, "bind": np.round(BIND, 5).tolist(), "parts": []}
    body = bytearray()

    def append(array):
        nonlocal body
        body += array.tobytes()
        body += b"\0" * (-len(body) % 4)

    for part in parts:
        mesh = part.result
        bones, weights = skin_arrays(part.weights(mesh.vertices), len(mesh.vertices))
        wide = len(mesh.vertices) > 65535
        header["parts"].append({"name": part.name, "material": part.material, "vertices": len(mesh.vertices), "indices": int(mesh.faces.size), "wideIndices": wide})
        append(np.round(mesh.vertices * POSITION_SCALE).astype(np.int16))
        append(np.round(mesh.normals * 127).astype(np.int8))
        append(np.round(np.clip(mesh.colors, 0., 1.) * 255).astype(np.uint8))
        append(bones)
        append(weights)
        append(mesh.faces.astype(np.uint32 if wide else np.uint16))
    text = json.dumps(header, separators=(",", ":")).encode()
    text += b" " * (-(len(text) + 8) % 4)
    OUT.write_bytes(b"SKI1" + struct.pack("<I", len(text)) + text + bytes(body))


def main():
    for part in PARTS:
        part.result = mesh_part(part)
        print(f"{part.name:18s} {len(part.result.vertices):6d} vertices {len(part.result.faces):6d} faces", flush=True)
    grid = occlusion_grid(PARTS)
    for part in PARTS:
        mesh = part.result
        shade = mesh.colors if part.color is None else part.color(mesh.vertices, mesh.normals)
        mesh.colors = shade * bake_occlusion(mesh, grid)[:, None]
    write(PARTS)
    total = sum(len(p.result.vertices) for p in PARTS)
    print(f"{total} vertices, {OUT.stat().st_size / 1e6:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
