-- A migration that applies cleanly. Numbered in the 9000s so it can never
-- collide with a real migration in backend/_shared/migrations/.
CREATE TABLE IF NOT EXISTS migration_probe_good (
  id INT PRIMARY KEY
);
