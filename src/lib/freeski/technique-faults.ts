import { metricStanding } from "./metric-insight";
import type { Scorecard } from "./scorecard";
import type { StandardMotionId } from "./standard-motion";

/**
 * The common problems the CSIA guides describe for each skiing quality, as the report and the standard motion
 * library explain them: how a problem shows on video, why it happens in terms of the forces on the skier, the
 * guide's development advice and the guide's drills for it. Criteria, advice and drills follow FreeSki's
 * rubrics/csia_criteria_2026.yaml, which the explanation FreeSki writes also draws from, so both say the same.
 */

/** Drills a guide names for these problems, with how the guide uses each (FreeSki's `exercises`). */
export const GUIDE_DRILLS = {
  hockey_stops: { zh: "曲棍球急停", en: "Hockey stops", source: "L1CG-2026 p.28",
    purposeZh: "用腿转动雪板：上身朝向山下不动，腿把雪板快速转横、立刃停住。",
    purposeEn: "Turn the skis with the legs: the upper body keeps facing downhill while the legs swing the skis across and set the edges to stop." },
  diagonal_side_slips: { zh: "斜向侧滑", en: "Diagonal side slips", source: "L1CG-2026 p.28",
    purposeZh: "放平雪板斜着往下滑，用腿控制雪板方向，体会上身不跟着转。",
    purposeEn: "Flatten the skis and slide diagonally down, steering them with the legs while the upper body stays still." },
  side_slips_on_off: { zh: "侧滑开关刃", en: "Side slips on and off", source: "L1CG-2026 p.28",
    purposeZh: "侧滑中交替立刃、放刃，注意两板一起放开，特别是下方板的刃。",
    purposeEn: "Side slip, setting and releasing the edges in turn; release both together, especially the downhill ski's edge." },
  rollerblade_turns: { zh: "轮滑式转弯", en: "Rollerblade turns", source: "L1CG-2026 p.26, p.28",
    purposeZh: "像轮滑一样两板同时换刃、内侧板早早并拢，可以先在平地上练。",
    purposeEn: "Change both edges together and match the inside ski early, like on rollerblades; it can start on the flats." },
  step_up_turns: { zh: "踏步转弯", en: "Step-up turns", source: "L1CG-2026 p.26",
    purposeZh: "弯中把内侧板提起来再放到外侧板旁边，让内侧脚更早变轻。",
    purposeEn: "Lift the inside ski in the turn and set it beside the outside ski, lightening the inside foot earlier." },
  one_ski_skiing: { zh: "单板转弯", en: "One-ski turns", source: "L1CG-2026 p.26",
    purposeZh: "只站在外侧板上转弯，体会平衡落在外侧脚上。",
    purposeEn: "Turn standing on the outside ski only, to feel the balance on the outside foot." },
  side_stepping: { zh: "向上横跨步", en: "Side stepping uphill", source: "L1CG-2026 p.24",
    purposeZh: "侧身一步步往坡上走，体会外侧板的内刃咬住雪面。",
    purposeEn: "Step sideways up the hill, feeling the inside edge of the outside ski bite into the snow." },
  stork_turns: { zh: "单腿转弯", en: "Stork turns", source: "L1CG-2026 p.28",
    purposeZh: "换弯时提起新的内侧脚，把平衡更早转到新的外侧板上。",
    purposeEn: "Lift the new inside foot at the turn change to move the balance onto the new outside ski earlier." },
  braquage: { zh: "原地小弯", en: "Braquage", source: "L3CG-EN-26 p.9", motion: "braquage-l3",
    purposeZh: "沿山下线慢速滑下，只用下半身左右转动平行的雪板，上身不动。",
    purposeEn: "Slide slowly down the fall line turning the parallel skis with the lower body only, the upper body still." },
  javelin: { zh: "标枪转弯", en: "Javelin turns", source: "L4CG-EN-25 p.10", motion: "javelin-l4",
    purposeZh: "抬起内侧板，只靠外侧板立刃抓雪画出弧线。",
    purposeEn: "Lift the inside ski and draw the arc on the outside ski's gripping edge alone." },
  hop_turn: { zh: "跳跃转弯", en: "Hop turns", source: "L3CG-EN-26 p.9", motion: "hop_turn-l3",
    purposeZh: "屈腿蓄力、伸展起跳，从一只外侧板跳到另一只外侧板，练屈伸的配合。",
    purposeEn: "Flex, extend and hop from one outside ski to the next, coordinating the flexing and extending." },
} as const satisfies Record<string, { zh: string; en: string; source: string; purposeZh: string; purposeEn: string; motion?: StandardMotionId }>;
export type DrillId = keyof typeof GUIDE_DRILLS;

