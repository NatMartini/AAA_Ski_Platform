# Optional human video feedback

Human feedback is a separate Ski Platform workflow. It does not reserve analysis credits, wait for AI completion, confirm payments, or cause FreeSki to generate text under a coach's identity.

## Using it

1. The account owner opens a personal or lesson video in the analysis workspace and selects **Request or view feedback**.
2. They select a coach and explicitly authorize this individual clip. Eligible coaches have a confirmed/completed lesson with this account or have issued it personal analysis credits. Those relationships only populate the selection list; they do not grant access to personal clips.
3. The selected coach opens **Coach → Video reviews**, starts the review, watches the clip, and writes their own text. Saving a draft does not publish it, and drafts are not returned to the student.
4. Publishing requires the coach's explicit viewed-video, personal-authorship, and publication confirmations. The browser enables the authorship confirmation after video playback reaches the end; the server also requires a successful authorized video fetch. These checks record the coach's declaration, not proof of human attention.
5. The student receives a site inbox notification when the coach publishes. They can cancel the request or replace the coach. This revokes that request's reviewer reads, edits, and subsequent media requests, including Range requests. Published feedback remains in the owner's history.

The coach who already teaches a lesson retains their separate, pre-existing access to that lesson's footage. Revoking human-review authorization does not revoke legitimate lesson access. Unrelated coaches and administrators cannot use the legacy lesson-video endpoint to bypass this boundary. Personal-video endpoints continue to allow only their owner; reviewers must use the explicitly authorized request endpoint.

## Data and endpoints

`CoachVideoReviewRequest` stores an immutable owner/coach/source assignment, explicit consent version/time, source upload-metadata fingerprint, optional frozen automatic-report snapshot, private draft, separately published text, viewing declaration provenance, revision, and lifecycle timestamps. An absent request is `NOT_REQUESTED`; persisted requests progress through `REQUESTED`, `IN_REVIEW`, `PUBLISHED`, and `CANCELLED`. Changing the coach cancels the old assignment and creates a new request; it does not silently retarget a draft.

All state transitions serialize on the owner's User row and reject stale revisions. A partial unique index permits one current request per owner/scope/video, while cancelled assignments remain auditable. Clip deletion nulls the media relation and blocks reviewer access without erasing published historical text. A report snapshot is never used to prefill the coach's draft. The source fingerprint identifies the stored upload and metadata; it is not a claim of independent video-content verification.

- `GET/POST /api/video-analysis/coach-feedback`: owner-only per-video state / explicit request.
- `GET/PATCH/DELETE /api/video-analysis/coach-feedback/{id}`: authorized detail / coach draft and publication / owner cancellation.
- `GET/HEAD /api/video-analysis/coach-feedback/{id}/video`: authorized streamed media, single byte-range support; HEAD and rejected ranges do not count as viewing.
- `GET /api/coach/video-reviews`: only the current coach's authorized requests.
- `/{locale}/coach/video-reviews`: coach workspace.

Every media request rechecks current actor, assignment, consent status, business eligibility, source ownership, and upload identity. Responses use private no-store caching. Already delivered bytes cannot be recalled. The site inbox selects minimal status/identity fields and never includes drafts, published prose, upload paths, or report snapshots.

## Migration and verification

`20261022000000_coach_video_review` adds the independent ledger, enum types, constraints, indexes, and nullable media relations. `20261022020000_analysis_deployment_identity` separately adds nullable deployment/API identity columns to both existing AI job ledgers. Neither migration rewrites historical analysis results or payment review notes.

On the existing local database, the migration run verified 15 completed historical migrations and their checksums, retained one previously rolled-back migration audit record, created and listed a custom-format backup, and applied the two new migrations with `prisma migrate deploy`. All 21 existing business-table row counts were unchanged. Evidence is retained under `tmp/backups/coach-review-migration-2026-10-22T20-51-00-322Z.json`; this local check does not prove deployment in other environments.

Run the focused permission, state-race, publication, media, API, and inbox checks:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/video-analysis/coach-feedback.test.ts src/lib/video-analysis/coach-feedback-media.test.ts src/lib/video-analysis/coach-feedback-notifications.test.ts src/lib/notification-store.test.ts src/lib/notifications.test.ts src/lib/analysis-notifications.test.ts 'src/app/api/video-analysis/coach-feedback/route.test.ts' 'src/app/api/bookings/[code]/videos/[videoId]/route.test.ts'
```

The focused suite currently contains 63 passing tests. Its serialized repositories exercise authorization, cancellation/publication races, idempotency and stale revision handling without mutating real student data. Real browser acceptance should be recorded separately from these tests.
