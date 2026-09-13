-- Drop `pools.go_deadline` (R7-b, founder instruction 2026-09-12).
--
-- 0012 added it for the D-E4 go-timer: the 52nd entry was to shorten a
-- pool's effective deadline, and this column recorded that the timer had
-- started. The founder's ruling of 2026-09-07 chose option A — one clock,
-- set at open and never rewritten — and the go-timer was removed from the
-- program before any deployment emitted a `GoTimerStarted`.
--
-- So the column has been dead since the day it landed: no projection op
-- writes it, no read serves it, and no row anywhere holds a non-NULL value.
-- It is dropped now rather than left because a schema that describes a
-- mechanism the program does not have is how a later reader concludes the
-- deadline can move.
--
-- Forward-only, like every migration here (0012 is not edited). IF EXISTS so
-- a database provisioned after this point, or one where 0012 never ran, is
-- unaffected.

ALTER TABLE pools DROP COLUMN IF EXISTS go_deadline;