/** How a problem is drawn: the skier moving with the forces on it, or a chart of what the video measures. */
export type DiagramKind = "upper_body" | "tipping_inside" | "inside_lag" | "flat_edges" | "turn_shape" | "rhythm" | "edge_timing" | "flexion";

export type FaultId = "upper_body_leads" | "tipping_inside" | "skis_apart" | "edge_slips" | "turn_unfinished" | "uneven_rhythm" | "edges_not_together" | "stiff_legs";

export type Fault = {
  id: FaultId; zh: string; en: string;
  /** The CSIA quality it falls short of, as the guide puts it. */
  criterionZh: string; criterionEn: string;
  /** The score card's measurements that show it. */
  metrics: string[];
  /** What it looks like on video. */
  seeZh: string; seeEn: string;
  /** Why it happens and what it does, in terms of the forces on the skier. */
  whyZh: string; whyEn: string;
  /** The guide's development advice. */
  fixZh: string; fixEn: string;
  drills: DrillId[];
  diagram: DiagramKind;
  /** Other problems that commonly cause this one; the report checks each against the student's measurements. */
  causes?: FaultId[];
  /** FreeSki's CSIA criterion ids, to list the problems an action is judged on. */
  criteria: string[];
  source: string;
};

export const FAULTS: readonly Fault[] = [
  { id: "upper_body_leads", zh: "上身带转", en: "The upper body leads the turn",
    criterionZh: "转动由下半身带动，上下半身分离", criterionEn: "The lower body leads the turning, separate from the upper body",
    metrics: ["upper_body_quiet_index", "rotation_rate"],
    seeZh: "肩线跟着雪板一起转，甚至比雪板先转；从正面看，胸口一直追着雪板的方向。",
    seeEn: "The shoulder line turns with the skis, or ahead of them; from the front, the chest keeps following the skis.",
    whyZh: "用肩和髋去拧雪板，转动是从上往下甩过去的：上身转到头，雪板被甩得横过来擦雪打滑，弯型成了急转的“Z”字，速度也不好控制。腿在稳定的上身下面转动雪板，转向来自雪板和雪面，身体一直在雪板上方。",
    whyEn: "Twisting the skis round with the shoulders and hips swings them from the top down: when the upper body runs out of turn the skis are flung across and skid, the turn becomes a sharp “Z” and speed is hard to control. Legs turning the skis under a quiet upper body steer through the skis and the snow, with the body staying over the skis.",
    fixZh: "练习用腿转动雪板，上身朝向山下、跟随，不由上身带进弯里。", fixEn: "Practise turning the skis with the legs, the upper body facing downhill and following rather than leading into the turn.",
    drills: ["hockey_stops", "diagonal_side_slips", "braquage"], diagram: "upper_body",
    criteria: ["base_of_support_leads", "rotary_steering", "upper_lower_independence", "lower_body_leads_rotation"], source: "L1CG-2026 p.24, p.28" },
  { id: "tipping_inside", zh: "身体向内倒，重心落在内侧板", en: "Tipping inside, the weight on the inside ski",
    criterionZh: "平衡落在外侧板上", criterionEn: "Balance on the outside ski",
    metrics: ["parallel_skis", "edge_angle"],
    seeZh: "从正面或背面看：弯中髋和肩落到内侧脚的里面，身体像一根棍子整个歪进弯里，内侧腿压着、外侧腿发飘。",
    seeEn: "From the front or behind: in the turn the hips and shoulders drop inside the inside foot, the body leans in like a stick, the inside leg carries the weight and the outside leg floats.",
    whyZh: "转弯时雪面给人的合力一定穿过重心。整个人向内倒，重心移到内侧板上方，这股力就主要压在内侧板上：外侧板变轻抓不住雪，内侧板又是外刃，容易滑开、两板分开。上身保持较直、髋向弯内折（反弓），重心落在外侧板的内刃上方，力就压在外侧板上。",
    whyEn: "The snow's push on a turning skier always passes through the centre of mass. Tipping in moves the centre of mass over the inside ski, so the push lands mostly on it: the outside ski goes light and loses its grip, while the inside ski is on its outside edge and slips or wanders. A quieter, more upright upper body with the hips angled into the turn keeps the centre of mass over the outside ski's inside edge, so the push lands on the outside ski.",
    fixZh: "把平衡放在外侧脚上：在弯中更早地让内侧脚变轻。", fixEn: "Balance on the outside foot: lighten the inside foot earlier in the turn.",
    drills: ["one_ski_skiing", "step_up_turns", "stork_turns"], diagram: "tipping_inside",
    criteria: ["outside_ski_balance", "skis_match", "balance"], source: "L1CG-2026 p.26" },
  { id: "skis_apart", zh: "两板不平行，内侧板跟不上", en: "Skis not parallel, the inside ski lags",
    criterionZh: "双板始终保持平行", criterionEn: "The skis stay parallel",
    metrics: ["parallel_skis"],
    seeZh: "两条小腿倾斜得不一样：外侧小腿倾进弯里，内侧小腿还立着，两板成“A”字，或者推开成“八”字。",
    seeEn: "The two lower legs tilt differently: the outside shin leans into the turn while the inside shin stays upright, so the skis form an “A” or are pushed into a wedge.",
    whyZh: "内侧腿没有和外侧腿一起倾倒，内侧板的立刃就比外侧板少，两只板画的弧不一样大，板头会分开或靠拢；内侧脚还压着重量时它也转不过来。两条腿一起倾倒、内侧脚变轻，两板才能画出平行的两条弧线。",
    whyEn: "When the inside leg does not tip with the outside leg, the inside ski is on less edge than the outside ski, the two skis draw different arcs and their tips part or close; while the inside foot still carries weight it cannot turn either. Both legs tipping together, with a light inside foot, draw two parallel arcs.",
    fixZh: "在弯中更早地让内侧脚变轻，让它跟着外侧板一起倾倒、并拢。", fixEn: "Lighten the inside foot earlier in the turn so it tips and matches with the outside ski.",
    drills: ["step_up_turns", "rollerblade_turns", "one_ski_skiing"], diagram: "inside_lag", causes: ["tipping_inside", "edges_not_together"],
    criteria: ["skis_parallel", "skis_match"], source: "L1CG-2026 p.26" },
  { id: "edge_slips", zh: "立刃不够，外侧板打滑", en: "Too little edge, the outside ski slips",
    criterionZh: "立刃抓雪，画出转向弧线", criterionEn: "The edges grip and draw a steered arc",
    metrics: ["edge_angle"],
    seeZh: "弯中小腿倾斜得很少，雪板几乎是平的；雪痕是一片横扫的擦痕，不是一条线。",
    seeEn: "The shins hardly tilt in the turn and the skis stay almost flat; the track is a wide smear rather than a line.",
    whyZh: "转弯要一股指向弯心的力，它只能来自雪板的刃卡住雪面。身体倾得不够、雪板太平，雪面推人的合力就落在外侧板之外，板子撑不住，只能横着滑出去。身体向弯内倾、小腿和脚踝向内转，刃立起来，合力落在外侧板的内刃上，板子才抓得住雪、画得出弧线。",
    whyEn: "A turn needs a push toward its centre, and only the skis' edges biting into the snow can give it. With too little tilt and flat skis the snow's push lands outside the outside ski, which cannot hold it and slides sideways. Tilting into the turn, rolling the shins and ankles in, stands the edge up so the push lands on the outside ski's inside edge, which grips and draws the arc.",
    fixZh: "练习站在外侧板的内刃上保持平衡，转弯时把转向那只脚的脚踝向内转。", fixEn: "Practise balancing on the inside edge of the outside ski, and roll the turning foot's ankle in as you turn.",
    drills: ["side_stepping", "javelin"], diagram: "flat_edges", causes: ["upper_body_leads"],
    criteria: ["edge_grip", "early_edge_grip"], source: "L1CG-2026 p.24, p.26" },
  { id: "turn_unfinished", zh: "弯没收完，弯型不圆", en: "Turns not finished, not round",
    criterionZh: "弯型圆滑，弯与弯连贯", criterionEn: "Round, linked turns",
    metrics: ["turn_completion_direction", "turn_closure"],
    seeZh: "髋的轨迹还没横过山坡就换刃了，弯像“Z”字：中间一下急转，前后都斜着往下冲。",
    seeEn: "The hips' path changes edges before it has come across the hill, so the turn is a “Z”: one sharp twist in the middle and straight runs down either side.",
    whyZh: "圆弧是均匀地转向，雪板一路只受不大的侧向力；“Z”字弯在一瞬间急转，侧向力一下子变得很大，板子抓不住就横滑，然后又笔直冲下去，越滑越快。在过山下线之前就开始转腿、把弯滑完整，力就均匀地分布在整个弧线上。",
    whyEn: "A round arc turns evenly, so the skis carry a modest sideways force all the way; a “Z” turns in an instant, the sideways force spikes, the skis skid, then they run straight down and speed builds. Starting to turn the legs above the fall line and finishing each turn spreads the force evenly over the whole arc.",
    fixZh: "在过山下线之前就开始转动腿部，并把每个弯滑完整。", fixEn: "Start turning the legs above the fall line and finish each turn.",
    drills: ["hockey_stops", "diagonal_side_slips"], diagram: "turn_shape", causes: ["upper_body_leads", "tipping_inside", "edge_slips", "uneven_rhythm"],
    criteria: ["round_linked_turns", "consistent_turn_shape"], source: "L2CG-EN p.5; L1CG-2026 p.24, p.26" },
  { id: "uneven_rhythm", zh: "节奏不稳", en: "Uneven rhythm",
    criterionZh: "节奏稳定，整段连贯", criterionEn: "A steady, flowing rhythm",
    metrics: ["turn_tempo", "rhythm_continuity"],
    seeZh: "有的弯快、有的弯慢，弯与弯之间会停一下或者横穿一段。",
    seeEn: "Some turns are quick and some slow, with a pause or a traverse between turns.",
    whyZh: "节奏乱的时候，每个弯的转向和用力都不一样：急的弯侧向力大、容易滑，慢的弯在横穿时掉了速度又要重新起步。节奏一致，每个弯的受力就差不多，速度也稳。",
    whyEn: "With an uneven rhythm every turn steers and loads differently: a rushed turn takes a big sideways force and slips, a slow one loses speed in the traverse and has to get going again. A steady rhythm gives every turn about the same forces and keeps the speed even.",
    fixZh: "用点杖帮助把握换刃的时机。", fixEn: "Use the pole touch to time the edge change.",
    drills: [], diagram: "rhythm",
    criteria: ["rhythmic_run"], source: "L3CG-EN-26 p.8; L1CG-2026 p.28" },
  { id: "edges_not_together", zh: "两板没有同时换刃", en: "The edges do not change together",
    criterionZh: "换弯时两板同时换刃", criterionEn: "Both skis change edges together",
    metrics: ["edge_change_sync"],
    seeZh: "换刃时一条腿先倒过去，另一条慢一拍，常见的是上方板先换、下方板还压在旧刃上。",
    seeEn: "At the edge change one leg tips over first and the other follows a beat later; often the uphill ski changes while the downhill ski stays on its old edge.",
    whyZh: "一只板已经在新刃上、另一只还在旧刃上，两只板朝不同方向切，板子会分开（推板）或者互相顶住，身体被卡在中间越不过雪板。两板同时放刃，重心才能顺畅地越过雪板进入新的弯。",
    whyEn: "With one ski on its new edge and the other still on the old one, the skis cut in different directions: they split into a stem or block each other, and the body is caught between them instead of crossing over. Releasing both edges together lets the centre of mass cross the skis smoothly into the new turn.",
    fixZh: "练习两板同时放刃：侧滑中开刃、关刃，注意放开下方板的刃。", fixEn: "Practise releasing both edges together: side slip setting and releasing the edges, focusing on releasing the downhill ski.",
    drills: ["side_slips_on_off", "rollerblade_turns"], diagram: "edge_timing",
    criteria: ["simultaneous_edge_change"], source: "L2CG-EN p.5; L1CG-2026 p.28" },
  { id: "stiff_legs", zh: "腿太直，屈伸不够", en: "Stiff legs, too little flexing and extending",
    criterionZh: "屈伸动作配合，带动身体越过雪板", criterionEn: "Flexing and extending carry the body across the skis",
    metrics: ["flexion_range"],
    seeZh: "整个弯里髋的高度几乎不变，腿一直是直的；遇到起伏时上身跟着颠。",
    seeEn: "The hips stay at the same height through the turn and the legs stay straight; over bumps the upper body jolts.",
    whyZh: "屈伸是调节雪板压力的办法：弯中屈腿吸收，换弯时伸展，把重心送过雪板进入新的弯。腿一直直着，压力只能靠身体硬扛，换弯时重心越不过雪板，就只能用上身甩过去。",
    whyEn: "Flexing and extending is how the pressure on the skis is managed: flex to absorb through the turn, extend at the change to send the centre of mass across the skis into the new turn. With straight legs the body has to take the pressure stiffly, and at the change the centre of mass cannot cross the skis, so the upper body throws it across.",
    fixZh: "用腿部伸展把重心重新放回雪板上方，重心越过雪板时放刃。", fixEn: "Extend the legs to bring the centre of mass back over the skis, and release the edges as it crosses them.",
    drills: ["stork_turns", "hop_turn"], diagram: "flexion",
    criteria: ["pressure_movements", "snow_contact"], source: "L2CG-EN p.5; L1CG-2026 p.27, p.28" },
];

