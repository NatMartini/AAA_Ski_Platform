# 视频分析展示移交给 FreeSki（2026-11-12）

这份清单写给 FreeSki 会话：滑雪平台现在怎样展示视频分析，源码在哪，每一块读 FreeSki 的什么数据。目的是把这些展示全部搬到 FreeSki 自己的客户端，以后由 FreeSki 维护。

## 1. 社长的决定（2026-11-12，原话）

> freeski改。从现在起，你的视频分析的那部分完全交由freeski来做。你只有api来读他的东西。现在的分析模式（3d建模展示）非常好，同步给freeski。我之后要为freeski扩展传感器采样模式。滑雪平台的功能就是提供一个接口来方便接入freeski。以及，拥有他自己的费用计算方式。freeski的定价我还没做。也就是说，从滑雪平台来的任务通过api把视频和请求发给freeski，freeski不需要验证费用，因为滑雪平台已经计算过。

> 所有。目前的滑雪平台如何展示视频分析的全部同步过去。之后做的所有展示都在freeski完成。滑雪平台只负责计算费用和api来对接。剩下所有工作和功能全都可以交给freeski来做。

同步范围（社长的另一句话）：把 FreeSki 原本的视频分析样式换成滑雪平台现在的视频分析模式，FreeSki 的其它部分不变。

## 2. 新的分工

| 归谁 | 内容 |
| --- | --- |
| FreeSki | 视频分析的全部展示：上传到出报告的流程、报告、3D 对比和 3D 讲解、标准动作库、使用指南；以后的传感器采样模式；以后所有新的展示 |
| 滑雪平台 | 账号、课程、分析次数和档位的计费；把视频和请求通过 API 发给 FreeSki；FreeSki 的展示做好之前，平台现有的展示继续可用 |

- 平台来的任务，FreeSki 不校验费用：平台已经算过。
- FreeSki 自己的定价还没定，等社长决定。

## 3. 源码位置和技术栈

平台仓库在 `J:\AAA_Ski_platform`（分支 v0.1，这些改动都还没提交，直接读工作区）。

| 项 | 平台 | FreeSki 客户端 |
| --- | --- | --- |
| 框架 | Next.js 16.4、React 19 | 相同 |
| 样式 | Tailwind v4，颜色用设计变量（`text-ink`、`bg-surface`、`text-accent` 等，定义在 `src/app/globals.css`） | Tailwind 3，自己的设计系统 |
| 3D | three 0.187（只在 `skier-stage.ts`、`stage-overlays.ts` 里用） | 没有，需要加 |
| 数据校验 | zod 4（`report-v2.ts`、`scorecard.ts`） | 没有，可以加或改成自己的类型 |
| 中英文 | 组件里用 `zh ? "中文" : "English"` 直接写两种文字 | `lib/i18n` |
| 图标 | lucide-react 1.x | lucide-react 0.441 |

搬的时候颜色和间距按 FreeSki 自己的设计系统来，结构、文字和交互照平台的。

## 4. 平台现在的展示，逐块说明

### 4.1 入口页 `/video-analysis`

源码：`src/app/[locale]/video-analysis/page.tsx`，`src/components/booking/video-analysis-panel.tsx`、`video-card.tsx`、`analysis-tier-picker.tsx`、`analysis-progress.tsx`、`freeski-brand.tsx`。

- 标题处用 FreeSki 标志；标题下一行免责声明，每台设备第一次进入弹一次（`AnalysisDisclaimer`）。文字在 `src/lib/video-analysis/guide-content.ts` 的 `DISCLAIMER`。
- 两个页签：“我的分析”（每个视频一张卡片，带状态和进度）、“分析新视频”（上传）。
- 上传前在浏览器里做拍摄检查（`src/lib/video-analysis/precheck.ts`）。你们新做的上传预检可以替代或补充它。
- 点“分析这个视频”弹出两步：
  1. 视频里的动作：默认“让 FreeSki 识别”。技术提升路径要选“你目前的 CSIA 级别”，考证路径要选“你要考的 CSIA 级别”（作为 `level` 传给你们）。
  2. 分析档位：简单、标准、深度、完全（见 5.1）。
- 进度环节（`analysis-progress.tsx`）：排队 → 识别骨架并评分 → 写讲解 → 生成关键帧 n/m → 生成讲解视频。
- 次数、价格、每天免费额度是平台的计费，不用搬。

### 4.2 报告页 `/video-analysis/report/[jobId]`

源码：`src/app/[locale]/video-analysis/report/[jobId]/page.tsx`，报告主体 `src/components/booking/dynamic-coaching-report.tsx`（`DynamicCoachingReport` 负责取数，`CoachingReportView` 负责排版）。

从上到下：

