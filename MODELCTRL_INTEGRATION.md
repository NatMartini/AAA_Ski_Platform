# ModelCtrl v3 对接记录

核对时间：2026-10-12 21:45，`America/Toronto`。

依据 Claude 的 [MODELCTRL_HANDOFF.md](MODELCTRL_HANDOFF.md)（含 20:40 更新），以及本机 `J:/Model_ctrl/docs/integration.md`、`J:/Model_ctrl/handoffs/leader-dispatch.md` 和实时接口。本文件记录 AAA 的工作，不修改其他项目的调度配置或交接文件。

## 结果与边界

| 项目 | 状态 |
| --- | --- |
| AAA-01：核对 v3 兼容性 | 已完成；生产链路没有依赖旧版 ACK、residency、`assistant_pool`、`kind=lease`、renew 或 complete 接口 |
| 当前阻塞原因显示 | 已完成；个人和课程分析任务均可显示真实 `effective_block` / `blocked`，随现有轮询刷新 |
| 状态接口鉴权与私有信息隔离 | 已完成；未登录和非专用服务账号不能读取，浏览器仅收到经过过滤的排队文本 |
| AAA-02：真实站内上传并完成 GPU 分析 | 尚未执行；AF-05 未完成，ModelCtrl 仍在待命。需切换完成后记录任务号及入队、开始、完成三个时间点 |

现有提交链保留：

```text
AAA 业务预约 / 账号额度
  → AnalysisDispatcher
  → 隔离 FreeSki API / upload_queue
  → ModelCtrl POST /api/jobs（project=freeski）
  → 受管 freeski-runtime.py --job-file …
  → 校验结果 → AAA 结算一次分析额度
```

任务保持稳定的幂等键，等待资源、抢占、暂停或短暂断联时保留任务和预留次数。明确失败或无法评分才退回次数。业务状态同步租约与已撤销的 ModelCtrl v2 资源租约无关。

## 本轮修改

- 隔离 wrapper 新增专用账号认证的 `GET /api/aaa/scheduler`，使用官方 SDK 读取状态，只返回连接状态、有限运行状态和当前阻塞原因。
- wrapper 在导入后台队列和受管 worker 前验证 `MODELCTRL_URL`，仅允许回环 HTTP，防止误配将调度器令牌发送到外部。
- adapter 再次过滤原因中的路径、URL、凭据和控制字符，最多保留 400 字；不向网页返回完整快照、其他项目任务或内部任务 ID。
- 个人与课程分析先完成权限检查及数据库事务，再并行读取服务健康和一次调度快照。只给本次已授权的 `QUEUED` 任务附加 `queueReason`，运行中及终态不显示旧原因。
  已被 FreeSki 接收（同一部署）的 `QUEUED` 任务另读一次 `/api/jobs/{id}` 的 `queue_reason`，附加为 `computeWait`
  （`compute_offline` / `waiting_for_compute`），每次页面读取最多 10 个，读不到就不显示；上游任务 ID 不进页面数据。
- ModelCtrl 实际存在 `stopping` 过渡状态，窄接口保留连接及原因，但运行状态返回 `null`，避免误报模型已停止。

## 验证证据

- TypeScript / Vitest：92 个测试文件，**1107 项通过**。
- Python 隔离 wrapper：**19 项通过**，含鉴权、回环限制、状态过滤、断联、停止过渡状态及既有数据保留测试。
- ESLint、类型检查和生产构建通过。
- 真实隔离服务 `:8000`：未登录读取调度状态返回 **401**，专用后台账号读取返回 **200**，仅含预定的三个字段。
- 实时 ModelCtrl：v3，`runtime.state=stopped`，原因以「待命：Autofocus 门卫切换完成前……」开头。没有解除待命或启动 GPU 任务。
- 测试网站 `http://localhost:3000/zh` 已启动；首页、学员视频工作台和教练次数发放页返回 **200**，匿名读取账号视频接口返回 **401**，账号响应为私有且不缓存。
- 已先备份并验证 PostgreSQL 备份可读取；启动器核对 15 个迁移，无待应用迁移，未重置数据库。

本机详细证据：

- [HTTP 与调度状态](tmp/modelctrl-v3-live-2026-10-13T01-45-41-327Z.json)
- [迁移前数据库备份](tmp/backups/pre-modelctrl-v3-2026-10-13T01-43-02-937Z.dump)

以上文件位于忽略提交的私有 `tmp/`；数据库备份含业务资料，不应公开。页面和状态检查不等于真实视频分析验收；本轮没有提交新的分析任务或消耗学员次数。

## 后续真实分析验收

先确认 AF-05 在 ModelCtrl 统筹表中完成且待命已由对应负责人解除，再用正常学员入口上传短视频并提交分析。记录 AAA 任务号、上游任务号、ModelCtrl 任务号及入队 / 开始 / 完成时间，检查报告、次数仅结算一次、抢占后恢复以及模型资源释放。业务结果由 FreeSki 负责人核对。

两个旧联调计划任务 `FreeSki-ModelCtrl-Hourly-Continue`、`ModelCtrl-Hourly-Continue` 当前均已禁用，本轮未重新启用或删除。Claude 提到的 FreeSki Windows `atomic_write_json` 共享冲突已核实，位于外部仓库；本轮未改动其文件，仍需 FreeSki 负责人处理。
