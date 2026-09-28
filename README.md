# AAA Ski Platform

A private booking site for ski and snowboard lessons. Students pick a resort, a
coach, a lesson type and a time; sign a liability waiver; pay by e-Transfer,
WeChat Pay or Alipay and upload a screenshot — or spend hours from a prepaid
lesson package. Coaches manage their availability and prices, confirm payments,
and subscribe to their schedule from Google Calendar.

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
container, or falls back to a native install), applies migrations, seeds two
demo coaches on the published price sheet and a student, turns on the
development sign-in bypass, starts the dev server and opens the browser. No
Google OAuth or account setup needed — the sign-in page lets you pick **Kevin**
or **Alisa** (coaches) or **Wei Zhang** (student).
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

Each coach has a **rate card**: an hourly one-on-one price per lesson type —
滑行课 ski lesson (`riding`), 一级考前培训 CSIA Level 1 prep (`csia1_prep`) and
公园 park (`park`), catalogued in `src/lib/lesson-types.ts` — each with a regular
price and an optional early-bird one (`CoachRate`). A coach offers a type by
pricing it; Alisa has no park rate, so she is never offered for park.

**Early bird** is decided by the day the booking is *made*: anything booked on
or before **1 December** (the season's opening day) pays the early-bird price for
any lesson that season. The rule lives in `src/lib/rates.ts`.

A booking is on the hour with a two-hour minimum. The first ten minutes are the
coach's handover from the previous student, so the lesson starts at ten past and
runs to the hour: a 1:00–3:00 booking is taught 1:10–3:00.

Those ten minutes are credited back **once per booking, not per hour**, because
the handover happens once however long the lesson is:

```
Ski lesson · early bird
$60.00 / hour × 2 hours     $120.00
Handover credit             −$10.00
Total (CAD)                 $110.00
```

A group adds the coach's per-extra-student surcharge ($20/h by default) to the
base rate, though multi-person booking stays closed until every attendee can
carry their own waiver (`src/lib/booking/group.ts`).

Every price is snapshotted onto the booking — type, early-bird flag, rate,
totals — so a coach editing their rate card never rewrites an existing booking.

All money is integer cents. Published prices are final: no tax is calculated or
displayed anywhere.

### Lesson packages

The price sheet's Blue Mountain package — **four hours of ski lessons for $180,
with any coach, early bird only** — is an offer in `src/lib/packages.ts`.

- The student orders it on `/packages` and **chooses which coach to pay**. That
  coach confirms the screenshot, exactly like a booking payment; money still goes
  straight to a coach and the platform never holds it.
- Once confirmed, the hours can be spent on ski lessons at that resort in that
  season with **any** coach, in bookings of at least two hours. A package pays
  for a whole booking or none of it, and nothing is owed on that booking; after
  the waiver it is confirmed directly.
- Hours left are never stored. They are derived from the bookings that point at
  the package, so an expired or cancelled booking hands its hours back. Booking
  takes a row lock on the package, so two requests cannot spend the same hours
  (`npm run check:flow` proves it).
- When Alisa teaches hours Kevin was paid for, `/coach/packages` shows who owes
  whom at the package's price per hour ($45).

Packages come off sale after 1 December; an unpaid order can no longer be paid
after that, though a rejected screenshot can always be replaced.

### What coaches can see

Each coach sees their own business and nothing of another coach's: their own
bookings, and the packages paid to them. The single exception is **package
hours left** — under **Students** (`/coach/students`) every coach sees every
student's unused hours, because any coach can be booked with them. Money,
lessons, contact details and who a student books for come only from that
coach's own bookings and packages.

A package page opens only for the buyer and the coach who was paid. That
coach sees their own lessons from it in full and another coach's use only as
hours per coach, which is what settling up needs.

**Stats** (`/coach/stats`) totals a season for the coach looking at it: money
received and outstanding, hours taught and booked, lessons and students,
packages they sold and those packages' unused hours, by lesson type, resort,
price and month. The definitions live in `src/lib/stats.ts`.

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
- [ ] Have each coach enter their rate card in coach settings: early-bird and
      regular price for every lesson type they teach. The migration carried an
      existing coach's single hourly rate over as their regular ski-lesson price
      only, with no early-bird price and no other types.
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