export const faultById = (id: FaultId) => FAULTS.find(fault => fault.id === id)!;

type Metric = Scorecard["metrics"][number];

/** How a measurement stands for a problem: short of the examples, a low video estimate, fine, or not measured. */
export type Evidence = { metric: Metric; standing: "short" | "fine" };

/** The score card's say on a problem: each of its measurements, short of the examples or not. */
export function faultEvidence(fault: Fault, card: Scorecard): Evidence[] {
  return fault.metrics.flatMap(key => {
    const metric = card.metrics.find(entry => entry.key === key);
    if (!metric || metric.score === null) return [];
    const standing = metricStanding(metric);
    // A video estimate is not scored against a range; a low one still points at the problem.
    const short = standing === "work" || standing === "estimated" && metric.score < 60;
    return standing === "none" ? [] : [{ metric, standing: short ? "short" as const : "fine" as const }];
  });
}

/**
 * The problems a score card points to, most urgent first: those with a measurement short of the examples,
 * ordered by how far short (score) and how much the measurement counts (weight).
 */
export function faultsFor(card: Scorecard, limit = 3): { fault: Fault; evidence: Evidence[] }[] {
  return FAULTS.map(fault => ({ fault, evidence: faultEvidence(fault, card) }))
    .filter(entry => entry.evidence.some(item => item.standing === "short"))
    .map(entry => ({ ...entry, worst: Math.min(...entry.evidence.filter(item => item.standing === "short").map(item => item.metric.score ?? 100)),
      weight: Math.max(...entry.evidence.map(item => item.metric.weight)) }))
    .sort((a, b) => a.worst - b.worst || b.weight - a.weight)
    .slice(0, limit)
    .map(({ fault, evidence }) => ({ fault, evidence }));
}

