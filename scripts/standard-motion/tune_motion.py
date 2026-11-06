"""Second stage after the curve fit: bring the run's metrics inside the demonstrations' usual range.

Median curves lose what single turns have (a median turn rolls and flexes less than any one turn),
so a few channels are adjusted by coordinate search while FreeSki's metric code watches. The camera's
following is searched alongside: it belongs to the filming, not to the standard.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Mapping

from skier_model import Camera, Motion
from verify_motion import Filming, film, score_run, shortfall

SCALES = (.55, .7, .85, 1., 1.2, 1.45)
# Second differences on real poses also catch real fast movement, so the measured jitter is an upper bound.
JITTER_SHARE = .85
JITTER_CAP = .012


def adjustments(motion: Motion) -> list:
    """Each knob: the candidate motions for one movement."""
    def scaled(fields):
        return [(replace(motion, **{name: getattr(motion, name) * scale for name in fields}), abs(scale - 1.)) for scale in SCALES]
    knobs = [scaled(("shoulder_roll", "shoulder_roll3")), scaled(("lat", "lat3", "knee"))]
    # Flexion is added, not scaled: a fit on median curves can leave almost none to scale.
    phase = motion.height2_phase if abs(motion.height2) > .03 else 0.
    knobs.append([(replace(motion, height2=motion.height2 + delta, height2_phase=phase if delta else motion.height2_phase), abs(delta) * 4)
                  for delta in (-.03, 0., .03, .06, .09, .13)])
    if motion.snow:
        knobs.append(scaled(("snow",)))
    if motion.wedge:
        knobs.append(scaled(("wedge",)))
    return knobs


def _filming_cost(motion, camera, filming, action, level, group, server, ignore) -> float:
    result = score_run(film(motion, camera, filming, turns=8), action, level, group, server)
    return sum(100. - row["score"] for metric, row in result["metrics"].items()
               if metric in ("turn_closure", "turn_completion_direction", "rhythm_continuity") and metric not in ignore)


def best_filming(motion: Motion, camera: Camera, action: str, level: int, group: Mapping, server: Path, jitter: float, ignore: tuple) -> Filming:
    best, best_cost = None, float("inf")
    for follow_x in (.25, .5, 1., 2.):
        for follow_y in (.15, .4, 1., 2.5):
            for path_elevation in (0., 10., 20., 32.):
                filming = Filming(follow_x, follow_y, path_elevation, jitter)
                cost = _filming_cost(motion, camera, filming, action, level, group, server, ignore)
                if cost < best_cost:
                    best, best_cost = filming, cost
    # Refine around the best setting; the hip path's heading is sensitive to it.
    centre = best
    for x_scale in (.75, 1., 1.3):
        for y_scale in (.7, 1., 1.4):
            for elevation_step in (-5., -2.5, 0., 2.5, 5.):
                filming = Filming(centre.follow_x * x_scale, centre.follow_y * y_scale, max(0., centre.path_elevation + elevation_step), jitter)
                cost = _filming_cost(motion, camera, filming, action, level, group, server, ignore)
                if cost < best_cost:
                    best, best_cost = filming, cost
    return best


def tune(motion: Motion, camera: Camera, action: str, level: int, group: Mapping, server: Path, ignore: tuple = (), rounds: int = 2):
    """(motion, filming, verification result)."""
    jitter = min(group.get("jitter") or JITTER_CAP, JITTER_CAP) * JITTER_SHARE
    filming = best_filming(motion, camera, action, level, group, server, jitter, ignore)
    for _ in range(rounds):
        for index in range(len(adjustments(motion))):
            best, best_cost = motion, float("inf")
            for candidate, distance in adjustments(motion)[index]:
                result = score_run(film(candidate, camera, filming, turns=8), action, level, group, server)
                # Prefer the fitted shape when two settings score alike.
                cost = shortfall(result, ignore) + distance * .4
                if cost < best_cost:
                    best, best_cost = candidate, cost
            motion = best
        filming = best_filming(motion, camera, action, level, group, server, jitter, ignore)
    return motion, filming, score_run(film(motion, camera, filming), action, level, group, server)
