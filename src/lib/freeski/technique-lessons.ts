import type { FaultVariant } from "./technique-forces";
import type { FaultId } from "./technique-faults";

/**
 * The 3D lesson for each problem, in the order the CSIA guides teach movement analysis: what it looks like, why
 * (the forces), what to do instead, then the two side by side. Each step starts from its own camera; the viewer can
 * turn it freely. The pictures are the generated standard and the same skier with one thing changed.
 */
export type LessonStep = "look" | "why" | "fix" | "compare";
export const LESSON_STEPS: readonly LessonStep[] = ["look", "why", "fix", "compare"];
export const STEP_NAMES: Record<LessonStep, [string, string]> = { look: ["看问题", "The problem"], why: ["为什么", "Why"], fix: ["怎么改", "The fix"], compare: ["对比", "Side by side"] };

/** A camera: round the skier, above the snow, and how far out; a close view in a path lesson frames the skier rather than the path. */
export type LessonView = { azimuth: number; elevation: number; zoom: number; close?: boolean };

/** What a lesson draws over the skier. */
export type LessonLayer =
  /** The snow's push on each foot, its size the force. */
  | "feet"
  /** The centre of mass and the push through it from where it meets the snow. */
  | "push"
  /** Rotation passed through the body: a spiral up (or down) the body, and rings at the feet and shoulders for how fast each turns. */
  | "rotation"
  /** Each ski's edge angle, written beside it. */
  | "edges"
  /** The hips' height through the turn. */
  | "hips"
  /** The piste and the path down it, seen from above. */
  | "track";

export type Lesson = {
  id: FaultId;
  /** A body changed into the fault ("pose"), or a path down the piste ("path"). */
  kind: "pose" | "path";
  variant: FaultVariant;
  /** For a path lesson: the fault's path, late "z" turns, or turns of uneven length. */
  path?: "z" | "uneven";
  layers: LessonLayer[];
  /** The camera each step starts from. */
  views: Record<LessonStep, LessonView>;
  captions: Record<LessonStep, [string, string]>;
};

const same = (view: LessonView): Record<LessonStep, LessonView> => ({ look: view, why: view, fix: view, compare: view });
const REAR: LessonView = { azimuth: 0, elevation: 8, zoom: 1 };

