# Ski Platform 与 FreeSki：独立项目及 API 消费设计

## 当前状态（2026-10-26 下午，取代下文的部署说明）

`J:\Freeski\FreeSkiclaude`是唯一的FreeSki主目录。早上退役了Codex做的冻结部署；下午FreeSki改为直接从源码运行自带的平台接口，由ModelCtrl按需启停。

| 项目 | 现状 |
| --- | --- |
| 提供方 | FreeSkiclaude源码的`server/scripts/run_integration.py`，部署ID `freeski-platform-8100`，profile `platform-integration`，apiVersion 2，`127.0.0.1:8100`。profile、私有配置和运行目录在`J:\Freeski\deployments\platform-8100\`，由FreeSki管理 |
| 启停 | ModelCtrl按需服务`freeski-8100`：需要时启动，`/health`报`busy:false`、没有`ski-platform`任务且空闲约20分钟后停止。用户原话：“当freeski有需求的时候再启用，任何调度问题交给model ctrl” |
| 本站如何叫醒 | 只调`POST {MODELCTRL_URL}/api/services/freeski-8100/start`，使用只能查看和启动该服务的专用令牌`J:\Model_ctrl\data\service-tokens\freeski-8100.txt`，服务端读取、不进日志。后台调度进程有任务时每轮叫醒并最多等30秒；网页请求只在连不上时叫醒、不等待。本站从不自己启动或停止8100 |
| 启动器 | 配置部署ID且未配置本地启动项时按“外部提供方”处理：只做健康检查，照常启动调度进程 |
| ModelCtrl身份 | GPU与文字任务为`ski-platform` / `ski-platform-text`，roots已由ModelCtrl改为`J:\Freeski\FreeSkiclaude\server` |
| 报告内容 | 按[报告接口约定v1.1](FREESKI_REPORT_CONTRACT.md)：评分卡、教学解释、关键帧、慢动作讲解视频，加原有逐弯动态骨架、参考库与导出 |
| 配置备份 | 切到8100前的`.env.local`在`storage/freeski/cutover-backup-20261026-8100/`；更早切到8000前的在`storage/freeski/cutover-backup-20261026/` |
| 已退役 | Codex的冻结部署`ski-platform-integration-20261022`（目录在`J:\_FreeSki_cleanup_20261026\`）和本仓库的8000 wrapper（代码保留，不再使用） |

2026-10-26实测：网站用真实视频（通过CSIA二级的小回转，2 MB）走完上传→排队→分析→结算，任务绑定`freeski-platform-8100`、apiVersion 2，扣1次；评分卡、动作解释、关键帧和讲解视频都能在页面显示。

下文是2026-10-21至10-24的设计与第一阶段记录。其中旧的8100冻结实例、“当前提供方”和`observation_only`门控等描述已不再适用。

## 历史记录（2026-10-21至10-24）

2026-10-24完整计划更新：平台提供方已升级至`coaching-v4-1a1c954f3d5e7718`。
v2分片上传、参考授权/独立审核、人工阶段对齐、高频证据/模型工具、私有MP4/WebP导出及
两个客户端已接入。最新状态和实际证据见[FULL_PLAN_STATUS.md](FULL_PLAN_STATUS.md)。
下面保留原设计和第一阶段快照，其中旧版本及“未实现”说明已由本更新取代。
原生配对运行/真实OAuth及本雪季教学标定仍未完成。

设计日期：2026-10-21；实施更新：2026-10-24。**第一阶段接口、独立部署、动态报告消费与人工视频点评已实现**。真实GPU、观察模式与教学有效性分别验收，不以代码或健康检查代替。当前提供方为`coaching-v3-71b9a0c1a4a22c03`；真实提取/媒体及观察selector已验证，经过审核的标准对比仍待参考数据。Ski Platform消费API；FreeSki计算和模型评价实现属于`J:\Freeski\FreeSkiclaude`。剩余工作见[当前任务](CURRENT_TASK.md)。

## 1. 两个产品、不同环境、两个 ModelCtrl 产品入口

FreeSki独立发布提取、逐弯、多维指标、CSIA/Qwen自动评价、动态参考骨架与媒体API。Ski Platform负责账户、课程、次数、支付、提交/查询/展示和可选人工教练点评。

两个产品使用独立Python环境、源码发布、配置、存储和ModelCtrl产品身份。`freeski`与`freeski-text`是原生产品的提取/文字阶段；平台已另外登记`ski-platform`与`ski-platform-text`。共享同一个ModelCtrl守护进程，保留已有项目及其优先级、待命和模型配置。

本次明确采用两个部署profile：**原生FreeSki API＋平台专用integration FreeSki API**。FreeSki发布可固定版本的实现；原生API使用自身环境与产品身份，integration API的worker绑定平台专用产品身份、Python依赖、配置与存储，平台只通过HTTP消费。普通HTTP调用不会再额外制造一份GPU分析或Qwen评价，同一任务不跨profile追踪或重试。

| profile | 独立环境与实例 | ModelCtrl产品身份 |
| --- | --- | --- |
| native | FreeSki原生Python/存储/配置，native deployment ID | `freeski`；现有文字阶段`freeski-text` |
| platform-integration（2026-10-26退役） | 原`J:\Freeski\deployments\platform-integration\`：独立Python/私有运行目录/固定发布；API `127.0.0.1:8100` | 已登记`ski-platform` / `ski-platform-text` |

## 2. 已实施的边界

- 适配器通过HTTP调用固定实例；新任务原子保存`upstreamJobId + upstreamDeploymentId + upstreamApiVersion`。部署标识缺失或不同都会停止已绑定任务的同步。
- 配置`FREESKI_DEPLOYMENT_PROFILE`后，本地helper启动FreeSki固定发布自带的入口，使用独立Python。旧wrapper和8000实例为历史部署保留，不导入兄弟项目可变源码执行新任务。
- 能力端点核对API版本、profile和部署ID。浏览器不能指定上游地址、ModelCtrl身份、Python路径或任意artifact路径。
- 旧v1基础结果保留；v2报告端点按需提供逐弯摘要、模型评价、受限manifest、紧凑骨架和私有MP4背景；校验布局、数量、时间映射及真实流字节预算。
- `CoachVideoReviewRequest`独立保存逐片授权、私人草稿和已发布点评，不复用付款审核字段，详见[人工点评流程](COACH_VIDEO_REVIEW.md)。
- 切换前确认两类账户均无已接收的在途上游任务；备份数据库和私有配置，保留旧服务、历史分数、缓存和业务记录。

## 3. API集成目标

`Ski Platform → FreeSki独立API → 提取/证据/模型评价/动态产物 → 平台展示 → 用户可选人工教练点评`

完整目标位于FreeSki的`docs/COACHING_REDESIGN_PLAN.md` §4.3。已开放`/api/integrations/v2/capabilities`与`/analyses/{job}/report`、`/turns/{turn}`、`/assets/{resource}`；基础提交仍走异步`/api/analyze`。**分片断点上传与新的v2提交接口未实现**，能力标记明确为false。目标包括：

| 内容 | 平台处理 |
| --- | --- |
| 能力/版本/部署ID | 服务端固定允许的实例、API版本与能力；浏览器不能提交ModelCtrl project、Python路径或任意上游URL |
| 上传与幂等提交 | 原片上传一次，流式代理或受限直传；稳定请求ID和上传收据支持中断恢复 |
| 任务身份 | 持久保存`deployment_id + analysis_id + client_request_id + api_version`；旧任务固定旧实例 |
| 状态/报告 | 分别同步测量、模型评价、动态对比；基础分析结算后继续同步后续产物，不重新扣次 |
| 白名单结果v2 | 保留旧v1读取；新增逐弯摘要、证据ID、model_assessment、reference_status和产物清单引用 |
| 私有媒体 | 平台按本人或当前人工点评授权检查，再读取固定实例的artifact；每次Range/骨架请求也检查 |
| 重试/取消 | 503/超时保留不确定性；只有权威证明未接收才做对应退款/重新提交。取消阻止迟到结果发布 |

完整目标包括维度判断、优点、改进、练习、证据与限制，平台不重新调用模型评价同片。**当前参考/校准/匹配条件尚未核实，公开模式仅为`observation_only`**：Qwen选择合法证据ID，代码按typed数学定义和真实统计生成带时间窗的二维观察；不公开模型自由教学文字、技术优劣、动作阶段、因果或处方。原始模型输出私存待审，历史ready报告也在读时重建安全观察。模型自己声称具备校准或加免责声明不能解锁；将来有经过审核的标准后另行实现比较模式。旧TECH历史分数保持原有意义，不以此门控重新改分。

服务凭据不等于最终学员身份。服务端绑定租户及受限主体委托，个人视频权限不因教练发过次数或确认过付款而自动放开。自动结果按不可变版本保存，人工点评引用当时的视频和报告版本。

## 4. 教练人工点评：独立可选流程

已新增`CoachVideoReviewRequest`，不复用付款审核记录。状态为`NOT_REQUESTED/REQUESTED/IN_REVIEW/PUBLISHED/CANCELLED`，未申请不创建记录。

记录申请人、被指派教练、明确授权、视频/自动报告版本、时间点/逐弯备注、草稿、已发布正文、作者、发布及修订时间。操作顺序是学员申请、指定教练打开视频、教练亲自写评价、明确发布、通知学员。自动分析无需等教练；模型文字不自动成为教练署名内容。

教练优先看低码率代理和动态对比，需要细节时按需查看授权原片。取消或换教练收回后续访问，保留可审计的历史；不回滚成功的自动分析结算。人工点评是否收费需独立产品规则，本设计不擅自设价格。

报告分“FreeSki自动评价”和“教练人工点评”，分别显示状态、作者/模型、时间和依据。学员未申请则没有人工待处理任务。私人视频/点评默认不因点评完成而自动进入公共参考或训练集。

## 5. 主展示：逐弯动态对比与带宽

已保留逐弯分析，新增动态播放。展开先取小摘要，再按选中弯读取用户/参考骨架；用户共享一份低码率背景，通过Range按需读取。视频时钟驱动骨架，支持慢放、暂停、拖动和并排对比；背景不可用时退回动态骨架播放。

原时间模式保留原始时间间隔；当前同阶段模式仅是**整弯线性归一化**，未检测入弯／弯顶／出弯，不用于精确节奏诊断。历史参考若缺真实时间戳则标注估算，未校准参考明确显示待核实。不得将播放耗时当作原弯用时。

标准骨架按版本和许可复用，不必重复传标准视频背景。默认只发身体/足部播放所需点，不传完整研究NPZ或所有高频流。分析原帧率与展示传输预算分开，量化/插值不能回写测量结果。

消费者按提供方的layout版本、关节ID顺序、dtype/字节序、量化scale/offset、时间单位、坐标变换和观测mask解码；未知布局拒绝或回退合成动态媒体，不能猜测关节索引。

可选后台合成MP4/WebM或Animated WebP短预览/分享。动图不保证比视频小，GIF不默认；以同素材的字节、首帧、慢放流畅度、解码与动作细节实测选择。移动全屏等无法保留网页叠加时使用合成动态版本。

私人媒体不可公开长效缓存；参考数据仅在许可允许时共享缓存。所有manifest/骨架/背景/Range都先检查权限，再处理ETag/304与Range/206；缓存复用时按策略重新验证。已下载数据不能靠撤销链接收回。

## 6. 后续迁移与完整验收目标

1. FreeSki先发布版本化API、部署profile和新实例能力；为两个产品登记并验证独立ModelCtrl身份、root/command及worker/结果校验，不能只换project字符串。
2. 用独立安装/发布和独立Python/配置/存储承接平台专用FreeSki API；平台不再导入兄弟目录源码。普通远端消费不需要安装FreeSki依赖。
3. 适配器按capabilities选择已支持的v1/v2；新任务固定新实例，旧任务继续在旧实例追踪至结算。未知任务状态不能被当成不存在。
4. 增加白名单v2、逐弯懒加载、授权媒体代理和独立人工点评；自动完成与人工完成分别验收。
5. 在途任务结清后退役旧wrapper，保留旧数据/源码快照/回滚路线；不能删除旧SQLite、缓存或重写历史分数。

验收：双环境/产品身份正确、跨实例ID拒绝、旧结果兼容、超时幂等、模型/媒体延迟同步、原片不重复上传、一次结算/退款、权限撤销、指定教练亲自发布、取消人工不影响自动分析、弱网逐弯字节与播放同步。真实视频与真实ModelCtrl验收需单独记录，mock或文档校验不等于完成这些功能。
