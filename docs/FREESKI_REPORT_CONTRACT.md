# FreeSki 分析报告接口约定：评分卡、教学解释、关键帧、慢动作讲解

草案 v1.1，2026-10-26。FreeSki（`J:\Freeski\FreeSkiclaude`，由 Freeski 对话实现）提供，
Ski Platform（本仓库）消费。字段名用英文，说明用中文。双方有分歧时先改本文件再改代码。

v1.1 相对 v1 的改动（由 Freeski 对话修改，2026-10-26）：
- §0.2、§0.4 按社长当天在 Freeski 对话里的回答改写：估算指标只显示不计分；总分取全部中间弯平均，启动弯和结束弯单独列出、不计入总分，不取“较好的几个弯”。
- §2 新增 `turns[].role`、`metrics[].band`、`turns[].metrics[].band`、`metrics[].position`；`overall.aggregation` 改为 `middle_turns_mean`；`quality_reasons` 去掉 `estimated_edging`。
- §3 报告新增 `explainerStatus`；写明哪些字段由代码生成。
- §4 写明关键帧的选取规则。
- §5 新增慢动作讲解视频（社长当天要求：对比 CSIA 视频做骨架视频对比，用慢动作动画讲解哪里不一样）。
- §7 样例增加 `explainer.json`。
- 同日补充（应网站方提问）：§6 写明显示弯号 = `turn_id` 数字 + 1，以及 `scorecard.level` 原样回显任务的 `level`（如 `level2`）；
  样例已按 `level2` 重新生成。讲解清单里的 `bytes` 是可选字段。
- 同日（社长定下改进顺序后）：§2 新增逐弯画面证据门槛 `turns[].evidence`、`overall.turns_excluded` 和质量原因
  `excluded_turns`，参考库标定按同一门槛重建；§3 不再把总分给模型、模板和教学文字都不提总分；§5 讲解片头不再显示总分。
- 同日验收后补充：§2 写明钟形指标的 `target` 在没有分数时也给出、仅在标准动作缺该指标时为 `null`；
  §5 的每弯 `reference_status` 增加 `not_available`，汇总 `reference` 增加 `not_available`、按各弯是否一致取值或 `mixed`。
- 2026-10-27（应网站复测 A–E）：§2 小人物门槛由 60 提到 120 像素，`scoring_version` 升为 `freeski-scorecard-4`
  （参考分布不变，`calibration_id` 随之变为 `scal-db23bfdcf9ac0b72`）；§4 关键帧条目新增 `reference_status`，右上角标题随它变化；
  §5 讲解片头显示动作中文名/英文名，慢动作字幕和右侧说明随每弯参考状态变化；§5 报告 `turns[]` 新增 `comparisonReference`，
  写明它与 `referenceAvailable` 的区别。已渲染的关键帧和讲解视频会在下次读取时按新画法重做。
- 同日（应网站请求）：§2 `calibration` 新增 `reference_target`，直接写明这次实际对比的示范组，网站按它显示、不再推断。
  只是新增说明字段，分数不变，`scoring_version` 不变。
- 同日（应网站对第一份动作解释的意见）：§3 提示词升为 `teaching-v3`。事实新增 `label_zh`/`label_en`（与评分卡同名）；
  模型拿到动作名和对比对象的名称，并必须照用；校验器新增拒收：不用评分卡指标名、用“标准示范/标准动作”等泛称、程度词
  “明显/显著/大幅”、正文里出现事实编号（括号里的会被代码删掉）。练习的 `name_zh` 只放中文，限制说明改为“只显示、不计分”。
  旧任务已生成的解释不重做。
- 同日（社长决定改学员跟踪规则）：`scoring_version` 升为 `freeski-scorecard-5`（`calibration_id` `scal-86e2ea6889dae61e`，
  参考分布不变）。跟踪器 `persistent_bbox.v2`：附近无人时，压在学员身上的重复检测框不再判为交叉；丢失后若画面里
  只剩一个人并持续 1 秒，就重新锁定他。§2 新增 `turns[].evidence.reacquired` 和质量原因 `subject_reacquired`。
  旧版本缓存的姿态不再沿用，同一视频再次提交会重新提取姿态（多几分钟）。
- 同日（应网站复测意见 A、B）：`scoring_version` 升为 `freeski-scorecard-6`（`calibration_id` `scal-9d76325e47a4620d`）。
  “双板同倾”`ski_tilt_parallel_rate` 撤下：不计分、不显示、不进教学事实（参考库里各级 pass 示范反而低于 intro，指标本身无效）。
  §3 提示词升为 `teaching-v4`：改进项只能引用 `reference_band` 为 `below`（钟形指标为绿区外）的事实，优点不能引用这类事实；
  对比对象写成“和……相比”。
- 同日（社长定下参考库、跟踪和钟形指标三项）：`scoring_version` 升为 `freeski-scorecard-7`（`calibration_id` `scal-ee8c624424e66258`）。
  参考库改由 38 段 CSIA gold 示范重建（`reference_clip_count` 47 → 38，原库有 12 组重复），姿态用与用户上传相同的
  跟踪管线提取；改善路径的 expert / advanced / intermediate 就是同一技能 L4 / L3 / L2 的 pass 示范组。跟踪器升为
  `persistent_bbox.v3`：丢失后若画面里有一个人的框面积是其他人的 2 倍以上、并且是同一个框持续 1 秒，也重新锁定
  （同样标 `reacquired`）。钟形指标（`rotation_rate`、`turn_tempo`）对比某一级示范时（`reference_target` 为 `levelN`），
  绿区放宽到包含同一动作更高级别 pass 示范的中位数：滑得更像高级别示范不扣分，反方向照旧扣分；对比专家 / 进阶示范和
  L4 时不变。旧版本缓存的姿态不再沿用。
