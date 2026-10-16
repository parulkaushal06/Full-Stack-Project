-- ============================================================================
-- 002_progress_tracking.sql  (Person 2: Progress Tracking & Dashboard)
--
-- * user_progress statuses become: not_started | in_progress | completed
--   (old values are migrated: done -> completed, learning -> in_progress,
--    skipped -> not_started)
-- * adds started_at / completed_at / last_accessed_at (powers "Continue Learning")
-- * triggers keep those timestamps correct automatically
-- * views for the dashboard: v_roadmap_progress, v_continue_learning
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt.
-- ============================================================================

CREATE TABLE user_progress_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roadmap_slug      TEXT    NOT NULL REFERENCES roadmaps(slug) ON DELETE CASCADE,
  topic_key         TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started', 'in_progress', 'completed')),
  started_at        TEXT,                         -- first time it became in_progress/completed
  completed_at      TEXT,                         -- set while status = completed, else NULL
  last_accessed_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (roadmap_slug, topic_key)
    REFERENCES roadmap_topics(roadmap_slug, topic_key) ON DELETE CASCADE
);

INSERT INTO user_progress_new
  (id, user_id, roadmap_slug, topic_key, status,
   started_at, completed_at, last_accessed_at, updated_at)
SELECT p.id, p.user_id, p.roadmap_slug, p.topic_key,
       CASE p.status
         WHEN 'done'     THEN 'completed'
         WHEN 'learning' THEN 'in_progress'
         ELSE 'not_started'
       END,
       CASE WHEN p.status IN ('done', 'learning') THEN p.updated_at END,
       CASE WHEN p.status = 'done' THEN p.updated_at END,
       p.updated_at,
       p.updated_at
  FROM user_progress p
 WHERE EXISTS (SELECT 1 FROM roadmap_topics t
                WHERE t.roadmap_slug = p.roadmap_slug AND t.topic_key = p.topic_key);

DROP TABLE user_progress;
ALTER TABLE user_progress_new RENAME TO user_progress;

CREATE UNIQUE INDEX idx_progress_unique
  ON user_progress(user_id, roadmap_slug, topic_key);
CREATE INDEX idx_progress_roadmap ON user_progress(roadmap_slug);
CREATE INDEX idx_progress_user_status ON user_progress(user_id, status);
CREATE INDEX idx_progress_user_recent ON user_progress(user_id, last_accessed_at DESC);

-- ----------------------------------------------------------------- triggers --
-- Insert: stamp started_at / completed_at according to the initial status.
CREATE TRIGGER trg_progress_ai AFTER INSERT ON user_progress
BEGIN
  UPDATE user_progress
     SET started_at   = CASE WHEN NEW.status IN ('in_progress', 'completed')
                             THEN COALESCE(NEW.started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END,
         completed_at = CASE WHEN NEW.status = 'completed'
                             THEN COALESCE(NEW.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END
   WHERE id = NEW.id;
END;

-- Update of status (the PUT upsert always lists status in its SET clause, so this
-- also runs when the same status is saved again = "opened topic" => bumps
-- last_accessed_at, which is what "Continue Learning" sorts by).
CREATE TRIGGER trg_progress_au AFTER UPDATE OF status ON user_progress
BEGIN
  UPDATE user_progress
     SET started_at       = CASE WHEN NEW.status IN ('in_progress', 'completed')
                                 THEN COALESCE(NEW.started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END,
         completed_at     = CASE WHEN NEW.status = 'completed'
                                 THEN COALESCE(NEW.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END,
         last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = NEW.id;
END;

-- ------------------------------------------------------------------- views --
-- Per user + roadmap completion summary (only roadmaps the user has touched).
--   pending_topics = everything that is not completed and not in progress
--                    (includes topics the user never opened)
CREATE VIEW v_roadmap_progress AS
SELECT s.*,
       s.total_topics - s.completed_topics - s.in_progress_topics AS pending_topics,
       CASE WHEN s.total_topics = 0 THEN 0
            ELSE CAST(ROUND(100.0 * s.completed_topics / s.total_topics) AS INTEGER)
       END AS percent
  FROM (
    SELECT p.user_id,
           p.roadmap_slug,
           r.title AS roadmap_title,
           (SELECT COUNT(*) FROM roadmap_topics t WHERE t.roadmap_slug = p.roadmap_slug) AS total_topics,
           SUM(p.status = 'completed')   AS completed_topics,
           SUM(p.status = 'in_progress') AS in_progress_topics,
           MAX(p.last_accessed_at)       AS last_accessed_at
      FROM user_progress p
      JOIN roadmaps r ON r.slug = p.roadmap_slug
     GROUP BY p.user_id, p.roadmap_slug
  ) s;

-- Topics the user is currently learning, with titles. Order in the API query:
--   SELECT * FROM v_continue_learning WHERE user_id = ? ORDER BY last_accessed_at DESC LIMIT 5
CREATE VIEW v_continue_learning AS
SELECT p.user_id,
       p.roadmap_slug,
       r.title  AS roadmap_title,
       p.topic_key,
       t.label  AS topic_label,
       p.started_at,
       p.last_accessed_at
  FROM user_progress p
  JOIN roadmap_topics t ON t.roadmap_slug = p.roadmap_slug AND t.topic_key = p.topic_key
  JOIN roadmaps r       ON r.slug = p.roadmap_slug
 WHERE p.status = 'in_progress';