/** Each action and level's CSIA criteria, in FreeSki's rubric (csia_criteria_2026.yaml `actions`). */
const ACTION_CRITERIA: Record<string, Record<number, string[]>> = {
  demonstration_parallel: {
    1: ["balance", "upper_lower_independence", "edge_grip", "consistent_turn_shape", "simultaneous_edge_change", "outside_ski_balance"],
    2: ["round_linked_turns", "consistent_speed", "rotary_steering", "base_of_support_leads", "simultaneous_edge_change"],
    3: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "rotary_steering", "edge_grip", "simultaneous_edge_change"],
    4: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "rotary_steering", "edge_grip", "skills_blended"] },
  intro_parallel: { 2: ["round_linked_turns", "consistent_speed", "outside_ski_balance", "skis_match"] },
  free_run: { 2: ["terrain_line", "consistent_speed", "snow_contact", "technical_elements"] },
  short_turn: {
    2: ["consistent_speed", "rotary_steering", "pressure_movements", "edge_grip"],
    3: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "early_edge_grip", "skis_parallel"],
    4: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "early_edge_grip", "pressure_movements", "skis_parallel"] },
  advanced_parallel: { 3: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "early_edge_grip"] },
  bumps: { 3: ["consistent_speed", "base_of_support_leads", "terrain_line", "rhythmic_run", "snow_contact", "early_edge_grip"],
    4: ["consistent_speed", "base_of_support_leads", "terrain_line", "rhythmic_run", "snow_contact"] },
  braquage: { 3: ["lower_body_leads_rotation", "momentum_fall_line", "skis_parallel", "steered_or_carved"] },
  hop_turn: { 3: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "controlled_hop", "ski_to_ski", "early_edge_grip", "skis_parallel", "lifted_ski_level"],
    4: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "controlled_hop", "ski_to_ski", "rotary_steering", "edge_grip", "skis_parallel", "lifted_ski_level", "technical_elements"] },
  expert_parallel: { 4: ["consistent_speed", "round_linked_turns", "symmetrical_turns", "base_of_support_leads", "early_edge_grip", "pressure_movements", "steered_or_carved"] },
  expert_all_terrain: { 4: ["consistent_speed", "terrain_line", "snow_contact", "technical_elements"] },
  expert_corridor: { 4: ["consistent_speed", "turn_size", "round_linked_turns", "symmetrical_turns", "rhythmic_run", "base_of_support_leads", "early_edge_grip", "pressure_movements"] },
  javelin: { 4: ["consistent_speed", "base_of_support_leads", "ski_to_ski", "rotary_steering", "edge_grip", "lifted_ski_level"] },
};

/** The problems that bear on what an action and level is judged on, in catalogue order. */
export function faultsForAction(action: string, level: number): Fault[] {
  const criteria = new Set(ACTION_CRITERIA[action]?.[level] ?? []);
  return FAULTS.filter(fault => fault.criteria.some(criterion => criteria.has(criterion)));
}