- 同日（社长决定，经网站转达）：改善路径对比学员“上一级”的通过示范。§1 提交新增 `current_level`，§2 评分卡顶层新增
  `current_level`、`reference_target` 在改善路径上也可能是 `level1`…`level4`，§6 任务状态回显 `current_level`，§7 新增样例
  `job-result-improvement.json`。不带 `current_level` 的改善路径请求照旧对比专家示范。骨架对比（关键帧、讲解视频）画的是
  评分卡实际对比的那段示范；顺带修正：认证路径里文件夹名是别名的动作（小回转、L1、跳跃转弯、标枪、L4 蘑菇）以前画成了
  改善路径的专家示范，现在画所选级别的 pass 示范。
- 同日（社长要求按 CSIA 2026-27 四个级别的考生指南把动作要求量化成视频能测的指标）：评分卡列出的指标改为
  “计分指标 + 该动作该级别 CSIA 要求对应的指标”，对应表是 FreeSki 的 `server/rubrics/csia_criteria_2026.yaml`。
  新增两项视频估算，只显示、不计分：`edge_change_sync`（换刃同步：换刃时左右小腿越过竖直的时间差，只在正面或背面
  镜头下测）和 `flexion_range`（屈伸幅度：弯中髋到踝的高度变化，以躯干长度计，钟形）。`early_edging`、`edge_build`、
  `edging_similarity` 在 gold 示范上验证无效（pass 不比 intro 好），和 `ski_tilt_parallel_rate` 一样撤下。
  视频测不了的指标和要求（速度、弯的大小、雪面压力、线路、刻滑还是转向等）一律不显示：`unavailable_metrics` 保留、
  恒为 `[]`。§3 提示词升为 `teaching-v5`：模型另拿到该动作能测的 CSIA 要求及对应指标。
  计分指标 `stance_width_consistency`（站距稳定）同样验证无效（pass 好于 intro 只有 8/16），社长决定撤下：不计分、不显示，
  各动作其余计分指标的权重按比例重新归一，所以总分会变（同属 `freeski-scorecard-7`，此前没有存下过 -7 的评分卡）。
- 同日（网站实测意见 A–D 和上线准备）：§2 直条指标的 `band` 改按好坏方向，越低越好的指标（`edge_change_sync`）按原始值翻转，
  `below` 永远表示差于示范常见范围。§3 提示词升为 `teaching-v6`：修正改善路径上写出“CSIA N 级通过示范”里的级别数字被拒、
  导致整份解释 `failed` 的错误；拒收“符合/满足/达到/体现……标准/要求”“达标”及英文 meets/satisfies… criterion 一类说法；
  某个指标被改进项引用时，引用同一指标的优点一律删掉。§4/§5 图注和字幕把“标准动作”统一改为“示范”，关键帧右上角和慢动作字幕
  写出实际对比的示范（如“CSIA 2 级通过示范”）；讲解视频优先选定格指标在范围外的弯。已渲染的关键帧和讲解会按新画法重做。
  §6 任务状态新增 `queue_reason`。以上不改分数。
- 2026-10-28（社长要求：大模型输出的文字解释动作全部引申于 CSIA 的标准）：§3 提示词升为 `teaching-v10`。
  每条优点、改进和练习理由都必须写且只写一条“对应 CSIA 要求：{要求名}”，而且是所引事实的指标对应的要求；
  模型讲动作只能用该要求在指南里的描述和改进建议（`criteria[].guide_*`、`develop_*`，出自 2026-27 各级考生指南，
  L1 的“常见问题与对策”）。本级别指南没有对应要求的指标，借用最近的指南条目（同一动作最近级别优先，再到其他动作），
  要求名后面写明出处，如“双板始终保持平行（3 级小回转）”；任何指南都没有对应要求的指标不进教学事实。
  练习只从指南里出现过的练习中选（`csia_criteria_2026.yaml` 的 `exercises`，12 个），理由里的要求必须是指南用这个练习练的那条；
  原练习目录里指南没有的 11 个（`railroad_tracks`、`garlands`、`pole_plant_rhythm` 等）不再出现，新增 `diagonal_side_slips`、
  `side_slips_on_off`、`rollerblade_turns`、`step_up_turns`、`side_stepping`、`stork_turns`；保留的练习 id 不变，中文名改用指南叫法
  （如 `braquage` 原地小弯、`javelin` 标枪转弯、`hop_turn` 跳跃转弯）。`summary_*` 一律是代码模板，模型不再写总结。
  `limitations_*` 加一条说明讲解出处。分数不变。

## 0. 已确定的产品决定

1. 本地模型可以写教学解释和练习建议，但只能依据代码算出的对比事实（§3 `facts`），讲动作的内容全部出自
   CSIA 考生指南（社长 2026-10-28）。每条结论必须引用事实 ID 并写明对应的 CSIA 要求，否则丢弃。全部标为试验性。
2. 视频估算指标（目前列出的是 `edge_angle`、`edge_change_sync`、`flexion_range`）**只显示、不计分**：
   列在评分卡里，标 `measurement: "estimated"`，`weight` 恒为 0，不给原始值，可以作为教学事实引用
   （措辞须为“视频估算/看起来”）。它们不影响总分和质量标签。
3. 视频测不了的指标和考核要求（需要传感器的 `g_force`、`weight_release`，以及速度、弯的大小、雪面压力、线路等）
   不计分、也不显示（社长 2026-10-27 决定）；`unavailable_metrics` 恒为空数组。
