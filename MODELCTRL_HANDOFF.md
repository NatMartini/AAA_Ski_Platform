# ModelCtrl 对接说明 —— 给 AAA Ski platform 的负责人（Codex）

写的人：ModelCtrl 的负责人（`J:\Model_ctrl`，Claude）。日期：2026-10-12。
这是 ModelCtrl 在本仓库里写的唯一一个文件，其余我只读。需要你做的事在「要你做的」一节。

## 背景：发生了什么变化

社长 2026-10-12 决定：**这台电脑上所有本机模型都由 ModelCtrl 启动和卸载，显卡归谁也由它调度**；Autofocus、AutoRetouch、FreeSki / AAA Ski platform 和以后的项目都只通过 `http://127.0.0.1:8765` 向它要资源，组成一个统一的系统。完整接口见 `J:\Model_ctrl\docs\integration.md`。

之前那一版（v2）ModelCtrl 自己不管模型，只能写文件请 Autofocus 的门卫卸载、再等它回一个 ACK 文件。门卫的接入一直没装上，所以 FreeSki 任务提交后会永远排队。v2 的合同文件、ACK、租约、多方联合验收、每小时续跑都已撤销。

现在的规则（每秒判断一次）：

1. 社长在用电脑（有游戏进程，或别的程序重度占用 GPU / 显存）→ 模型卸载、任务进程结束，全部让路；负载解除 60 秒后恢复。普通键鼠和浏览器不算。
2. 否则，有待处理工作的项目里重要度最高的说了算。`freeski` 的重要度是 80，高于两个助手的 50：**视频分析任务一入队，ModelCtrl 立刻结束它自己启动的模型进程，确认退出后启动分析进程**；队列清空后把模型加载回来。
3. 谁都没工作 → 保持 Qwen 模型在线给两个助手用。

社长可以在控制台 `http://127.0.0.1:8765/` 拖滑块改重要度，或手动把资源切给某个项目。

## 对本仓库的影响：提交方式不变

你们现有的链路继续有效，不需要改：

`AnalysisDispatcher`（`scripts/video-analysis-worker.ts`）→ 隔离的 FreeSki API（`scripts/freeski-runtime.py`）→ FreeSki 的 `upload_queue` → `POST http://127.0.0.1:8765/api/jobs`（`project=freeski`）→ ModelCtrl 启动 `freeski-runtime.py --job-file …` 作为受管进程。

没有变的：

- `POST /api/jobs`、`GET /api/jobs/{id}`、`POST /api/jobs/{id}/cancel`、`POST /api/heartbeat` 的请求和响应字段；
- 任务状态 `queued / running / completed / failed / interrupted / cancelled`，以及 `attempts`、`preemptions`、`reason`、`used_seconds`、`max_runtime_seconds`；
- 工作进程环境变量 `MODELCTRL_JOB_ID`、`MODELCTRL_PROJECT`、`MODELCTRL_ATTEMPT`；
- 令牌文件 `J:\Model_ctrl\data\api-token.txt`、SDK `J:\Model_ctrl\sdk\modelctrl_client.py`（`submit / get / cancel / heartbeat / wait` 签名没变），所以 README 里的 `MODELCTRL_URL` / `MODELCTRL_SDK_PATH` / `MODELCTRL_TOKEN_FILE` 三项配置仍然正确；
- 约束：`command[0]` 是绝对路径的可执行文件（不能是 `.bat/.cmd/.ps1`），`cwd` 必须在 `J:\AAA_Ski_platform` 或 `J:\Freeski` 之内，密钥不进 `command` / `env`。

变了的：

- 不再等门卫的 ACK。任务排队的原因直接看 `GET /api/jobs/{id}` 的 `reason` 和 `GET /api/status` 的 `effective_block` / `blocked`。
- 没有时间片轮转。任务跑到结束或跑满 `max_runtime_seconds`；会打断它的只有社长开游戏 / 别的程序重度用 GPU，或社长在控制台手动切到别的项目。被打断时 `restart_safe=true` 的任务回到 `queued` 自动重跑，否则变 `interrupted`。
- `GET /api/status` 的 `assistant_pool` 只是兼容字段（`released=true` 表示没有模型进程在占显卡）。新字段是 `runtime`（已加载模型的状态）、`target`（当前决定）、`blocked`、`effective_block`。`released_lease_id`、`assistant-residency.json`、`C:\ProgramData\ModelCtrl\assistant-ack.json` 已不存在。
- `POST /api/jobs` 带 `kind=lease`、`/api/jobs/{id}/renew`、`/complete` 已取消（本仓库没用到）。

## 要你做的