| 区块 | 内容 | 源码 |
| --- | --- | --- |
| 页头 | 视频名、动作和级别、状态、下载 PDF | 报告页 |
| 档位条 | 当前档位，可以改档 | `report-tier-bar.tsx` |
| 生成中 | “评分完成，正在生成这一档的全部内容”，列出各环节 | `analysis-progress.tsx` |
| 动作识别 | “FreeSki 识别为…把握 57%”“认错了？改成：…” | `recognition-note.tsx` |
| 报告内目录 | 结论 / 看问题 / 动作讲解 / 怎么练 / 数据，点了跳转 | `dynamic-coaching-report.tsx` |
| 这次的结论 | 几项达到标准动作范围、做得好、最该练、参照分、“看第 N 弯” | `report-conclusion.tsx` |
| 看问题：逐弯动态对比 | 逐弯 3D 对比播放器（见 4.3），可切到关键帧、讲解视频、滑行轨迹 | `turn-comparison-player.tsx`、`analysis-keyframes.tsx`、`analysis-explainer.tsx`、`run-track-view.tsx` |
| 动作讲解 | 按最需要改的排：每个毛病的“视频里看什么 / 为什么、力怎么变 / 怎么改 / 练习”，配受力图或 3D 讲解动画（见 4.4） | `movement-explanations.tsx` |
| 怎么练 | 指南里的练习和理由 | `dynamic-coaching-report.tsx` |
| 动作解释 | 模型写的讲解，每条带引用的事实；教练可以对每条结论表态 | 同上 |
| 详细数据 | 每项指标一行，按“需要加强 / 达到范围 / 视频估算 / 没算出”分组，展开看范围、可信度和逐弯小图 | `analysis-scorecard.tsx`、`src/lib/freeski/metric-insight.ts` |
| 下次拍得更准 | 按不计分的原因给拍摄建议 | `filming-tips.tsx` |
| 教练标注和导出 | 标注、参考示范、导出 | `coaching-workspace.tsx` |
| 教练人工点评 | 平台的教练业务，留在平台 | 不用搬 |

显示规则：

- 总分不显示（2026-10-26 的决定），讲解里引用总分的句子会去掉：`withoutOverallScore`（`src/lib/freeski/scorecard.ts`）。
- 第 8 版评分卡把对照叫“CSIA N 级标准动作”，区间叫“标准动作范围”；旧卡仍叫“通过示范”。结论下面显示参照分：“官方通过示范按同样方法打分是 N 分”。数据说明里显示机位，侧面机位提示下次从正面或背面拍。
- 这一档最深的讲解没写出来时，用较短的一档代替并注明。较短的一档还在写的时候（例如报告因为超过 45 分钟的期限先放出来了），显示“动作解释生成中”并继续查询，写好后自动换上；只有更短的各档也都没有时才说“这次的动作解释没有生成”。判断在 `shorterBeingWritten`（`src/lib/freeski/report-v2.ts`），取数在 `DynamicCoachingReport` 的 `load`：代替用的讲解先读好，再和报告一起显示，不会先闪一下“没有生成”。
- 报告在这一档的内容全部生成好之后才出现（社长 2026-11-09 的要求）。

### 4.3 逐弯 3D 对比

源码：`src/components/booking/turn-comparison-player.tsx`（界面和播放），`skier-stage.ts`（three.js 舞台），`skier-figure.ts`（平面画法），`stage-overlays.ts`（箭头、螺旋、圆环），`use-orbit.ts`（拖动转视角）。

计算在 `src/lib/freeski/`：

| 文件 | 作用 |
| --- | --- |
| `standard-motion.ts` | 读标准动作；`fitView` 找机位和转向；`phaseAt` 把学员的时间对到标准动作的进度；`standardPoseForTurn` |
| `skier-lift.ts` | 把学员的二维骨架抬成三维 |
| `skier-rig.ts` | 骨架和雪板的几何 |
| `run-track.ts` | 整段滑行的估计轨迹、弯形圆度 |
| `report-v2.ts`、`scorecard.ts` | 你们报告接口的数据结构 |

- 学员和标准动作各一个三维滑雪者（人、雪板、雪杖），同一视角；可以拖动转视角，有正面、背面、侧面、高处、回到拍摄机位。
- 蒙皮人物模型是 `public/standard-motions/skier-mesh.bin`，由 `scripts/standard-motion/build_skier_mesh.py` 生成。
- 你们的 v2 关键帧和讲解片已经照 `standard-motion.ts` 和 `skier-figure.ts` 移植过一次机位、对时和画法，这一块两边应当一致。

### 4.4 动作讲解：受力图和 3D 讲解动画

源码：`src/components/booking/movement-explanations.tsx`、`technique-diagrams.tsx`（平面受力图）、`technique-lesson.tsx`（3D 讲解），内容和计算在 `src/lib/freeski/technique-faults.ts`、`technique-forces.ts`、`technique-lessons.ts`、`technique-paths.ts`。

- 8 个毛病：上身带转、弯形不圆、身体内倒、两板不平行、立刃不够、没同时换刃、腿太直、节奏不稳。每个毛病对应哪些指标在 `technique-faults.ts`。
- 3D 讲解分四段：看问题 → 为什么 → 怎么改 → 对比。脚下受力用箭头长短表示，上身带转用从脚绕到肩的螺旋箭头，弯形用雪道上的圆弧和 Z 字轨迹对比。
- 箭头是按标准动作算的示意，不是学员的测量值，界面上有注明。

### 4.5 标准动作库 `/video-analysis/standards`