4. 评分结构参考 Carv：逐指标对比标准分布 → 0–100 分（钟形指标用目标区间）→ 按动作加权得每弯分
   → **全部中间弯的平均**得总分 → 附质量标签。启动弯（视频里从静止起步后的第一个弯）和结束弯
   （停下前的最后一个弯）照样打分，单独列出、不计入总分；不做“取较好的几个弯”。
   标定只用 FreeSki 自己的标准动作参考（当前 38 段 CSIA gold 示范，见 §2），不使用从 Carv 逆向得到的系数；分数不叫 Ski:IQ。

## 1. 服务方式

- FreeSki 直接从 `J:\Freeski\FreeSkiclaude` 源码运行自带的 integration API
  （`server/scripts/run_integration.py --profile <profile.json>`），监听 `127.0.0.1:8100`，
  不再复制冻结发布。profile、密钥和运行目录由 FreeSki 决定放在哪里，不放进 AAA 仓库。
- `GET /api/integrations/v2/capabilities` 照旧返回 `apiVersion: 2`、`profile: "platform-integration"`、
  `deploymentId`，并在 `features` 中新增布尔值 `scorecard`、`teaching`、`keyframes`、`explainer`。
- 现有接口保持不变：`/api/aaa/{health,catalog,scheduler,requests/{key},jobs/{id}}`、`/api/analyze`、
  `/api/jobs/{id}`、v2 的 report / turns / assets / uploads / exports / workspace。
- 改善路径（`path_type=improvement`）提交可带 `current_level` ∈ `none` \| `level1` \| `level2` \| `level3` \| `level4`
  （学员目前的级别，`none` = 还没考过 CSIA）：`/api/analyze` 是表单字段，v2 可续传上传是创建请求 JSON 里的字段。
  认证路径带它、或取值不在这五个里，返回 400。它是请求身份的一部分：同一个 request key 换了 `current_level` 视为不同分析（409/400）。
  不带时（旧客户端、旧任务）行为不变。
- AAA 接回时配置 `FREESKI_BASE_URL=http://127.0.0.1:8100`、新的 `FREESKI_DEPLOYMENT_ID` 和
  FreeSki 提供的专用服务账号。AAA 不负责启动 8100。

## 2. 评分卡 `scorecard`（代码计算，随任务结果返回）

位置：`GET /api/jobs/{id}` 在 `status: "done"` 时的 `result.scorecard`，以及 v2 report 的 `scorecard`。
两处是同一个对象，同一任务内不可变。评分卡计算失败时没有这个字段（按旧任务处理）。

```json
{
  "schema_version": "freeski_scorecard.v1",
  "experimental": true,
  "action": "parallel",
  "level": null,
  "current_level": "level1",
  "calibration": { "scoring_version": "freeski-scorecard-7", "calibration_id": "scal-ee8c624424e66258",
                   "reference_generation": "pose-v6-a4e5105e612d5217", "reference_clip_count": 38, "matched_reference_count": 1,
                   "reference_target": "level2" },
  "quality": "approximate",
  "quality_reasons": ["few_turns"],
  "overall": { "score": 72.4, "aggregation": "middle_turns_mean", "turns_used": 4, "turns_total": 6, "turns_excluded": 1 },
  "metrics": [{
    "key": "parallel_skis", "label_zh": "双板平行", "label_en": "Parallel skis",
    "measurement": "direct", "presentation": "bar",
    "score": 58.9, "band": "within", "position": null, "target": null, "weight": 0.18,
    "value": 68.1, "unit": "percent",
    "reference": { "p25": 66.6, "median": 72.9, "p75": 79.1 }
  }, {
    "key": "turn_tempo", "label_zh": "换弯节奏", "label_en": "Turn tempo",
    "measurement": "direct", "presentation": "target",
    "score": 100.0, "band": "within", "position": 52.3, "target": { "low": 36.8, "high": 63.2 }, "weight": 0.06,
    "value": 41.2, "unit": "turns_per_min", "reference": { "p25": 38.0, "median": 41.0, "p75": 44.5 }
  }, {
    "key": "edge_angle", "label_zh": "立刃角度（估算）", "label_en": "Edge angle (estimate)",
    "measurement": "estimated", "presentation": "bar",
    "score": 64.0, "band": "below", "position": null, "target": null, "weight": 0.0,
    "value": null, "unit": null, "reference": null
  }],
  "turns": [{
    "turn_id": "turn_3", "start_ms": 5120, "end_ms": 6880, "direction": "left",
    "role": "middle", "score": 70.1, "used_in_overall": true,
    "evidence": { "status": "ok", "reasons": [], "reacquired": false },
    "metrics": [{ "key": "parallel_skis", "score": 80.0, "band": "within" }]
  }, {
    "turn_id": "turn_6", "start_ms": 7170, "end_ms": 7930, "direction": "right",
    "role": "middle", "score": null, "used_in_overall": false,
    "evidence": { "status": "insufficient", "reasons": ["out_of_frame", "tracking_lost"], "reacquired": false },
    "metrics": []
  }],
  "unavailable_metrics": []
}
```

