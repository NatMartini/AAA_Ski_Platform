# 完整计划执行清单

**2026-10-24最新状态：[FULL_PLAN_STATUS.md](FULL_PLAN_STATUS.md)。**
下方是早期接手快照；新观测、参考审核、对齐、断点上传及导出已实现并接入。
不能把下方旧“待实现”或旧PID当作当前状态。完整验收未结束，自动任务仍active。

更新：2026-10-24（America/Toronto）。用户已明确要求继续完成整个
`J:\Freeski\FreeSkiclaude\docs\COACHING_REDESIGN_PLAN.md`，不止第一阶段。
本文件是后续执行的检查表；未通过代码和验收的项目不得标为完成。

源代码起点备份：`tmp/backups/full-plan-20261024T055240Z/`，589份文件，
ZIP 1623257字节，附逐文件SHA256清单。两个项目及ModelCtrl身份保持隔离。

| 工作包 | 当前状态 | 完成条件 |
| --- | --- | --- |
| 既有API/时间轴/79流/观察门控/动态骨架/人工点评 | 第一阶段已验收 | 保留旧分数、数据、权限及回归证据 |
| 主体持续跟踪 | 待实现 | 真实多人候选接入检测选人分支；交叉/丢失不自动换人；策略版本进入cache key |
| 镜头运动/视频质量/事件流 | 待实现 | 排除人物的CPU背景运动、弱纹理/剪切/场景切换失效处理；真实PTS/mask/覆盖与来源；合成视频回归 |
| 装备与3D研究输入 | 待实现 | 可审核人工/真实检测输入，图像轴与空间测量分开；没有模型/标注时明确不可用，不伪造物理量 |
| 参考采集/标注/审核/发布 | 待实现 | 来源/许可/人物/场次/动作/阶段；独立审核、CAS、不可变版本与撤回；按关联组隔离数据集 |
| 阶段对齐与ghost资格 | 待实现 | 审核后的人工phase anchors分段单调映射；机位与方向不匹配则禁止ghost；无anchors保留整弯线性 |
| 高频证据查询与模型工具 | 待实现 | owner/job/generation/EID/字段/时间/采样/字节预算；模型只能查询合法观测，不执行指令或解锁技术评分 |
| v2断点上传 | 待实现 | 512KiB分块、hash/TTL/总量/并发/owner/deployment限制，恢复/幂等/原子complete，仅一次委托既有queue |
| 持久合成导出 | 待实现 | 有界CPU MP4/WebP、用户背景+骨架、真实审核参考、取消/lease/重启恢复、私有Range、原子发布与字节实测 |
| 原生私人媒体 | 源码及CPU/路由验收完成，未切换服务 | owner/analysis授权、语音grant、同源HttpOnly媒体会话和有界流代理；后端50项定向回归、前端9项新增测试/既有26项、类型/目标lint/构建26页通过；原生端实际登录和双服务网络仍待验收 |
| 两网站消费界面 | 待接新能力 | 参考库/标注、阶段映射、证据窗口、导出和恢复上传；中英/手机/旧报告回归 |
| 最终发布/整体验收 | 未完成 | 冻结新release、备份及安全切换，两环境/身份/失败恢复/权限/媒体与带宽验证 |
| 本雪季真实数据与教学标定 | 等待实际收集 | 获授权样本、独立分组留出、教练标注和盲评；不编造官方CSIA标准或准确率 |

已确认接口设计，尚不能当成实现：

- 数据模块：`camera_motion.py`、`subject_tracking.py`、`video_quality.py`、
  `event_detector.py`、`equipment_observations.py`及`observation_bundle.py`。
  数据代理可独占`feature_streams/evidence_builder/gpu_pipeline`的版本化接入。
- 参考模块：`ReferenceCatalog`、`ReferenceActor`、`SourceIdentity`，
  `/api/references/v1`；来源仅从已授权完成任务解析；owner不可自审。
  `turn_alignment.build_alignment`与`EvidenceQueryService.query`供协调器接入。
- 传输模块：`/api/integrations/v2/uploads`的create/GET/chunk PUT/complete/DELETE；
  导出create/status/file/DELETE。稳定client_request_id保持现有request_key语义，
  不另行收费、不重复GPU、没有审核参考时comparison请求拒绝。
- 原生媒体采用后端逐请求owner校验、前端同源HttpOnly媒体会话和有界流代理；
  旧URL仍可由前端映射，不能继续把hash当授权。

三个并行执行器在接口设计后触发用量限制。应先检查磁盘上的实际新文件及测试，
再继续分工；这三组代理工作包尚未验证实现。不要因代理启动或设计消息勾选清单。
不得换账号/模型绕过额度，也不强行抢占当前会话writer。

现有8100固定发布`coaching-v3-71b9a0c1a4a22c03`和3000测试站暂不切换。
完成新功能及必要回归后再创建新固定发布；不覆盖旧任务、私有原模型输出、参考代际或
历史结果指针。此前完成的纯文本/GPU验收不反复重跑；新改动的真实验收另记范围与成本。

## 原生媒体源码接手点

`server/backend/private_media.py`替换native main.py静态mount，旧URL保持但必须Bearer。
仅本人analysis显式overlay/skeleton引用、本人源视频hash/上传任务、仍存在analysis的
语音授权grant可读取；范围/条件请求同样先鉴权，限制MIME、单范围和真实文件体积，
阻止路径逃逸。voice路由在已授权合成后记录grant，删除analysis会使后续读取失效。

前端`lib/private-media-proxy.ts`、`app/api/private-media/session/route.ts`和catch-all
route通过固定上游授权与HttpOnly/SameSite媒体cookie进行有界流转发；每请求重新由
后端验证owner，不把JWT放在URL。Providers在登录身份变化时同步媒体会话，旧媒体
URL由mediaUrl映射为同源地址。必须同时部署对应native前后端，不能只上前端后宣称
旧后端已私有化。当前native配置、原生数据库、已有参考和8100固定发布都未改动。

新增测试：`server/tests/test_private_media.py`（11项）与native client
`scripts/private-media-proxy.test.mjs`（6项）、`private-media-session.test.cjs`（3项）。
与coaching HTTP/integration组合后50项通过；新增9项与既有26项均已执行。
源站OAuth仍未验证，不能把mock的cookie签入认作真实Google登录。
