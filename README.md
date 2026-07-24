# AAA Ski Platform

A private booking site for ski and snowboard lessons. Students pick a resort, a
coach and a time; sign a liability waiver; pay by e-Transfer, WeChat Pay or
Alipay and upload a screenshot. Coaches manage their availability and pricing,
confirm payments, and subscribe to their schedule from Google Calendar.

**This site is deliberately not public.** It is handed out as a link in a group
chat. Every page requires sign-in, nothing is indexable, and a signed-out
visitor cannot learn which coach teaches where, when, or for how much.

---

## Getting started

### One click (for testing)

Double-click **`start.bat`** (Windows), or run:

```bash
npm run launch
```

This finds a working Postgres (an already-running one, or it starts the
container, or falls back to a native install), applies migrations, seeds a demo
coach and student, turns on the development sign-in bypass, starts the dev
server and opens the browser. No Google OAuth or account setup needed — the
sign-in page lets you pick **Kevin** (coach) or **Wei Zhang** (student).
`stop.bat` shuts it all down.

### Manual

Requires Node 20.9+ and Docker (or a native PostgreSQL 17 — see `.env.example`).

```bash
cp .env.example .env.local     # then fill in AUTH_SECRET and Google OAuth
npm install
npm run db:up                  # Postgres 17 container on host port 5434
npm run db:migrate
npm run db:seed                # creates the two resorts
npm run dev                    # http://localhost:3000
```

The `booking_no_overlap` constraint needs the `btree_gist` extension. The
container image ships it and the migration enables it; on a native install
create it once with
`psql -U postgres -d ski -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"`.

Coaches are not seeded. Put their addresses in `COACH_EMAILS` and they are
promoted to `COACH` with a profile the first time they sign in with Google —
that keeps every coach account bound to a real verified mailbox, which the
waiver signing flow depends on.

### Checks

```bash
npm test              # unit tests for the domain logic
npm run check:overlap # proves the DB refuses double-bookings
npm run check:flow    # end-to-end booking + waiver run against the real DB
npm run sample:waiver # renders a sample waiver PDF to tmp/
npm run lint
npm run type-check
```

---

## How the domain works

### Time

Everything is stored in UTC and every business decision is made in
`America/Toronto` via `src/lib/time.ts`. The season crosses the March DST
switch, so 9am is UTC-5 in January and UTC-4 in April. Never construct a date
from a bare string; use the helpers.

### Season

A season runs **1 December to 1 May** and is named for the pair, e.g.
`2025-26`. Outside that window there are no lessons at all — both availability
and bookings are rejected, which is why `seasonOf` never has to guess.

### Pricing

A booking is on the hour with a two-hour minimum, but the lesson runs five
minutes short at each end so the coach can hand over to the next student. A
1:00–3:00 booking is taught 1:05–2:55.

Those ten minutes are credited back **once per booking, not per hour**, because
the handover happens once however long the lesson is:

```
$80.00 / hour × 2 hours     $160.00
Handover credit             −$15.00
Total (CAD)                 $145.00
```

All money is integer cents. No tax is calculated or displayed anywhere.

### No double-booking

The `booking_no_overlap` exclusion constraint makes an overlap impossible at
the storage layer. An application-level "is this free?" check loses to a race;
this does not. A lost race surfaces as SQLSTATE 23P01 and becomes a 409.

The status list in that migration must stay in sync with `OCCUPYING_STATUSES`
in `src/lib/booking/state.ts`. `npm run check:overlap` verifies it.

### Waivers

A waiver is keyed to a **participant**, a **coach**, a **season** and a
**template version** — never to an account. That is what stops a parent's own
signature from being credited to their child: they are different rows, so the
lookup simply misses.

Signed once per coach per season. Booking the same coach again that season
skips signing; booking the other coach does not.

Waiver rows are **append-only**. There is no update path — a correction means
signing a new one and setting `revokedAt` on the old. That, plus the stored
SHA-256 of the PDF and a server-generated audit page, is what makes the record
defensible.

Guardrails against cross-use, in `src/lib/participants.ts`:

1. Participants are picked explicitly, never inferred.
2. Minor status is derived from date of birth **on the lesson date**, server
   side. A client-supplied `isMinor` is ignored.
3. A minor's waiver must be signed by their guardian.
4. Self-serve booking refuses to create an adult who is not the account holder,
   because no adult can sign a waiver for another adult.
5. Once a minor turns 18 the guardian's signature stops applying.

### Two ways a booking is made

**Self-serve.** The student books, the slot is held for 30 minutes, and they
sign and pay within that window or it is released.

**Coach-created.** The coach books for a student who may have no account. The
slot is held with no timer — the coach owns it. A one-time signing link is
issued to the student's email; opening it requires signing in with *that*
address, and only then can they sign. The coach cannot sign for them. The link
is stored only as a SHA-256, expires in 7 days and is single-use.

### Files

Payment screenshots and signed waivers never go under `public/`. Anything there
is served unauthenticated, and a screenshot routinely shows a bank balance.
They live in a private `storage/` directory, are referenced by an opaque key
rather than a URL, and are streamed by route handlers that check the caller.
Uploads are re-encoded through sharp, which also strips EXIF — phone
screenshots can carry GPS.

### Calendar

The coach subscribes to an ICS feed at `/api/cal/<icsToken>`. No OAuth, no
consent screen, no stored token. Google polls external feeds on its own
schedule, so the schedule page also offers a one-click "add to Google Calendar"
link for anything needed immediately.

The feed URL is the only thing protecting it, and the UI says so.

---

## Before taking real bookings

- [ ] Have the waiver wording in `src/lib/waiver/template-v1.ts` reviewed by a
      lawyer licensed in Ontario. It is a draft.
- [ ] Have the policies in `src/lib/legal.ts` reviewed, and replace the
      ALL-CAPS placeholders.
- [ ] Confirm instructor liability insurance, and specifically whether it
      covers teaching independently at the resorts you use.
- [ ] Write the cancellation/refund policy in coach settings — a coach cannot
      take bookings until both language versions are filled in.
- [ ] Confirm the site is not reachable by search: `/robots.txt` disallows
      everything and every response carries `X-Robots-Tag: noindex`.

Two things worth knowing, neither of which the software can fix:

Most resorts prohibit non-employee instructors teaching on their property. I
could not find published policies for the two resorts seeded here, so this is
not an assertion about them — but a public, indexed site listing instructor
names, resorts and prices is the easiest way for a resort to find out. Hence
the private-by-default posture.

In Ontario a parent generally **cannot** waive their child's own right to sue.
The guardian waiver limits the guardian's claims, not the child's, and the
signing page says so rather than implying otherwise. Insurance is the real
mitigation, not the PDF.

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 ·
Prisma 6 + PostgreSQL · Auth.js v5 (Google only) · next-intl (zh/en) ·
pdf-lib + fontkit · sharp · Zod · Vitest

Note that Next 16 renames `middleware` to `proxy` — see `src/proxy.ts` — and it
runs on Node rather than edge, so no edge-safe auth split is needed.