| 字段 | 规则 |
| --- | --- |
| `action` / `level` | 与任务的 `action_name` / `level` 一致；改善路径 `level` 为 `null` |
| `current_level` | 改善路径提交时带的学员目前级别，原样回显；认证路径、或改善路径没带时为 `null` |
| `calibration` | `scoring_version`：打分方法版本，方法一变就换（`freeski-scorecard-1` 首版、`-2` 加逐弯门槛、`-3` 统一 30 fps 并按镜头拆分参考片、`-4` 小人物门槛提到 120 像素、`-5` 跟踪器 `persistent_bbox.v2` 并标出重新锁定的弯、`-6` 撤下 `ski_tilt_parallel_rate`、`-7` 参考库改用 CSIA gold 示范并用跟踪器 `persistent_bbox.v3`、钟形指标朝更高级别不扣分）。`calibration_id`：标定内容（分布和生成规则）的指纹 `scal-<16 位十六进制>`，标定一重建就会变；无标定时为 `null`。`reference_generation`：参考姿态代际（Postgres 中发布的那一代），不随评分卡标定变化。比较或汇总已存分数时，只把 `scoring_version` 和 `calibration_id` 都相同的放在一起。`reference_target`：这次**实际**对比的示范组，`expert` \| `advanced`（改善路径；没有 expert 时退到 advanced）\| `level1`…`level4`（改善路径带 `current_level` 时：上一级的 pass 示范，该级没有这个技能的示范就往上取最近有示范的级别；`level4` 学员是 `expert`）\| `level1`…`level4`（认证路径；所选级别没有示范时是实际用到的最近级别，同时 `quality_reasons` 带 `no_matching_reference`）\| `all_pass_levels`（认证路径没选级别，合并该动作所有 pass 示范）\| `null`（没有可用示范）。`matched_reference_count` 是这组里的示范片段数 |
| `quality` | `valid` \| `approximate` \| `insufficient`；`insufficient` 时 `overall.score` 必须为 `null` |
| `quality_reasons` | `few_turns`（中间弯少于 5 个；少于 3 个时为 `insufficient`）、`low_pose_confidence`（弯内下半身可见帧少于 60%）、`camera_motion`（预留，暂不产生）、`no_matching_reference`（该级别没有标准动作，用了最近级别；动作完全没有标准动作时为 `insufficient`）、`partial_metrics`（某个计分指标在一半以上的中间弯算不出）、`excluded_turns`（至少一个中间弯没通过画面证据门槛，见 `turns[].evidence`）、`subject_reacquired`（至少一个计入平均的弯来自重新锁定的跟踪段，见 `turns[].evidence.reacquired`） |
| `overall.score` | 0–100；每弯分 = Σ(weight × score)，只算该弯有分的直接测量指标并重新归一；总分 = **所有** `role: "middle"` 且有分的弯的平均。`aggregation` 恒为 `middle_turns_mean` |
| `turns[].role` | `start` \| `middle` \| `end`。第一个弯之前 2 秒内能看到滑雪者静止至少 0.6 秒 → `start`；最后一个弯之后同样 → `end`；从滑行中间剪的片子两者都没有。`used_in_overall` 只对有分且证据为 `ok` 的 `middle` 弯为 `true` |
| `turns[].evidence` | 逐弯画面证据门槛。`status` ∈ `ok` \| `insufficient`；`reasons` 取自：`subject_small`（身体中位高度不到 120 像素；参考库里最小的弯约 170 像素，再小就超出了标定覆盖的拍摄条件，小腿和肩线只剩二十几个像素）、`out_of_frame`（超过 25% 的帧有身体关键点在画面边缘 2% 以内）、`lower_body_hidden`（髋膝踝全部可见的帧不到 70%）、`tracking_lost`（跟踪器没跟住的帧超过 20%）、`overlapping_person`（被别人的框盖住 30% 以上的帧超过 10%）、`discontinuity`（一帧内中心移动超过 0.6 个身高或身高变化超过 35%，即切镜或镜头猛甩）。后两项只对带跟踪记录的新管线分析有效。**`insufficient` 的弯必须 `score: null`、`used_in_overall: false`、`metrics: []`**，`role` 照常标；它不进教学事实，讲解视频不选它，关键帧照常渲染但图注写“画面证据不足，未打分”、`fact_ids` 为空。参考库标定也只用通过门槛的中间弯。`reacquired`（布尔）：这个弯的姿态来自跟踪器**重新锁定**的那一段。跟踪器丢失学员后，如果画面里只剩一个人并持续 1 秒，或者有一个人的框面积是其他人的 2 倍以上、并且是同一个框持续 1 秒（近景学员、远处有路人），就把他当作学员重新跟踪；丢失前后是不是同一个人没有核实。这样的弯照常打分、照常计入平均，但网站应注明“中途重新识别了滑雪者，请确认画面中是你”。没有跟踪记录的旧分析恒为 `false` |
| `overall.turns_used` / `turns_excluded` | `turns_used` 为参与平均的中间弯数（通过门槛且有分）；`turns_excluded` 为证据不足的弯数（各种 `role` 都算） |
| `metrics[].key` | `^[a-z][a-z0-9_]{0,63}$`，取自 `server/rubrics/metric_polarity.yaml`。列出的是计分指标加上该动作该级别 CSIA 要求对应的指标（`server/rubrics/csia_criteria_2026.yaml`；改善路径按实际对比的示范所在级别），不同动作列出的指标不同。没通过参考库效度检查的指标（`ski_tilt_parallel_rate`、`early_edging`、`edge_build`、`edging_similarity`、`stance_width_consistency`）不出现在评分卡里 |
| `measurement` | `direct` \| `estimated` |
| `presentation` | `bar`（越高越好）\| `target`（钟形指标：`position` 是滑块位置，`target: {low, high}` 是绿区，二者都是 0–100 的滑块单位；`score` 仍是 0–100 的好坏分）。绿区来自标准动作，所以只要标准动作有这项指标，`target` 就有值，即使这次 `score`/`position` 为 `null`；只有标准动作本身缺这项指标时 `target` 才是 `null`（此时 `score` 也是 `null`） |
| `score` | 0–100，与标准动作的接近程度。`bar`：达到或超过标准动作中位弯为 100，在其下四分位处为 50，再往下按正态尾部下降。`target`：落在绿区内为 100，区间外随距离下降。绿区是标准动作的 p25–p75；对比某一级示范时（`reference_target` 为 `levelN`）再向同一动作更高级别 pass 示范的中位数方向放宽（滑得更像高级别示范不扣分），对比专家 / 进阶示范和 L4 时不放宽。整趟的 `metrics[].score` 是中间弯分数的平均；`null` 表示这段视频算不出。标准动作自己的弯平均约 75–80 分 |
| `band` | `below` \| `within` \| `above`：原始值相对标准动作 p25–p75（钟形指标即绿区）的位置。直条指标按好坏方向给：越低越好的指标（`edge_change_sync`）原始值高于 p75 时为 `below`，所以直条指标的 `below` 永远表示差于示范常见范围；钟形指标照原始值的方向给。整趟的 `band` 按中间弯原始值的中位数判断 |
| `weight` | 实际参与总分的归一化权重，有分的直接测量指标合计为 1；估算指标恒为 0 |
| `value` / `unit` / `reference` | 原始值（中间弯中位数）、单位和标准动作分位（钟形指标的 `p25`/`p75` 是上面说的绿区边界）。`unit` ∈ `ratio`、`percent`（0–100）、`deg`、`deg_per_s`、`turns_per_min`、`s`。**估算指标三者都为 `null`**：图像平面角不是真实立刃角，不能显示成度数 |
| `unavailable_metrics` | 保留字段，恒为 `[]`：视频测不了的指标和考核要求不显示 |
| 数量上限 | `metrics` ≤ 24，`turns` ≤ 100，每弯 `metrics` ≤ 24 |