1. **核对，不必改代码**：确认本仓库里没有依赖上面「变了的」那几项的地方（我搜到 ModelCtrl 相关的只有 `README.md`、`scripts/freeski-runtime.py`、`scripts/test-freeski-runtime.py`、`scripts/video-analysis-worker.ts`，都没有依赖）。如果有取证或测试脚本读 `assistant_pool.released`、ACK 文件之类，改成读 `runtime.state`。
2. **界面上的排队原因**：如果站内给用户显示「分析排队中」，原因取 ModelCtrl 的 `reason` / `effective_block`（例如「检测到游戏：cs2.exe」「其他程序占用大量显存」），不要自己猜。
3. **守住一条规矩**：本仓库和它调起的任何进程，都不要自己启动占显卡的常驻模型或绕过 ModelCtrl 直接跑 GPU 分析。README 第 186 行附近已经是这个意思，保持即可。
4. **以后要用本机大模型**（比如用 Qwen 给分析结果写文字点评）：不要起 llama-server，经 ModelCtrl 的推理网关调（`POST http://127.0.0.1:8765/v1/chat/completions`，头 `X-ModelCtrl-Project: <项目 ID>`，见 integration.md「方式 A」）。需要时告诉我，我登记一个带模型的项目 ID；或者让社长在控制台「添加项目」。
5. **一次真实验收**（等我通知「切换完成」之后再做，见下一节）：经站内真实入口上传一段视频，记录任务号和三个时间点——入队、开始执行、完成——以及业务结果是否正确。
6. **停掉 v2 时期的每小时续跑**：如果有为 ModelCtrl 联调注册的定时任务或续跑提示（FreeSki 仓库里有 `FreeSki-ModelCtrl-Hourly-Continue`），它读的 `leader-dispatch.md` 已经换成 v3 的内容，依赖门卫 ACK 的验收项没有对应的东西了，可以停。

## 现在还不能真跑的原因

ModelCtrl v3 已在 8765 上线，但 Qwen 模型此刻还在 Autofocus 的旧门卫手里（一个 SYSTEM 服务，占 26.6 GB 显存）。ModelCtrl 把它看作「其他程序占用大量显存」，所以 FreeSki 任务现在提交后会排队，`reason` 里写着这个原因。

要等两件事：Autofocus 的负责人把门卫改成只做鉴权转发（不再自己起模型），然后社长用管理员权限装一次。之后模型由 ModelCtrl 启动，FreeSki 任务入队就会真的把它卸掉。**你这边不需要为这个做任何改动。**

## 怎么联系我

- 回复写到 `J:\Model_ctrl\handoffs\AAA-reply.md`（新建，带时间追加）。
- 有接口上的问题或发现 ModelCtrl 的行为和这里写的不一致，写清楚任务号、时间和看到的 `reason`。
- 控制台：`http://127.0.0.1:8765/`。任务进程的输出在 `J:\Model_ctrl\data\logs\<任务号>.log`。

## 补充（2026-10-12 16:00）

- FreeSki 仓库里有两个文件因为 v3 失效，属于 10-11 做接入的那条工作线（FreeSki 的 Claude 会话确认不是它写的，没有动）：
  - `J:\Freeski\FreeSkiclaude\server\tests\test_modelctrl_process_acceptance.py` 的 `test_two_freeski_jobs_keep_residents_unloaded_and_resume_after_preemption` 现在失败（`FileNotFoundError`）：它直接导入 `modelctrl.core.Scheduler`，用 `assistant_pool.ack_timeout_seconds`，读 `data/assistant-residency.json`、写 `assistant-ack.json`，这些都没有了。
  - `J:\Freeski\FreeSkiclaude\scripts\collect-modelctrl-evidence.py` 大概同理。

  请退役或重写。想保留那条测试的话，判断条件换成 `GET /api/status` 的 `runtime.state == "stopped"`（模型进程已退出）加任务状态即可，不需要任何确认文件；ModelCtrl 自己的同类测试在 `J:\Model_ctrl\tests\test_scheduler.py` 和 `tests\test_gateway.py`，可以参考写法。
- 新登记了项目 ID `freeski-text`（模型 `qwen3.8-flash-next`，重要度 40），给 FreeSki 的文字类大模型调用用，走推理网关。视频分析任务仍然用 `freeski`。
- 可用内存保护：模型在线时可用内存低于 3 GB 会卸载模型，低于 8 GB 时不加载。这只影响模型，不影响你们的分析任务。

## 更新（2026-10-12 20:20）—— 分工和现状

- **上面「补充」里那两个 FreeSki 仓库的失效文件，已指派给 FreeSki 的 Claude 会话处理（退役），请不要重复改。**
- **真实上传验收（AAA-02）由你这条线做**：等 ModelCtrl 在 `J:\Model_ctrl\handoffs\leader-dispatch.md` 里把 AF-05（门卫切换）标为完成之后，经站内真实入口上传一段短视频，把任务号和入队 / 开始 / 完成三个时间点写到 `J:\Model_ctrl\handoffs\AAA-reply.md`。FreeSki 的 Claude 会话负责核对业务结果。你不方便做的话，在 `AAA-reply.md` 里说一声，由社长自己上传。
- **ModelCtrl 现在处于「待命」**：门卫切换完成前不加载模型、不启动任务。此时提交的任务只会排队，`GET /api/status` 的 `blocked` 以「待命：」开头。这是预期状态，不是故障。
- 新增两个项目 ID：`freeski-text`（走推理网关的文字类调用）、`freeski-batch`（一次性的 GPU 批处理，重要度低于真实上传的 `freeski`）。站内上传的视频分析仍然只用 `freeski`。
- 全部项目的顺序和负责人见 `J:\Model_ctrl\handoffs\leader-dispatch.md`。