源码：`src/app/[locale]/video-analysis/standards/page.tsx`、`src/components/booking/standard-motion-viewer.tsx`。

- 按当前雪季的动作列表分组，选动作和级别，3D 播放，可拖动视角。
- 下面是常见问题、指南要求、数据表、FreeSki 评分核对表。
- 常见问题的 3D 讲解只对教练显示，学员看平面图。

### 4.6 使用指南 `/video-analysis/guide`

源码：`src/app/[locale]/video-analysis/guide/page.tsx`、`src/lib/video-analysis/guide-content.ts`。

八节，带目录：流程、分析档位、分析次数、怎么拍、怎么看报告、保存和隐私、标准示范、免责声明。其中“分析次数”和“保存和隐私”讲的是平台的计费和保存期限。

### 4.7 PDF 报告

源码：`src/lib/video-analysis/report-download.ts`（pdf-lib，在服务器上生成），内容跟随档位。

## 5. 平台现有的规则，搬的时候请保留

### 5.1 档位

定义在 `src/lib/video-analysis/tiers.ts`。

| 档位 | 显示什么 | 讲解深度 | 平台收费 |
| --- | --- | --- | --- |
| 简单 | 一段文字：主要问题和怎么调整 | none | 免费 |
| 标准 | 每个弯的分数、每项指标、文字讲解 | low | 免费 |
| 深度 | 再加逐弯 3D 对比、关键帧、讲解视频、滑行轨迹、受力图 | xhigh | 0.5 次 |
| 完全 | 再加 3D 讲解动画 | xhigh | 1 次 |

- 收费和每天免费额度是平台的事。档位决定显示和生成什么，这部分以后由 FreeSki 按平台传来的档位执行。
- 之后可以改档位，改完等新档位的内容生成好再显示。

### 5.2 自动识别和改正

- 不选动作就自动识别；报告里写识别结果和把握，可以改成别的动作重新分析一次。
- 改正时平台不再收费，原来的识别任务从列表里去掉。

### 5.3 其它

- 中英文都要有。
- 手机宽度（375）下不能横向溢出，可点的东西高度不小于 36。
- 标准动作是“按考官指南和示范视频生成的，不是真人示范，也不是考官认定的标准”，凡是出现标准动作的地方都这样注明。

## 6. 平台现在读你们哪些接口

平台的浏览器不直接访问 FreeSki，都经过平台的代理（`src/lib/video-analysis/dynamic-report.ts`、`src/lib/freeski/adapter.ts`）。

| 用途 | FreeSki 接口 |
| --- | --- |
| 动作目录 | `GET /api/aaa/catalog` |
| 提交分析 | `POST /api/analyze`，或 `POST /api/integrations/v2/uploads` 分片上传 |
| 任务状态和结果 | `GET /api/jobs/{id}` |
| 报告 | `GET /api/integrations/v2/analyses/{job}/report?thinking=` |
| 每个弯 | `…/turns/{turnId}`、`…/turns/{turnId}/keyframes` |
| 素材 | `…/assets/user-pose`、`background`、`keyframe`、`explainer` 等 |
| 教练标注 | workspace 一组接口 |
| 雪季更新 | `/api/aaa/season/*` |

## 7. 建议一起移交的东西

这些现在在平台仓库里，但都是分析和展示的一部分，而且你们已经在用：

| 东西 | 位置 | 说明 |
| --- | --- | --- |
| 标准动作生成器 | `scripts/standard-motion/` | 你们的识别器和第 8 版评分都依赖它的产物 |
| 标准动作数据 | `public/standard-motions/*.json`、`skier-mesh.bin` | 你们已收为 `rubrics/standard_motions.json` |
| 雪季动作列表 | `seasons/csia/` | 每个雪季一份 |
| “更新动作”按钮和执行器 | `/coach/actions`、`src/lib/season-update/` | 现在在平台的教练后台；归到 FreeSki 后可以少一次跨仓库来回 |

这一条等社长点头再动。在那之前平台的“更新动作”照常可用，已经按你们的新顺序接好。

## 8. 需要你们定或问社长的事

1. **平台的学员怎么看到报告**：以后展示在 FreeSki，平台的学员从平台点进来时怎么打开 FreeSki 的报告页（跳转还是嵌入，身份怎么带过去）。FreeSki 是独立域名，平台是它的子域名。
2. **平台怎么告诉你们该生成什么**：现在是平台按档位逐项来要（讲解深度、关键帧、讲解视频）。以后建议平台在提交时带上档位，改档时再通知一次，你们按档位生成和显示，不校验费用。
3. **平台现有展示什么时候下线**：建议 FreeSki 的新展示可用、并且第 1 条定下来之后，平台再把自己的报告页换成入口。
4. **FreeSki 自己的用户要不要选档位**：FreeSki 的定价还没定。

## 9. 平台这边的状态

- 平台现有的展示已经兼容你们的第 8 版评分卡、v2 关键帧和讲解片，过渡期照常可用。
- 从现在起平台不再新增展示功能，新的展示需求都转给 FreeSki。
- 搬的过程中对平台的做法有疑问，直接问滑雪平台会话。