标准动作：取自 CSIA gold 示范片（分数 ≥ 6 为 pass，其余为 intro），姿态用与用户上传相同的跟踪管线提取。
认证路径取所选级别、所选动作的 pass 示范片；没有选级别时合并该动作所有 pass 示范片；
改善路径带 `current_level` 时取上一级的 pass 示范：`none`→L1、`level1`→L2、`level2`→L3、`level3`→L4、`level4`→expert；
该级没有这个技能的示范（如小回转没有 L1、刻滑只有 L3/L4）就往上取最近有示范的级别，这属于规则本身，不加
`no_matching_reference`；只有 `level4` 学员找不到 expert、退到 advanced 时才加。技能与认证动作的对应：平行式转弯→示范平行弯，
小回转→小回转，刻滑→L3 进阶平行弯 / L4 专家平行弯，蘑菇→蘑菇。
改善路径不带 `current_level` 时取该技能的 expert（没有则 advanced）示范，即同一技能 L4（L3）的 pass 示范组，所以分数是“离专家示范多远”，
对还没到专家水平的学员会普遍偏低；想按学员所在级别对比，应走认证路径并传 `level`（例如二级小回转按 `level2` 对比 L2 pass 示范）。参考片是多机位剪辑：标定时先在姿态突跳处切成镜头，在每个镜头内
检测弯、去掉镜头首尾的弯，再过逐弯证据门槛，用剩下的弯的分布做标定。所有逐弯指标（参考片和用户片）都在 30 fps 的
时间网格上计算（就近取帧），避免 60 fps 参考片和 30 fps 手机视频之间的帧率偏差；用户视频的弯不按镜头拆分，以保持
`turn_id` 与关键帧、动画一致。标定或计算方式改变时 `calibration.reference_generation` 不变（仍为当前参考代际），
分数会随之变化。

AAA 结算：TECH 已评分，或 `scorecard.overall.score` 不为 `null` 且 `quality` 不是 `insufficient` 时扣 1 次；
否则退回。新任务以评分卡总分为主分数，旧任务继续显示 TECH。

## 3. 教学解释 `teaching`（模型生成，异步）

位置：`GET /api/integrations/v2/analyses/{job}/report` 新增 `teachingStatus`
（`pending` \| `running` \| `ready` \| `unavailable` \| `failed`）、`teaching`（未就绪时为 `null`）和
`explainerStatus`（同一组取值，见 §5）。旧的 `modelAssessment`（observation_only）保留给旧任务。
没有评分卡的旧任务：`scorecard: null`，两个状态都是 `unavailable`。

```json
{
  "schema_version": "freeski_teaching.v1",
  "experimental": true,
  "mode": "reference_comparison",
  "facts": [{
    "fact_id": "f_parallel_skis_turn_3", "metric_key": "parallel_skis", "turn_id": "turn_3",
    "label_zh": "双板平行", "label_en": "Parallel skis",
    "phase": null, "time_sec": 6.0, "user_score": 52.0, "reference_band": "below", "measurement": "direct"
  }],
  "summary_zh": "…", "summary_en": "…",
  "strengths": [{ "text_zh": "…", "text_en": "…", "fact_ids": ["f_…"] }],
  "improvements": [{ "text_zh": "…", "text_en": "…", "fact_ids": ["f_…"], "turn_ids": ["turn_3"],
                     "keyframe_ids": ["kf_…"], "priority": "primary" }],
  "drills": [{ "drill_id": "rollerblade_turns", "name_zh": "…", "name_en": "…",
               "why_zh": "…", "why_en": "…", "fact_ids": ["f_…"] }],
  "limitations_zh": ["…"], "limitations_en": ["…"],
  "model": { "model": "…", "project": "ski-platform-text", "prompt_version": "teaching-v1" }
}
```

- `facts` 全部由代码从评分卡生成：每个有分的指标一条整趟事实（`f_<指标>`，`turn_id: null`），
  再加每个计分指标最差和最好的中间弯各一条（`f_<指标>_turn_<n>`）。`user_score` 与评分卡一致；
  `reference_band` 与评分卡的 `band` 一致；`phase` 当前为 `null`（指标按整弯计算）；`time_sec` 为该弯中点。
  估算指标的事实不带原始数值。`early_edging`、`edge_build`（gold 示范上验证无效）和 `edging_smoothness`
  （不对应任何 CSIA 要求）已不在评分卡里，也不生成事实。
