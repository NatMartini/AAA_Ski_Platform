-- Re-key every participant to the name-only identity hash.
--
-- `identityKey` used to be sha256(name + birthDate); dropping the date of
-- birth changed it to sha256(name) alone (see src/lib/participants.ts). Rows
-- written before that change still hold the old hash, so the uniqueness check
-- that stops "add Xiao Ming a second time and use the waiver-free copy" misses
-- them entirely and silently creates a duplicate. The earlier migration that
-- dropped the column did not rewrite the keys; this one does.
--
-- The hash must match identityKey() exactly: lowercase, strip
-- [. , ' ’ _ - whitespace], sha256, first 32 hex characters.
--
-- Done in two passes because `Participant_accountId_identityKey_key` is a
-- plain (non-deferrable) unique index: it is checked row by row, so a single
-- UPDATE fails the moment a row takes a key another row has not yet given up.
-- Parking everything on an id-derived placeholder first makes the second pass
-- collision-free regardless of the order rows happen to be visited in.

-- Pass 1: unique by construction, since ids are unique.
UPDATE "Participant" SET "identityKey" = 'migrating-' || id;

-- Pass 2: the real keys.
--
-- Collisions are possible here: an account that legitimately held two people
-- of the same name, previously told apart by their birth dates, now collapses
-- to one key. Rather than merging (which would move one person's waiver onto
-- another) or failing the migration, the best-evidenced row keeps the clean
-- key and the others get a suffixed one. A suffixed key contains "-d" and so
-- can never collide with a real hash; the effect is that the next booking for
-- that name finds the primary record.
WITH normalized AS (
  SELECT
    p.id,
    p."accountId",
    p."createdAt",
    encode(
      sha256(
        convert_to(
          regexp_replace(lower(p."fullName"), '[.,''’_[:space:]-]', '', 'g'),
          'UTF8'
        )
      ),
      'hex'
    ) AS full_hash,
    (SELECT count(*) FROM "Waiver" w WHERE w."participantId" = p.id) AS waivers
  FROM "Participant" p
),
ranked AS (
  SELECT
    n.*,
    row_number() OVER (
      PARTITION BY n."accountId", n.full_hash
      -- Whoever actually signed something wins; then the oldest record.
      ORDER BY n.waivers DESC, n."createdAt" ASC, n.id ASC
    ) AS rn
  FROM normalized n
)
UPDATE "Participant" p
SET "identityKey" = CASE
  WHEN r.rn = 1 THEN left(r.full_hash, 32)
  ELSE left(r.full_hash, 28) || '-d' || lpad(r.rn::text, 2, '0')
END
FROM ranked r
WHERE p.id = r.id;
