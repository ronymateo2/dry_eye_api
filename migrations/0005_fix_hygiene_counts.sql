-- Recalculate completed_count and total_completed_days from dy_lid_hygiene (source of truth)
-- Each row in dy_lid_hygiene = one real session (no duplicates due to onConflictDoUpdate by id)

UPDATE dy_hygiene_daily
SET completed_count = (
  SELECT COUNT(*)
  FROM dy_lid_hygiene h
  WHERE h.user_id = dy_hygiene_daily.user_id
    AND h.day_key = dy_hygiene_daily.day_key
    AND h.status = 'completed'
);

UPDATE dy_hygiene_stats
SET total_completed_days = (
  SELECT COUNT(DISTINCT day_key)
  FROM dy_lid_hygiene h
  WHERE h.user_id = dy_hygiene_stats.user_id
    AND h.status = 'completed'
);
