"""Generate the standard motion of every CSIA action and level.

    python scripts/standard-motion/extract_reference.py     # when FreeSki's gold corpus changes
    python scripts/standard-motion/generate.py [ids...]

Each motion is a 3D skier (skier_model.py) whose character follows the guide's words (csia_specs.py),
whose numbers are fitted to the demonstrations' median turn (fit_motion.py) and then checked and
adjusted with FreeSki's own metric code and score card (tune_motion.py, verify_motion.py).

Output: public/standard-motions/<action>-l<level>.json for the site, index.json listing them, and
docs/STANDARD_MOTIONS.md for people.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, replace
import json
import logging
import os
from pathlib import Path
import sys

# One numeric thread per worker: eight workers with a full thread pool each crash on this machine.
for _name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_name, "1")

import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[1]

from csia_specs import CAT_TRACK, PITCH, SPECS, SPEED, Spec, spec_id  # noqa: E402
from fit_motion import fit, load_reference, normalised_view  # noqa: E402
from skier_model import BODY, Camera, INDEX, JOINTS, MIRROR, Motion, POINTS, build_turn, path_centre  # noqa: E402
from tune_motion import tune  # noqa: E402

SERVER = Path("J:/Freeski/FreeSkiclaude/server")
FRAME_PHASES = np.linspace(0., 1., 61)
CURVE_PHASES = np.linspace(0., 1., 21)
LABELS = {"turn_tempo": "换弯节奏（次/分）", "rotation_rate": "旋转速率（度/秒）", "upper_body_quiet_index": "上身稳定", "parallel_skis": "双板平行",
          "turn_closure": "收弯完成度", "turn_completion_direction": "收弯方向", "rhythm_continuity": "节奏连贯", "edge_angle": "立刃角度（估算，度）",
          "edge_change_sync": "换刃同步（估算，秒）", "flexion_range": "屈伸幅度（估算）", "inner_ski_lift_pct": "内板抬起（%）"}


def turn_width(motion: Motion) -> float:
    """Apex to apex across the slope, metres."""
    phases = np.linspace(0., 1., 201)
    across = path_centre(motion, phases)[:, 0]
    return float(2 * np.max(np.abs(across - across[0])))


def fit_size(motion: Motion, spec: Spec) -> Motion:
    """The guide gives a turn size; reach it by how far travel follows the skis, then within the speed class."""
    if not spec.size_m:
        return motion
    low, high = spec.size_m
    target = (low + high) / 2
    travels = np.linspace(max(.35, spec.travel - .25), min(1., spec.travel + .12), 16)
    motion = min((replace(motion, travel=float(t)) for t in travels), key=lambda m: abs(turn_width(m) - target))
    # The guide's size is explicit and its speed class is not a number, so the size wins, by as little as it
    # takes, but nobody skis faster than their class just to widen a turn.
    width = turn_width(motion)
    if not low <= width <= high:
        nearest = high * .98 if width > high else low * 1.02
        limit = SPEED[spec.speed] * spec.speed_share
        motion = replace(motion, speed=float(np.clip(motion.speed * nearest / width, limit * .4, limit)))
    return motion


def apex_phase(motion: Motion, camera: Camera) -> float:
    """Where the lean is largest, as FreeSki finds the apex."""
    phases = np.linspace(0., 1., 101)
    view = normalised_view(build_turn(motion, phases), camera)
    lean = (view[:, INDEX["left_ankle"], 0] + view[:, INDEX["right_ankle"], 0]) / 2
    return float(phases[int(np.argmax(np.abs(lean)))])


def round_list(values, digits=1):
    return [round(float(v), digits) for v in values]


def generate(spec: Spec, reference: dict) -> dict:
    logging.disable(logging.CRITICAL)
    key = spec.reference or f"{spec.action}|{spec.level}|pass"
    group = reference["groups"][key]
    motion, elevation, error = fit(spec, group, spec.duration or group["duration"])
    motion = fit_size(motion, spec)
    camera = Camera(180., elevation, PITCH[spec.pitch])
    ignore = ("turn_tempo",) if spec.reference else ()
    motion, filming, result = tune(motion, camera, spec.action, spec.level, group, SERVER, ignore)
    channels = {}
    build_turn(motion, CURVE_PHASES, channels=channels)
    frames = build_turn(motion, FRAME_PHASES)
    start = frames[0].copy()
    # Continuity across the edge change: the next turn starts as this one ends, mirrored.
    end = frames[-1, MIRROR].copy()
    end[:, 0] *= -1
    centre = (start[INDEX["left_ankle"]] + start[INDEX["right_ankle"]]) / 2
    end_centre = (end[INDEX["left_ankle"]] + end[INDEX["right_ankle"]]) / 2
    seam = float(np.max(np.linalg.norm((start - centre) - (end - end_centre), axis=1)))
    shown = {m: r for m, r in result["metrics"].items() if r.get("shown")}
    return {
        "schema": "standard_motion.v1",
        "id": spec_id(spec), "action": spec.action, "level": spec.level,
        "name": {"zh": spec.name_zh, "en": spec.name_en},
        "csia": {"speed": spec.speed, "performance": spec.performance, "pitch": spec.pitch, "surface": spec.surface,
                 "sizeM": list(spec.size_m) if spec.size_m else None, "qualitiesZh": list(spec.qualities_zh), "source": spec.source},
        "notesZh": list(spec.notes_zh),
        "motion": {"durationSec": round(motion.duration, 3), "speedMs": round(motion.speed, 2), "pitchDeg": PITCH[spec.pitch],
                   "turnWidthM": round(turn_width(motion), 1), "apexPhase": round(apex_phase(motion, camera), 3),
                   "headingDeg": round(float(np.degrees(motion.theta)), 1), "elevationDeg": round(elevation, 1)},
        "body": {"heightM": 1.75, "skiLengthM": BODY.ski_length, "poleLengthM": BODY.pole_length},
        "points": list(POINTS),
        "jointCount": len(JOINTS),
        # One right turn, edge change to edge change, in slope coordinates (mm): across, down the fall line, off the snow.
        "frames": [[int(round(v * 1000)) for v in frame.reshape(-1)] for frame in frames],
        "curves": {"phase": round_list(CURVE_PHASES, 2), **{name: round_list(values, 3 if name.endswith("M") else 1) for name, values in channels.items()}},
        "verification": {"reference": key, "otherLevel": bool(spec.reference), "clips": group["clips"], "turns": group["turns"],
                         "fitRmsBodyHeights": round(error, 3), "overall": result["overall"], "turnsScored": result["turns"],
                         "filming": asdict(filming), "metrics": result["metrics"],
                         "shownInBand": sum(1 for r in shown.values() if r["score"] >= 75), "shownCount": len(shown), "seamM": round(seam, 3)},
    }


def _job(args):
    spec, reference = args
    return generate(spec, reference)


def write_docs(items: list) -> None:
    lines = ["# 标准动作数据", "",
             "`scripts/standard-motion/generate.py` 生成，不要手改。每个动作一份 `public/standard-motions/<动作>-l<级别>.json`，是一个三维滑雪者（人 + 雪板 + 雪杖）从换刃到换刃的一个右转，下一个弯是它的镜像。", "",
             "## 怎么来的", "",
             "1. **指南定性质**（`csia_specs.py`）：每个考核项目的速度等级、转向还是刻滑、弯的大小和要求。比如入门平行弯过山下线才并板，原地小弯重心沿山下线、不画弧，标枪转弯抬起的内侧板和外侧板交叉。",
             f"2. **示范定数字**（`fit_motion.py`）：拟合 FreeSki 金标示范在换刃到换刃切分下的中位弯（正面视角）。指南只给速度等级和压雪车道数，不给具体数字，这里的假设：1 条压雪车道 = {CAT_TRACK} 米；速度 慢 {SPEED['slow']} / 中 {SPEED['intermediate']} / 进阶 {SPEED['advanced']} / 专家 {SPEED['expert']} 米每秒，弯的大小优先，但不会为了凑弯宽超过这个速度。",
             "   正面视角看不出前后，所以前后方向按滑雪的站姿限定：髋在雪靴上方、膝盖和肘不锁死、小腿前压、上身前倾；雪靴和雪板是一体的刚体，随小腿立刃，低的那条板刃贴雪。",
             "3. **FreeSki 验证**（`verify_motion.py`）：把动作投影成正面跟拍画面（加上该组示范量到的关键点抖动），喂给 FreeSki 自己的切弯、指标和评分卡代码，对比该组示范的分布。收弯和节奏三项读画面里的髋部轨迹，受镜头影响，验证时在跟拍镜头的合理范围内取最接近示范的一组。", "",
             "这是按指南和示范生成的数据，不是考官认定的标准，也不是真人动作。", "",
             "## 总表", "",
             "| 动作 | 级别 | 每弯用时 | 弯宽 | 模型速度 | 转向角 | FreeSki 评分卡 | 显示指标达标 | 示范段/弯 | 与示范差异 |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for item in items:
        m, v = item["motion"], item["verification"]
        lines.append(f"| {item['name']['zh']} | L{item['level']} | {m['durationSec']:.2f} 秒 | {m['turnWidthM']} 米 | {m['speedMs'] * 3.6:.0f} km/h | ±{m['headingDeg']:.0f}° | {v['overall']} | {v['shownInBand']}/{v['shownCount']} | {v['clips']}/{v['turns']}{'（3 级）' if v['otherLevel'] else ''} | {v['fitRmsBodyHeights'] * 100:.1f}% 身高 |")
    lines += ["", "## 每个动作", ""]
    for item in items:
        v, m, c = item["verification"], item["motion"], item["curves"]
        lines += [f"### {item['name']['zh']} L{item['level']}（`{item['id']}`）", "",
                  "指南要求（" + item["csia"]["source"] + "）：" + "；".join(item["csia"]["qualitiesZh"]) + "。", ""]
        lines += [f"生成时的处理：{note}" for note in item["notesZh"]]
        if item["notesZh"]:
            lines.append("")
        lines += ["| 指标 | 这串数据 | 示范 25%–中位–75% | 分 |", "| --- | --- | --- | --- |"]
        for metric, row in v["metrics"].items():
            if row.get("shown"):
                lines.append(f"| {LABELS.get(metric, metric)} | {row['value']} | {row['p25']:.2f} – {row['median']:.2f} – {row['p75']:.2f} | {row['score']:.0f} |")
        lines += ["", "| 进度 | 0% | 25% | 50% | 75% | 100% |", "| --- | --- | --- | --- | --- | --- |"]
        rows = [("雪板方向（度，相对山下线）", "headingDeg"), ("外侧板立刃（度）", "leftEdgeDeg"), ("内侧板立刃（度）", "rightEdgeDeg"), ("身体内倾（度）", "bodyLeanDeg"),
                ("髋部朝向（度）", "pelvisYawDeg"), ("肩部朝向（度）", "shoulderYawDeg"), ("髋高（米）", "hipHeightM"), ("两板间距（米）", "stanceWidthM")]
        if max(c["insideLiftM"]) > 0:
            rows.append(("内侧板抬起（米）", "insideLiftM"))
        for label, name in rows:
            lines.append(f"| {label} | " + " | ".join(str(c[name][i]) for i in (0, 5, 10, 15, 20)) + " |")
        lines.append("")
    (ROOT / "docs" / "STANDARD_MOTIONS.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args()
    reference = load_reference()
    out = ROOT / "public" / "standard-motions"
    out.mkdir(parents=True, exist_ok=True)
    chosen = [s for s in SPECS if not args.ids or spec_id(s) in args.ids]
    with ProcessPoolExecutor(max_workers=6) as pool:
        for item in pool.map(_job, [(s, reference) for s in chosen]):
            (out / f"{item['id']}.json").write_text(json.dumps(item, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            v = item["verification"]
            print(item["id"].ljust(26), "overall", v["overall"], "shown", f"{v['shownInBand']}/{v['shownCount']}", "rms", v["fitRmsBodyHeights"], "T", item["motion"]["durationSec"], "W", item["motion"]["turnWidthM"], "v", item["motion"]["speedMs"], "seam", v["seamM"], flush=True)
    items = [json.loads((out / f"{spec_id(s)}.json").read_text(encoding="utf-8")) for s in SPECS if (out / f"{spec_id(s)}.json").is_file()]
    index = [{k: item[k] for k in ("id", "action", "level", "name")} | {"durationSec": item["motion"]["durationSec"], "overall": item["verification"]["overall"]} for item in items]
    (out / "index.json").write_text(json.dumps({"schema": "standard_motion_index.v1", "motions": index}, ensure_ascii=False), encoding="utf-8")
    write_docs(items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
