# Design brief — AAA Ski Lessons booking site

Paste everything below into Claude (or a design tool). It is self-contained;
the designer does not need the codebase. The goal is a polished, cohesive
visual design for an existing, fully working web app — the flows and logic are
done, they just need to look good.

---

## Prompt to paste

> You are designing the frontend for **AAA Ski Lessons**, a small private
> booking website for a couple of independent ski/snowboard instructors in
> Ontario, Canada. The app already works end to end — I need you to redesign
> the **visual layer only**: a cohesive, modern, trustworthy design system and
> high-fidelity mockups of the key screens. Do not change the flows, the fields,
> or the wording's meaning.
>
> **Deliverable:** a single self-contained HTML file (Tailwind via CDN is fine)
> that presents (a) the design system — color, typography, spacing, and the core
> components — and (b) mockups of the 6 key screens listed below, in both light
> and dark mode, at mobile width (most bookings happen on a phone) and desktop.
> Make it look like something people would trust with a payment.
>
> ### Who uses it
> - **Students** — mostly Chinese-speaking, some English. They find the coach on
>   RED (小红书), get added to a WeChat group, and open a link. They book on
>   their phone, often outdoors. Range from anxious first-timers to parents
>   booking for their kids.
> - **Coaches** — the two instructors, managing availability, prices, bookings
>   and payment confirmations.
>
> ### Brand feel
> Clean, calm, and premium but not cold. Wintry without being childish or
> "extreme sports". It should feel like a trustworthy independent professional,
> not a big resort chain and not a toy. Confidence and clarity over decoration.
> Bilingual: Chinese text is denser and needs comfortable line-height; the two
> languages should feel equally first-class, not one bolted on.
>
> ### Hard constraints
> - Built in **Next.js + Tailwind CSS**, so express the system in Tailwind-ish
>   tokens (CSS variables + utility classes), not bespoke CSS frameworks.
> - **Light and dark mode** both required, driven by CSS variables.
> - **Mobile-first**, thumb-friendly tap targets (min 44px), works one-handed.
> - **Accessible**: WCAG AA contrast, visible keyboard focus, real buttons and
>   labels. The time-slot grid especially must be operable by keyboard.
> - **Private site** — there is no marketing/landing page and no hero imagery of
>   named resorts; a signed-out visitor sees only a sign-in prompt.
> - No tax, no invoices — this is informal. Prices are in CAD.
>
> ### Current palette to evolve (keep the cold blue spirit, refine freely)
> A cold "ice" blue ramp is in use. Light mode: near-white surfaces, deep
> blue-slate ink (#12202e), muted blue-grey secondary text, accent ~#2a5479.
> Dark mode: deep navy background (#0e1620), lighter surfaces (#16212e), soft
> off-white text (#e8eef4), brighter accent (#659fc8). You may retune these,
> add a warm secondary if it helps, and introduce subtle depth (shadows,
> borders) — just keep it calm and legible.
>
> ### The 6 key screens to mock
>
> 1. **Sign in** — a small card: brand, one line ("This site is for students who
>    have been in touch with a coach"), a "Continue with Google" button.
>
> 2. **Home (signed in)** — greeting, and two big entry cards: "Book a lesson"
>    and "My bookings". Coaches also see a "Coach area" card.
>
> 3. **Book a time (the most important screen)** — top to bottom:
>    - A **coach introduction** card: photo, name, a short bio, credentials.
>    - A **date** dropdown.
>    - A **time-slot grid** of start times as tappable tiles (e.g. 09:00, 10:00,
>      11:00, 14:00). Only bookable times appear — no greyed-out cells. Selected
>      state must be obvious.
>    - A **duration** selector (2h minimum) and a **group size** selector
>      (1 student, or 1-on-2, 1-on-3…).
>    - A **price breakdown** panel that spells out the math, e.g.:
>      `Group of 2` · `$110.00 / hour × 2 hours = $220.00` ·
>      `Handover credit (10 min per booking) −$15.00` · **`Total (CAD) $205.00`**.
>      Also a note: the lesson runs 1:05–2:55 (5 min shorter each end for
>      handover), shown as "Lesson runs 1:05 PM – 2:55 PM (110 min)".
>    - A **participant** dropdown ("Myself", or a child) with an "Add participant"
>      action.
>    - A primary "Confirm booking" button.
>
> 4. **Sign the waiver** — a prominent amber warning banner ("by signing you give
>    up certain legal rights"), then a **scrollable agreement box** the user must
>    read to the bottom before signing, a set of **individual acknowledgement
>    checkboxes**, a **typed-name** field, and a **draw-your-signature** canvas
>    with a Clear button, then a Sign button that is disabled until everything is
>    done. This screen must feel serious and legible, not scary.
>
> 5. **Payment** — the amount in large type, the price breakdown again, a choice
>    of method (Interac e-Transfer / WeChat Pay / Alipay) showing the address or
>    a QR code, a note to "cover your balance before uploading", and a
>    **screenshot upload** with a preview and a Submit button. Also handle a
>    "your slot is held for 29:14" **countdown** and a "payment was not accepted,
>    please re-upload" state.
>
> 6. **Coach — schedule & bookings** — a week/day view of upcoming lessons as a
>    clean table or timeline (time, student, resort, fee, status pill), an
>    availability manager (open a day → pick resort → hours → lunch toggle), and
>    a settings form (rates, group surcharge, payment methods, cancellation
>    policy). Show the **status pills**: Holding, Waiver needed, Payment needed,
>    Checking payment, Confirmed, Cancelled.
>
> ### Components to define in the system
> Buttons (primary/secondary/ghost/danger), cards, form inputs & selects &
> textareas with labels + hints + error states, the time-slot tile, the price
> breakdown table, status pills, the signature pad frame, the QR/payment block,
> the countdown, a language switch (中文 / EN), and a coach-intro card.
>
> Show it all in one page, organized as: design tokens → components → the 6
> screens (mobile then desktop, light then dark). Prioritize clarity, trust, and
> a confident bilingual layout.

---

## Notes for me (not part of the prompt)

- When the design comes back, it's a **visual reference**. Translating it into
  the real components means editing the Tailwind classes in `src/components/**`
  and the CSS variables in `src/app/globals.css` — the structure and props stay
  the same, so it's restyling, not rebuilding.
- The design tokens live in `src/app/globals.css` (`:root` light + the
  `prefers-color-scheme: dark` block). The `ice-*` palette is in the Tailwind
  `@theme`. Point me at the returned palette and I'll wire it in.
- The coach-intro card is already on the "Book a time" screen, fed by the
  coach's bio — send me the intro copy and I'll drop it in.