## 更新（2026-10-12 20:35）—— FreeSki 仓库里和你那条线有关的改动

这些都是 FreeSki 的 Claude 会话按 ModelCtrl 的安排做的，告诉你是为了避免你回来时对不上：

- 已移到 `J:\Freeski\FreeSkiclaude\docs\archive\modelctrl-v2\`（没有删除）：`collect-modelctrl-evidence.py`、`test_modelctrl_evidence.py`、`test_modelctrl_process_acceptance.py`。`MODELCTRL_TASK.md`、`docs/MODELCTRL_FORMAL_ACCEPTANCE.md`、`docs/MODELCTRL_INTEGRATION_2026-10-11.md` 顶部加了「已被 v3 取代」的说明。FreeSki 全套测试现在 364 通过、0 失败。
- `server/engines/vlm_client.py`、`server/scripts/check_vlm.py` 改成走 ModelCtrl 的推理网关（项目 `freeski-text`），不再直连 8081。
- **即将改一处你写的文件**：`server/shared/modelctrl_runtime.py` 的 `require_broker_worker()` 现在只认 `MODELCTRL_PROJECT == "freeski"`。为了让一次性的评估批处理能以项目 `freeski-batch` 运行（这样真实上传的分析可以打断它，而不是被它堵住），姿态管线的入口守卫会放宽到同时接受 `freeski-batch`；上传结果的签章和 `read_worker_result` 的校验仍然只认 `freeski`，`project=freeski` 时的行为不变。改完后的文件和哈希会追加在这里。
- `scripts\` 下 4 个每小时续跑脚本（`install-modelctrl-hourly.ps1` 等）没有动，等社长删掉已停用的计划任务后再归档。

## 更新（2026-10-12 20:40）—— 上一条说的那处改动已完成

FreeSki 的 Claude 会话改完了管线守卫，FreeSki 全套测试 371 通过 / 16 跳过 / 0 失败。`project=freeski` 时的行为不变；上传结果的签章和校验仍然只认 `freeski`。

| 文件（`J:\Freeski\FreeSkiclaude\server\` 下） | 改了什么 | 改动后 SHA256 |
|---|---|---|
| `shared/modelctrl_runtime.py` | 新增 `PIPELINE_PROJECTS = frozenset({"freeski", "freeski-batch"})`；`require_broker_worker()` 多一个可选参数 `projects`，默认只含 `freeski`，不传时和原来等价。`write_worker_result` / `read_worker_result` 没动 | `313626a41bf33e61f9e1102e8ad1915e0d5232603d9350d23252716b9ee9aa16`（改动前 `fb38da92…5314a`） |
| `engines/gpu_pipeline.py` | `SkiPosePipeline.__init__` 开头改成 `require_broker_worker(PIPELINE_PROJECTS)`，其余没动 | `ea754b09c448f7fbae77e6758397b2300ffd83ccae375db12a340c11fadfb49f`（改动前 `ace568dc…ba0a4`） |
| `tests/test_modelctrl_runtime.py` | 只追加测试，原有 10 项没改 | `0bb53d52ad459a3121dea23c38f436ea3873b35bb5d3b0e7c260aa3d59a0cade` |
| `scripts/extract_eval_poses.py` | 新文件：评估用的 silver 姿态提取，可断点续跑，以项目 `freeski-batch` 提交，只写 `storage/eval_corpus/` | `4df3a4cb14128ad854ad214ad959f60b49fc3855b55d77da7a188830dd257fc7` |

没动的调用点：`backend/modelctrl_worker.py` 的两处、`engines/comparison_engine.py` 的 `_get_pipeline()`，仍是不带参数的 `require_broker_worker()`，只认 `freeski`。

**留给你的一个偶发失败（FreeSki 会话发现，没有动）：** `tests/test_upload_queue_modelctrl.py::test_killed_worker_checkpoint_can_restart_without_committing_partial_output` 今天 7 次里失败过 1 次，报 `FreeSki broker worker failed: PermissionError`。看起来是测试的轮询正在读 `checkpoint.json` 时，工作进程用 `os.replace` 覆盖它，Windows 上目标文件被打开时替换会被拒；FreeSki 的 `atomic_write_json`（`shared/modelctrl_runtime.py`）没有重试。生产路径（`upload_queue.py`）不读这个文件，所以现在只是测试偶发失败；但以后如果有进程在工作进程运行期间读它，工作进程会因此退出。ModelCtrl 这边同类问题的处理在 `J:\Model_ctrl\modelctrl\atomic_io.py`（对替换时的共享冲突做有界重试），可以参考。
