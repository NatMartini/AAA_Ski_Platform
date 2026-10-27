<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Hourly continuation for the existing Ski Platform chat

The user requested on 2026-10-23 that new work in chat
`01a0fec1-db67-7ec0-9e72-75a41aa21910` automatically arms its hourly continuation.
For a substantive new request in that exact chat, run
`node scripts/hourly-continue.mjs --activate` before continuing work; reuse task
`AAA-Ski-Chat-Hourly-Continue-01a0fec1`. If missing, install it with
`scripts/install-hourly-continue.ps1`. The installer must verify an existing
task's owner and action before reusing it. Do not apply this policy to other chats.
Heartbeat prompts and ambient context are not new tasks. Repeated activation
with the same substantive request must not rearm a completed or manually stopped
task; a real new user request has a distinct timestamp-bound request identity.
Read `docs/CURRENT_TASK.md`; keep its outstanding work accurate. The hourly
prompt is a wakeup, not a new project objective. Completion must be backed by
`docs/IMPLEMENTATION_STATUS.md` and the expected user-request hash; then disable
the task with the runner's `--complete` command. Never bypass usage limits,
steal another thread writer, or enable unrelated scheduled tasks.
