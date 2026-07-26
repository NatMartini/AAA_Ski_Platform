-- Re-map stored manoeuvre keys onto the CSIA-aligned catalogue.
--
-- Four keys in the old list bundled together things the CSIA teaches
-- separately, so they were split (see src/lib/skills.ts):
--
--   park_intro        -> jibbing
--   box_rail          -> box + rail          (two features, two sessions)
--   spins             -> spin_180 + spin_360 (two manoeuvres)
--   dynamic_parallel  -> advanced_parallel   (the CSIA's own name for it)
--
-- Coach profiles are expanded: a coach who ticked "boxes and rails" plainly
-- teaches both. Bookings are expanded too — a student who asked to work on
-- spins wants whichever of the two they are ready for, and the coach reads
-- this as a note, not as a contract.
--
-- Idempotent by construction: the replacements are not themselves old keys,
-- so re-running maps nothing a second time.

CREATE OR REPLACE FUNCTION pg_temp.remap_skills(keys TEXT[])
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), ARRAY[]::TEXT[])
  FROM (
    SELECT unnest(
      CASE old
        WHEN 'park_intro'       THEN ARRAY['jibbing']
        WHEN 'box_rail'         THEN ARRAY['box', 'rail']
        WHEN 'spins'            THEN ARRAY['spin_180', 'spin_360']
        WHEN 'dynamic_parallel' THEN ARRAY['advanced_parallel']
        ELSE ARRAY[old]
      END
    ) AS k
    FROM unnest(keys) AS old
  ) expanded;
$$;

UPDATE "CoachProfile"
SET "teachableSkills" = pg_temp.remap_skills("teachableSkills")
WHERE "teachableSkills" && ARRAY['park_intro', 'box_rail', 'spins', 'dynamic_parallel'];

UPDATE "Booking"
SET "requestedSkills" = pg_temp.remap_skills("requestedSkills")
WHERE "requestedSkills" && ARRAY['park_intro', 'box_rail', 'spins', 'dynamic_parallel'];