- CSIA 要求（`teaching-v5`）：模型另拿到 `criteria`，即该动作该级别视频能测的 CSIA 要求（中英文名）及代表它的指标，
  只列至少有一条事实的要求。模型可以说某条事实对应哪条要求，但不能说整条要求达标或没达标，也不能提列表以外的要求；
  测不了的要求（速度、弯的大小、雪面压力、线路等）不发给模型。`limitations` 增加一条“只对比视频能测量的 CSIA 考核要求”。
- 模型只接收事实列表、动作上下文（动作、级别、质量标签）、上面的 CSIA 要求和练习目录，不接收原始数组，也不接收总分，避免再次出现
  把图像角度读成身体动作的错误。总分暂不向学员显示（社长 2026-10-26 决定）：代码模板不写总分，校验器拒绝提到总分的
  条目和总结（总分、整体评分、综合评分、总体评分、整体得分、综合得分、总评分、overall/total/run score、overall/total rating），
  总分数值也不在允许的数字里；单项分、逐弯分照常可以引用。
- FreeSki 校验器拒绝：未引用事实或引用了不存在事实的条目；含有所引事实以外数字的条目（只允许所引事实的
  `user_score` 和弯号）；不在 CSIA 指南练习清单（`server/rubrics/csia_criteria_2026.yaml` 的 `exercises`，`teaching-v10` 起）中的 `drill_id`；
  URL、文件路径；引用估算指标却没有“视频估算/看起来/estimate/appears”一类措辞的条目；含有测量无法支持的因果或
  程度词的条目和总结（导致、造成、因为、由于、所以、失控、剧烈、严重、极端、完美、完全、彻底、危险、受伤；
  cause、because、due to、lead(s) to、result in、out of control、violent、severe、extreme、perfect、completely、totally、
  dangerous、injur…）。
- 由代码填写、不信任模型的字段：`drills[].name_zh/name_en`（取自目录）、`improvements[].turn_ids`
  （来自所引事实）、`keyframe_ids`（引用同一事实的关键帧，见 §4）、`priority`（第一条**引用了直接测量事实**的改进为
  `primary`，其余 `secondary`；只引用估算指标的改进永远不是 `primary`，所以可能没有 `primary`）、`limitations_*`。
  同一个弯、同一条事实或同一个指标同时被优点和改进引用时，删掉那条优点（`teaching-v6`）。说某条 CSIA 要求整体达到了的条目
  （“符合/满足/达到/体现……标准/要求”“达标”，英文 meets/satisfies/achieves… criterion/standard/requirement）被拒收。
  对比对象名里的级别数字（“CSIA 2 级通过示范”的 2）可以写。`summary_*` 由代码模板生成（`teaching-v10` 起模型不写总结）。
  全部条目都不合格时 `teachingStatus` 为 `failed`（模型最多答两次）。`model.prompt_version` 现为 `teaching-v10`。
  `teaching-v7`：`primary` 是引用了直接测量事实的改进里，最差的**整趟**事实（`turn_id: null`）所在的那条，没有整趟事实时才取最差的单弯；
  只有某指标的整趟事实被改进引用时，才删掉引用该指标的优点（单个弯差不否定整趟在范围内）；正文和练习理由里只能出现所引事实的指标名；
  模型写的“示范范围/典型范围”等改写为“示范常见范围”（英文 typical range → usual range），中文与 “CSIA” 之间补空格（代码模板的总结也补）。
  `teaching-v8`：CSIA 要求名只能以固定句式出现——“对应 CSIA 要求：{要求名}”（英文 “CSIA criterion: {name}”），每条最多一条要求，
  而且必须是所引事实的指标对应的要求；“体现了/影响了/有助于 + 要求名”之类的说法整条拒收。
  `teaching-v9`：没有句末标点的条目补上“。”或“.”；某指标已有整趟优点时，同一指标的单弯优点删掉。
  `teaching-v10`：每条优点、改进和练习理由都必须有且只有一条“对应 CSIA 要求：…”，没有或多于一条的整条拒收；
  指南原话以“指南描述：…”（优点）或“指南建议：…”（改进）引出，英文 “The guide describes: …” / “The guide suggests: …”；
  练习理由复述指南对这个练习的用法（模型拿到的 `drills[].purpose_zh/purpose_en`，如“指南用它练习用腿转动雪板…”），
  不再照抄改进建议，可以不写指标名，但不能写所引事实以外的指标名；
  `criteria` 每项另带 `guide_zh/guide_en`（指南对这条要求的描述）和可选的 `develop_zh/develop_en`（指南的改进建议），
  借用的要求名带出处“（N 级动作名）”/“(Level N action)”，其中的数字不算引用的数字；模型漏写出处时代码补上；
  只有能对上某条 CSIA 要求的指标才生成事实；练习的 `criteria_zh/criteria_en` 列出它在这张评分卡上能练的要求。
  提示词版本一变，已有的解释（`ready` 或 `failed`）在下次读报告时回到 `pending` 并重新生成，和关键帧、讲解随 `MEDIA_VERSION` 重做一样。
- 方向一致（`teaching-v4`）：改进项引用的每条事实都必须在示范常见范围外的“差”的一侧（直条指标 `below`，钟形指标
  `below` 或 `above`），否则整条丢弃；优点不能引用这类事实。