export const LESSONS: Record<FaultId, Lesson> = {
  upper_body_leads: { id: "upper_body_leads", kind: "pose", variant: "upper_body", layers: ["rotation"],
    views: { look: { azimuth: 160, elevation: 14, zoom: 1 }, why: { azimuth: 25, elevation: 34, zoom: 1.05 }, fix: { azimuth: 25, elevation: 34, zoom: 1.05 }, compare: { azimuth: 20, elevation: 40, zoom: 1.1 } },
    captions: {
      look: ["看肩线：橙色的人先转肩、胸口追着雪板，雪板是被上身甩过去的。", "Watch the shoulders: orange turns them first, the chest chasing the skis, and the skis get swung round after."],
      why: ["红色螺旋从上往下：转动从肩传到雪板，雪板被甩横、擦雪打滑，弯就成了急转的 Z 字。", "Red spiral, top down: the turning goes from the shoulders to the skis, which are flung across and skid, and the turn becomes a sharp Z."],
      fix: ["绿色螺旋从下往上：脚和腿先转动雪板，再带着髋和上身跟上；肩一直朝向山下。", "Green spiral, bottom up: the feet and legs turn the skis first and the hips and upper body follow; the shoulders keep facing downhill."],
      compare: ["脚下的圈是雪板转得多快，肩上的圈是上身转得多快：标准动作脚转得多、肩转得少。", "The ring at the feet is how fast the skis turn, the one at the shoulders how fast the upper body turns: the standard turns the feet a lot and the shoulders little."],
    } },
  turn_unfinished: { id: "turn_unfinished", kind: "path", variant: "correct", path: "z", layers: ["track", "feet"],
    views: { look: { azimuth: 0, elevation: 62, zoom: 1 }, why: { azimuth: 30, elevation: 24, zoom: 1.6, close: true }, fix: { azimuth: 30, elevation: 24, zoom: 1.6, close: true }, compare: { azimuth: 0, elevation: 62, zoom: 1.35 } },
    captions: {
      look: ["从上往下看雪道：橙色的弯像 Z 字，还没横过山坡就换刃，中间一下急转，前后都斜着往下冲。", "Looking down on the piste: orange's turns are Z-shaped, changing edges before coming across the hill, one sharp twist in the middle and straight runs either side."],
      why: ["箭头是雪面推每只脚的力：Z 字弯在中间一下猛增，雪板抓不住就横滑，雪痕变宽。", "The arrows are the snow pushing on each foot: in a Z the push jumps in the middle, the skis cannot hold it and skid, and the track widens."],
      fix: ["圆弧弯在过山下线之前就开始转、把弯滑完：外脚的力从弯的上半段慢慢加上去，均匀，不突变。", "A round turn starts turning above the fall line and finishes: the outside foot's push builds from the top of the turn, steadily, with no spike."],
      compare: ["同样宽的雪道，左边 Z 字、右边圆弧：比较两条轨迹的形状和脚下箭头的大小。", "The same piste, a Z on the left and round turns on the right: compare the tracks' shapes and the arrows under the feet."],
    } },
  tipping_inside: { id: "tipping_inside", kind: "pose", variant: "tipping_inside", layers: ["feet", "push"], views: same(REAR),
    captions: {
      look: ["从背后看：橙色的人整个身体像一根棍子倒进弯里，髋和肩落到内侧脚的里面。", "From behind: orange leans in like a stick, the hips and shoulders inside the inside foot."],
      why: ["合力（蓝线）一定穿过重心（圆球）。整个人内倒，合力就压到内侧板上：外脚的箭头变小，外板变轻抓不住雪。", "The push (blue) always passes through the centre of mass (the ball). Leaning in puts it on the inside ski: the outside foot's arrow shrinks and the outside ski goes light."],
      fix: ["上身保持较直、髋向弯内折：重心落在外板内刃上方，外脚的箭头最大。", "The upper body more upright and the hips angled in: the centre of mass sits over the outside ski's inside edge, and the outside foot's arrow is the largest."],
      compare: ["比较两只脚的箭头：标准动作压在外脚上，内倒的压在内脚上。", "Compare the feet's arrows: the standard loads the outside foot, tipping in loads the inside one."],
    } },
  skis_apart: { id: "skis_apart", kind: "pose", variant: "inside_lag", layers: ["edges", "feet"], views: same({ azimuth: 180, elevation: 10, zoom: 1 }),
    captions: {
      look: ["看两条小腿：外侧小腿倒进弯里，内侧小腿还立着，两只板成 A 字。", "Watch the shins: the outside one tilts into the turn, the inside one stays upright, and the skis form an A."],
      why: ["内侧板立刃少、画的弧不一样大，板头就分开；内脚还压着重量，它也转不过来。", "The inside ski is on less edge and draws a different arc, so the tips part; while the inside foot still carries weight it cannot turn either."],
      fix: ["两条腿一起倾倒、内脚变轻：两只板立刃一样，画出两条平行的弧线。", "Both legs tip together and the inside foot goes light: both skis on the same edge, drawing two parallel arcs."],
      compare: ["看雪板旁的角度：标准动作两只板的立刃角度接近。", "Read the angles beside the skis: the standard's two edge angles are close."],
    } },
  edge_slips: { id: "edge_slips", kind: "pose", variant: "flat_edges", layers: ["push", "feet", "edges"], views: same(REAR),
    captions: {
      look: ["雪板几乎是平的，小腿倾斜得很少，雪痕是一片横扫的擦痕。", "The skis are almost flat, the shins hardly tilt, and the track is a wide smear."],
      why: ["合力落到外板外侧（变红）：板子撑不住这股力，只能横着滑出去。", "The push lands outside the outside ski (it turns red): the ski cannot hold it and slides sideways."],
      fix: ["身体向弯内倾、脚踝和小腿向内转：刃立起来，合力落在外板内刃上，雪痕是一条线。", "Tilt into the turn and roll the ankles and shins in: the edge stands up, the push lands on the outside ski's inside edge, and the track is a line."],
      compare: ["比较雪痕：左边是宽宽的擦痕，右边是干净的刻线。", "Compare the tracks: a wide smear on the left, a clean line on the right."],
    } },
  uneven_rhythm: { id: "uneven_rhythm", kind: "path", variant: "correct", path: "uneven", layers: ["track", "feet"],
    views: { look: { azimuth: 0, elevation: 62, zoom: 1.15 }, why: { azimuth: 30, elevation: 24, zoom: 1.6, close: true }, fix: { azimuth: 30, elevation: 24, zoom: 1.6, close: true }, compare: { azimuth: 0, elevation: 62, zoom: 1.4 } },
    captions: {
      look: ["从上往下看：橙色的弯有大有小、有快有慢。", "From above: orange's turns are big and small, quick and slow."],
      why: ["急的弯脚下的力突然变大、容易打滑；慢的弯在横穿时掉了速度，又要重新起步。", "A rushed turn's push jumps and it slips; a slow one loses speed in the traverse and has to get going again."],
      fix: ["每个弯一样大、一样快，用点杖把握换刃的时机：每个弯脚下的力都差不多。", "Every turn the same size and pace, the pole touch timing the edge change: each turn's push is about the same."],
      compare: ["左边节奏乱，右边均匀：看轨迹和箭头的变化。", "Uneven on the left, steady on the right: watch the tracks and the arrows."],
    } },
  edges_not_together: { id: "edges_not_together", kind: "pose", variant: "edge_lag", layers: ["edges", "feet"], views: same({ azimuth: 180, elevation: 12, zoom: 1 }),
    captions: {
      look: ["慢看换刃：橙色的一条腿先倒过去，另一只板还停在旧刃上。", "The edge change, slowly: one of orange's legs tips over first while the other ski stays on its old edge."],
      why: ["一只板在新刃、一只在旧刃，两只板朝不同方向切，推成八字或者互相顶住，身体越不过雪板。", "One ski on its new edge and one on its old: they cut different ways, splitting into a wedge or blocking each other, and the body cannot cross over."],
      fix: ["两只板同时放刃、同时立上新刃，重心顺畅地越过雪板进入新的弯。", "Release both edges together and set both new edges together: the centre of mass crosses the skis smoothly into the new turn."],
      compare: ["看雪板旁的角度：标准动作两只板同时经过 0°。", "Read the angles beside the skis: the standard's pass 0° together."],
    } },
  stiff_legs: { id: "stiff_legs", kind: "pose", variant: "stiff", layers: ["hips", "push"], views: same({ azimuth: 90, elevation: 8, zoom: 1 }),
    captions: {
      look: ["从侧面看：橙色的人整个弯里髋的高度几乎不变，腿一直是直的。", "From the side: orange's hips stay at one height through the turn and the legs stay straight."],
      why: ["腿不屈伸，压力只能靠身体硬扛；换弯时重心越不过雪板，只好用上身甩过去。", "Without flexing and extending the body takes the pressure stiffly, and at the change the centre of mass cannot cross the skis, so the upper body throws it across."],
      fix: ["弯中屈腿吸收，换弯时伸展，把重心送过雪板：髋一起一伏。", "Flex to absorb through the turn and extend at the change to send the centre of mass across: the hips rise and sink."],
      compare: ["竖条是这个弯里髋高的变化范围：标准动作的起伏明显大得多。", "The bars are the hips' range of height through the turn: the standard's is clearly larger."],
    } },
};
