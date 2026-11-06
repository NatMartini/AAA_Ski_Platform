"""What the CSIA guides ask of each run, as inputs to the standard motions.

`run`, `qualities` and `source` restate the candidate guides (2026-27 where they publish the run).
The guides give speed as a class and size in cat tracks, never in numbers, so the numbers are this
generator's assumptions: speed classes in SPEED, one cat track = CAT_TRACK metres (the L2 guide's
9-11 m demonstration parallel against the L3/L4 guides' 1.5-2.5 cat tracks).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

CAT_TRACK = 4.5
SPEED = {"slow": 3.5, "intermediate": 9., "advanced": 11.5, "expert": 14.}   # m/s
PITCH = {"green": 10., "blue": 16., "advanced": 22., "black": 26., "expert": 30.}   # degrees


@dataclass(frozen=True)
class Spec:
    action: str
    level: int
    name_zh: str
    name_en: str
    speed: str
    performance: str              # steered | carved | skidded
    pitch: str
    surface: str                  # groomed | bumps | ungroomed
    size_m: Optional[tuple]       # turn size range, metres
    qualities_zh: tuple
    source: str
    # Character the guide's words require, on top of the demonstrations' numbers.
    travel: float = .82           # 1 = travel follows the ski, 0 = skidding straight down the fall line
    speed_share: float = 1.       # of the speed class's number, where the terrain holds everyone back
    reference: Optional[str] = None  # another group's curves when this action has no demonstration
    duration: Optional[float] = None  # seconds per turn when the demonstrations' timing does not apply
    extras: dict = field(default_factory=dict)  # fixed channels that define the action
    notes_zh: tuple = ()          # what the generator did because of the guide's words


def _cat(a, b):
    return (a * CAT_TRACK, b * CAT_TRACK)


ROUND = "弯型圆滑、弯与弯连贯、左右对称"
BOS = "由双脚和雪板带动身体重心"
ROTARY = "旋转动作给出这条线路需要的转向"
EDGE = "立刃抓雪，画出转向弧线"
SIMUL = "换弯时两板同时换刃"
PARALLEL = "双板全程平行"
CONSISTENT = "速度和弯型保持一致"
PRESSURE = "屈伸配合，让重心横越滑道"

SPECS = (
    Spec("demonstration_parallel", 1, "示范平行弯", "Demonstration parallel", "intermediate", "steered", "blue", "groomed", (7., 11.),
         ("上下半身分离，用腿转动", EDGE, "每个弯的弯型一致", SIMUL, "平衡落在外侧板上"), "L1CG-2026 p.33"),
    Spec("demonstration_parallel", 2, "示范平行弯", "Demonstration parallel", "intermediate", "steered", "blue", "groomed", (9., 11.),
         (ROUND, CONSISTENT, ROTARY, BOS, SIMUL), "L2CG-EN p.5"),
    Spec("demonstration_parallel", 3, "示范平行弯", "Demonstration parallel", "intermediate", "steered", "advanced", "groomed", _cat(1.5, 2.5),
         (CONSISTENT, ROUND, BOS, ROTARY, EDGE, SIMUL), "L3CG-EN-26 p.7"),
    Spec("demonstration_parallel", 4, "示范平行弯", "Demonstration parallel", "intermediate", "steered", "expert", "groomed", _cat(1.5, 2.5),
         (CONSISTENT, ROUND, BOS, ROTARY, EDGE, "各项技能精准融合"), "L4CG-EN-26 p.11"),
    Spec("intro_parallel", 2, "入门平行弯", "Intro to parallel", "intermediate", "steered", "green", "groomed", (8., 12.),
         ("弯型圆滑、弯与弯连贯", CONSISTENT, "起弯就有外侧板的转向角，平衡压在外侧板上", "过了山下线之后双板并成平行"), "L2CG-EN p.6",
         extras={"wedge": .50, "wedge_opens": .24, "wedge_full": .56, "wedge_matches": .82},
         notes_zh=("外侧板先转出转向角形成小犁式，内侧板在过山下线后转到平行。",)),
    Spec("free_run", 2, "自由滑行", "Free run", "intermediate", "steered", "blue", "ungroomed", (5., 9.),
         ("弯型和线路随地形调整", CONSISTENT, "用屈伸吸收控制雪面接触", "体现 CSIA 技术要素"), "L2CG-EN p.5",
         extras={"snow": .05},
         notes_zh=("加了小幅雪面起伏，由腿部屈伸吸收，髋部高度保持平稳。",)),
    Spec("short_turn", 2, "小回转", "Short turns", "intermediate", "steered", "blue", "groomed", (2.5, 4.5),
         (CONSISTENT, "转向让重心横越滑道", "过山下线后可以看到抓雪"), "L2CG-EN p.5", travel=.7),
    Spec("short_turn", 3, "小回转", "Short turns", "advanced", "steered", "black", "groomed", (2.8, 5.),
         (CONSISTENT, ROUND, BOS + "，在山下线或之前可以看到抓雪", PARALLEL), "L3CG-EN-26 p.7", travel=.7),
    Spec("short_turn", 4, "小回转", "Expert short radius", "expert", "steered", "expert", "groomed", _cat(.9, 1.5),
         (CONSISTENT, ROUND, BOS + "，在山下线之前抓雪", "屈伸配合，让重心横越滑道", PARALLEL), "L4CG-EN-26 p.11", travel=.72),
    Spec("advanced_parallel", 3, "进阶平行弯", "Advanced parallel", "advanced", "steered", "advanced", "groomed", _cat(2., 3.),
         (CONSISTENT, ROUND, BOS + "，在山下线之前抓雪"), "L3CG-EN-26 p.8"),
    Spec("expert_parallel", 4, "专家平行弯", "Expert parallel", "expert", "carved", "expert", "groomed", _cat(2., 3.),
         (CONSISTENT, ROUND, BOS + "，在山下线之前抓雪", "屈伸配合，让重心偏转横越滑道"), "L4CG-EN-26 p.11", travel=.95,
         notes_zh=("刻滑：雪板方向和行进方向几乎一致，只留很小的侧滑角。",)),
    Spec("bumps", 3, "蘑菇地形", "Bumps", "advanced", "steered", "black", "bumps", (1.5, 3.2),
         ("速度保持进阶且一致", BOS, "弯型和线路随地形调整", "各项技能融合成有节奏的山下线滑行", "屈伸配合，随时控制雪面接触", "在山下线之前抓雪"), "L3CG-EN-26 p.8", travel=.75, speed_share=.6,
         extras={"snow": .17},
         notes_zh=("雪面在换刃处隆起、弯中下陷，腿部屈伸吸收，髋部高度基本不变。", "蘑菇地形里的实际速度低于压雪道，这里按同一速度等级的六成算。")),
    Spec("bumps", 4, "蘑菇地形", "Expert bumps", "expert", "steered", "expert", "bumps", (1.5, 3.2),
         ("速度保持一致", BOS, "弯型和线路随地形调整", "各项技能融合成有节奏的山下线滑行", "屈伸配合，随时控制雪面接触"), "L4CG-EN-26 p.12", travel=.75, speed_share=.6,
         extras={"snow": .20},
         notes_zh=("雪面在换刃处隆起、弯中下陷，腿部屈伸吸收，髋部高度基本不变。", "蘑菇地形里的实际速度低于压雪道，这里按同一速度等级的六成算。")),
    Spec("braquage", 3, "原地小弯", "Braquage", "slow", "skidded", "black", "groomed", None,
         ("旋转动作由下半身带动", "动量主要沿山下线", PARALLEL, "技能配合和换弯时机不产生弧线"), "L3CG-EN-26 p.9", travel=.12,
         notes_zh=("重心基本沿山下线下滑，雪板左右转动，不画弧线；上身始终朝山下。",)),
    Spec("hop_turn", 3, "跳跃转弯", "Edge to edge hop turn", "intermediate", "carved", "green", "groomed", (5., 10.),
         (CONSISTENT, "弯型圆滑、左右对称", "雪板转向带动重心", "屈伸配合，受控地从外侧板跳到外侧板", "立刃后马上抓雪，画出刻滑弧线", PARALLEL, "内侧板板头板尾和雪面的距离保持一致"), "L3CG-EN-26 p.9", travel=.9,
         extras={"inside_lift": .17, "lift_from": .06, "lift_to": .90, "hop": .11, "hop_half": .09},
         notes_zh=("转弯时站在外侧板上，内侧板平行抬离雪面；换弯时小跳，从外侧板落到新的外侧板。",)),
    Spec("hop_turn", 4, "跳跃转弯", "Ski to ski hop turn", "intermediate", "steered", "blue", "groomed", _cat(2., 3.),
         (CONSISTENT, "弯型圆滑、左右对称", BOS, "屈伸配合，受控地从外侧板跳到外侧板", "旋转和立刃融合，画出转向弧线", "双板全程平行", "内侧板板头板尾和雪面的距离保持一致"), "L4CG-EN-26 p.13", travel=.82,
         reference="hop_turn|3|pass", duration=2.6,
         extras={"inside_lift": .17, "lift_from": .06, "lift_to": .90, "hop": .11, "hop_half": .07},
         notes_zh=("FreeSki 没有 4 级跳跃转弯的示范：身体动作参考 3 级示范，弯的大小和时长按 4 级指南（2 到 3 条压雪车道）。",)),
    Spec("expert_all_terrain", 4, "专家全地形", "Expert all terrain", "expert", "steered", "expert", "ungroomed", None,
         ("速度受控", "弯型和线路随地形调整", "随时控制雪面接触", "持续体现 CSIA 技术要素"), "L4CG-EN-26 p.12", travel=.6,
         extras={"snow": .10},
         notes_zh=("指南要求半径随地形变化，这里给出一个代表性的中小半径弯；雪面起伏由腿部吸收。",)),
    Spec("expert_corridor", 4, "定宽走廊", "Expert corridor", "advanced", "steered", "advanced", "groomed", (8., 12.),
         ("速度一致", "用满走廊宽度，弯型圆滑、连贯、对称，落差一致", BOS + "，在山下线之前抓雪", "屈伸配合，把重心引向横越山坡"), "L4CG-EN-26 p.13"),
    Spec("javelin", 4, "标枪转弯", "Javelin turns", "intermediate", "steered", "blue", "groomed", _cat(1.5, 2.5),
         ("速度一致", BOS, "从平行站姿起步，先抬起新的内侧板，再把外侧板转到它下方", ROTARY, "外侧板立刃抓雪，画出转向弧线", "内侧板板头板尾和雪面的距离保持一致，换弯前放回雪面"), "L4CG-EN-25 p.10",
         extras={"inside_lift": .22, "lift_from": .10, "lift_to": .84, "lift_cross": .42},
         notes_zh=("抬起的内侧板保持原来的方向，外侧板从它下方转过，两板交叉；换弯前内侧板放回雪面、恢复平行。",)),
)


def spec_id(spec: Spec) -> str:
    return f"{spec.action}-l{spec.level}"