- 叫法与评分卡一致（`teaching-v3`）：每条事实带 `label_zh`/`label_en`（即评分卡 `metrics[].label_*`），模型还拿到
  动作名（如“小回转 / Short turns”）和对比对象名（按 `calibration.reference_target`：专家示范、进阶示范、
  CSIA N 级通过示范、CSIA 各级通过示范）。每条优点、改进和练习理由必须用所引指标的评分卡名称（估算指标可省略
  “（估算）”后缀）；出现“站宽一致/转弯节奏/平行度/短转弯/短回转/标准示范/标准动作”或 “standard demonstration”、
  程度词“明显/显著/大幅/远低于/远高于”（significant、noticeably、markedly、far below/above）的条目被拒收。
  正文里括号中的事实编号由代码删掉，其余位置出现事实编号则拒收。代码模板的总结写明对比对象，例如“与 CSIA 2 级通过示范逐项对比”。
  `drills[].name_zh` 只有中文（目录里附带的英文名已去掉）。`limitations` 的估算一条为“标为‘估算’的指标是视频估算，只显示、不计分”。
- 模型在排队（ModelCtrl 返回 busy）时状态保持 `pending` 并退避重试；等满 24 小时仍不可用则为 `unavailable`。
- AAA 会再查一遍结构，丢弃引用无效的条目。原始模型输出由 FreeSki 私存，不发给 AAA。
- 上限：`strengths` ≤ 4，`improvements` ≤ 4，`drills` ≤ 3，`facts` ≤ 40；
  每段文字 ≤ 600 字，`summary_*` ≤ 800 字。

## 4. 关键帧图片 `keyframes`（代码渲染，异步）

- 清单：`GET /api/integrations/v2/analyses/{job}/turns/{turn}/keyframes`

```json
{
  "schema_version": "freeski_keyframes.v1", "turn_id": "turn_3", "status": "ready",
  "items": [{
    "keyframe_id": "kf_0123456789abcdef0123456789abcdef", "phase": "apex",
    "time_sec": 5.9, "reference_time_sec": 2.1, "width": 960, "height": 540,
    "focus_metric_key": "parallel_skis", "caption_zh": "…", "caption_en": "…", "fact_ids": ["f_…"]
  }]
}
```

- 图片：`GET /api/integrations/v2/analyses/{job}/assets/keyframe?keyframe_id=kf_…`，
  返回 `image/webp`，不超过 400 KiB，`Cache-Control: private, no-store`，不需要 Range。
- `status` ∈ `pending` \| `ready` \| `unavailable`；第一次请求某个弯时开始渲染并返回 `pending`（`items` 为空），
  之后轮询。每弯 3 张：`initiation`、`apex`、`completion`，分别取弯内 15%、50%、85% 的时刻（按时间划分，未经审核）。
- `focus_metric_key` 是该弯得分最低的计分指标；`fact_ids` 优先引用该弯的事实，没有时引用整趟事实。
  `keyframe_id` 由任务、弯和阶段确定，教学解释可以在图片渲染前引用它。
- 画面：放大到滑雪者的用户原帧加用户骨架（橙色），右上角并排显示示范骨架（绿色）；两边都画出
  `focus_metric_key` 对应的身体线段，估算指标标注“视频估算”。图注由代码模板生成，不是模型自由文字。
  标准动作骨架：若该弯有审核过的参考就用它，否则用自动匹配的 CSIA 示范弯（未审核）；只画骨架，不显示示范视频画面。
- 每个条目带 `reference_status`（取值同 §5：`reviewed_platform_reference` \| `auto_matched_unreviewed` \| `not_available`），
  是这张图右上角实际画的东西。右上角第一行是评分卡实际对比的示范名（与 §3 的对比对象名一致，如“CSIA 2 级通过示范”“专家示范”），
  第二行是“已审核”“自动匹配”或“没有匹配”。图注写“低于/在/高于示范常见范围内”。

## 5. 动画对比与慢动作讲解

- 沿用现有 v2 的逐弯 manifest、`background`、`user-pose`、`reference-pose` 和导出接口，不改格式。
- 报告 `turns[]` 有两个参考字段，含义不同：
  - `referenceAvailable`（原有）：逐弯播放器能否播放参考骨架。只有**审核过的平台参考**才会通过 `reference-pose` 提供，
    自动匹配的 CSIA 示范不对外提供姿态数据，所以目前多为 `false`。逐弯播放器按它显示。
  - `comparisonReference`（新增）：关键帧和讲解视频为这个弯画的是哪种标准动作骨架，取值同 §5 的 `reference_status`。
    网站描述关键帧和讲解时按它写，例如 `referenceAvailable: false` 且 `comparisonReference: "auto_matched_unreviewed"` 时，
    播放器写“暂无审核过的参考示范”，关键帧/讲解写“绿色为自动匹配的 CSIA 示范骨架（未审核）”。
- 新增慢动作讲解视频（试验性）：
  - 清单：`GET /api/integrations/v2/analyses/{job}/explainer`；第一次读报告时开始渲染，`status` 为 `pending` \| `running` \| `ready` \| `unavailable` \| `failed`。
  - 视频：`GET /api/integrations/v2/analyses/{job}/assets/explainer`，`video/mp4`（H.264，1280×720，20 fps），
    支持 Range，不超过 24 MiB，`Cache-Control: private, no-store`。
  - 内容：片头（只有“动作对比讲解（试验性）· 动作名”，中文行用中文动作名如“小回转”、英文行用英文名如“Short turns”，不显示总分）→ 对得分最低的最多 3 个通过证据门槛的中间弯，
    依次 ①原速播放 ②0.25 倍慢动作 ③在弯顶定格 2.5 秒并闪烁焦点线段 → 片尾（最需要改进的单项及其单项分：计分指标里
    整趟在示范常见范围外、得分最低的那项，与教学 `primary` 的取法一致；都在范围内时只写“详细解释和练习见报告”）。
    左边是放大的用户画面加骨架；右边把用户骨架（橙）和 CSIA 标准动作骨架（绿）按身高和髋部对齐叠在一起，
    焦点指标的身体线段加粗。底部是阶段进度条（入弯 / 弯顶 / 收弯）。所有字幕由代码模板生成。
    慢动作字幕和右侧说明随该弯的 `reference_status` 变化：审核过的写“绿色是审核过的示范”；自动匹配的写
    “绿色是自动匹配的 CSIA 2 级通过示范（未审核）”（示范名随评分卡的对比对象）；`not_available` 写“这个弯没有匹配的示范”，
    右侧只画用户骨架。选弯：在定格指标落在示范常见范围外（直条 `below`，钟形 `below`/`above`）的中间弯里取得分最低的，
    不够 3 个再按得分从低到高补其他中间弯。

