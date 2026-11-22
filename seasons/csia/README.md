# CSIA 雪季动作列表

每个雪季一份 JSON，例如 `2026-27.json`：这一季 CSIA 考官指南（candidate guide）里要考的动作，以及每个动作出自指南的哪一页。`current.json` 指明网站现在用哪一季。

- **网站用途**：标准动作库和使用指南里的动作，都按当前雪季的列表显示。
- **一个雪季的范围**：6 月 1 日到次年 5 月 31 日，和视频保存期限一致。
- **这些文件由“更新动作”写入**，不用手改。没有 `current.json` 时，网站用随代码发布的那一季（`src/lib/freeski/csia-season.ts`）。

## 每年的更新步骤

1. **下载新一季的考官指南（PDF）**
   放到 `J:\Freeski\FreeSkiclaude\server\data\candidate_guides\csia\official\`。旧版本留着，新文件名里带上年份。
2. **下载示范视频**
   按现有的方式放：`J:\Freeski\FreeSkiclaude\server\data\videos\csia\level<N>\<动作>\gold\序号_分数.mp4`（例如 `02_8.0.mp4`）。`gold` 文件夹里的视频是标准示范。
3. **在网站上核对材料、改动作列表**
   用教练账号打开「管理 → 动作列表」（`/zh/coach/actions`）：
   - 页面上方列出 FreeSki 里现有的指南文件，以及每个动作有几段标准示范、解析了几段；
   - 改雪季（例如 `2027-28`）、指南版本、每个动作的名称和页码，增删动作。
4. **点“更新动作”**
   后台按列表全量跑一遍，页面显示每一步的进度和运行记录，可以中途停止：

   | 步骤 | 做什么 |
   | --- | --- |
   | 核对材料 | 读取 FreeSki 里的指南和示范视频 |
   | 解析示范视频 | FreeSki 提取新视频里的动作（要用显卡，由 ModelCtrl 排队），再重建评分标准 |
   | 采样示范弯 | `scripts/standard-motion/extract_reference.py` 从每个动作的示范里取出标准的一个弯 |
   | 生成标准动作 | `scripts/standard-motion/generate.py` 生成每个动作的 3D 示范，并用 FreeSki 的评分核对 |
   | 检查结果 | 每个动作都生成了、能打开、名称和页码与列表一致、评分核对不低于 70 分 |
   | 发布 | 换上 `public/standard-motions/*.json`、采样结果、`docs/STANDARD_MOTIONS.md`、本文件夹的列表和 `current.json` |
   | 更新自动识别 | FreeSki 按新的标准动作重建“自动识别动作”的模型；新模型不如原来的时，保留原来的 |

   检查不通过或中途失败时，网站保持原样。被替换的文件保留在 `storage/season-updates/<运行编号>/replaced/`（只留最近 3 次）。
5. **提交**
   “发布”一步会改动仓库里的文件。确认网站显示正常后，把这些改动提交到 git。

## 什么情况需要开发

列表里只能加网站已经会生成和评分的动作，也就是页面“加一个动作”里列出的那些。指南里出现全新的动作，或者已有动作出现在新的级别时，要先：

- 在 `scripts/standard-motion/csia_specs.py` 写这个动作的速度、坡度、弯的大小和要求；
- 在 `src/lib/freeski/standard-motion.ts` 和 `src/lib/freeski/actions.ts` 登记动作和级别；
- 让 FreeSki 认识这个动作并能评分。

## 服务器配置

“更新动作”在后台分析进程里运行（网站用 ski-launch 启动时自带）。生成工具在 `.env.local` 里指明，只在服务器端读取：

```dotenv
SEASON_PIPELINE_PYTHON="D:/conda/envs/freeski/python.exe"
SEASON_PIPELINE_FREESKI_DIR="J:/Freeski/FreeSkiclaude/server"
```

没有配置时，页面会说明，按钮不可用。FreeSki 没有开放雪季接口时，“解析示范视频”和“更新自动识别”两步跳过，其余照常。

## 检查

```bash
npx vitest run src/lib/freeski/csia-season.test.ts
```

它检查当前雪季的每个动作：有生成好的标准示范；网站认识这个动作和级别；名称和指南页码与列表一致。