```json
{
  "schema_version": "freeski_explainer.v1", "status": "ready", "experimental": true,
  "width": 1280, "height": 720, "fps": 20, "duration_sec": 26.8, "bytes": 2185573,
  "reference": "auto_matched_unreviewed",
  "reference_status": { "turn_3": "auto_matched_unreviewed" },
  "segments": [
    { "kind": "title", "start_sec": 0.0, "end_sec": 2.0, "turn_id": null, "speed": null,
      "focus_metric_key": null, "fact_ids": [], "caption_zh": "…", "caption_en": "…" },
    { "kind": "slow", "start_sec": 3.0, "end_sec": 10.2, "turn_id": "turn_3", "speed": 0.25,
      "source_start_sec": 5.12, "source_end_sec": 6.88, "focus_metric_key": "parallel_skis",
      "fact_ids": ["f_parallel_skis_turn_3"], "caption_zh": "…", "caption_en": "…" },
    { "kind": "freeze", "start_sec": 10.2, "end_sec": 12.7, "turn_id": "turn_3", "speed": 0.0,
      "freeze_at_sec": 6.0, "keyframe_id": "kf_…", "source_start_sec": 5.12, "source_end_sec": 6.88,
      "focus_metric_key": "parallel_skis", "fact_ids": ["f_parallel_skis_turn_3"], "caption_zh": "…", "caption_en": "…" }
  ]
}
```

- `kind` ∈ `title`、`realtime`、`slow`、`freeze`、`outro`；`start_sec`/`end_sec` 是在讲解视频里的时间，
  `source_*` 是原视频里的时间。`reference_status` 每弯取 `reviewed_platform_reference`、`auto_matched_unreviewed`
  或 `not_available`（这个弯找不到标准动作，右侧只显示用户骨架并写明）；`reference` 是汇总：各弯相同时取该值，不同时为 `mixed`。
  没有中间弯时 `status` 为 `unavailable`。
- 参考骨架取与动作/级别匹配的标准动作片段；有审核过的阶段标注时按阶段对齐，否则保持整弯线性对齐并照常标明。

## 6. 标识格式与兼容

- `fact_id`：`^f_[a-z0-9_]{1,80}$`；`keyframe_id`：`^kf_[a-f0-9]{32}$`；`drill_id`：`^[a-z][a-z0-9_]{0,63}$`；
  `turn_id`：`^turn_\d{1,5}$`。
- **显示弯号 = `turn_id` 里的数字 + 1**（`turn_0` 是第 1 弯）。FreeSki 的教学文字、关键帧图注、讲解视频字幕都按这个规则写，
  校验器只放行所引事实的显示弯号（写成 `turn_id` 里的原数字会被拒）；网站显示弯号也按这个规则。`turn_id` 本身不变。
- `scorecard.level` 原样回显任务提交的 `level`（网站提交 `level2` 就是 `level2`）；改善路径为 `null`。
- `/api/jobs/{id}`（及任务列表）新增 `queue_reason`，只在 `status: "queued"` 时有值：`compute_offline`（算力端连不上：ModelCtrl
  或拆分部署后的本机算力节点不在线，或任务还没登记上去）或 `waiting_for_compute`（已登记，在 GPU 队列里等，例如社长在用电脑、
  别的任务占着显卡）；其他状态为 `null`。这两种情况任务都会一直保留、条件满足后自动开始，网站不应把这段时间计入超时。
- `current_level` 在 `/api/jobs/{id}`（及任务列表）、任务结果顶层和 `scorecard.current_level` 三处回显；没带时为 `null`
  （结果顶层则没有这个键）。
- 旧任务没有评分卡时，AAA 显示原 TECH 结果。教学解释、关键帧或讲解视频失败不影响评分和结算。
- 未知的 `schema_version` 由 AAA 当作不可用处理，不猜测字段。

## 7. 样例与验收

- FreeSki 在 `J:\Freeski\FreeSkiclaude\docs\samples\report-contract-v1\` 放五份样例 JSON（`job-result.json` 含 scorecard、
  `job-result-improvement.json` 是同一段视频按改善路径、`current_level: "level1"` 打的分，
  `report.json` 含 teaching、`keyframes.json`、`explainer.json`），由 `server/scripts/make_report_contract_samples.py`
  从一段真实缓存分析生成；样例里的教学文字是手写的（`model.model: "sample-handwritten"`），但经过真实校验器。
  AAA 复制为测试夹具。
- FreeSki：评分数学（权重归一、全部中间弯平均、启动/结束弯不计入、估算指标不计分、`insufficient`）、校验器（无引用、
  编造数字、编造练习、估算措辞）、关键帧体积上限、讲解视频的单元测试，再用一段真实视频端到端跑通。
- AAA：结构校验、代理权限、结算规则和界面测试，接通后在浏览器实测。
