-- ============================================================================
-- 004_tasks.sql  (Person 3: Learning tasks & deadlines)
--
-- * tasks: create / edit / complete, optional link to a roadmap + topic
-- * triggers keep updated_at / completed_at correct
-- * v_tasks: computed pending / in_progress / completed / overdue state
--
-- due_date is ISO-8601 in UTC: either a date ('2026-10-20') or a full
-- timestamp ('2026-10-20T14:30:00.000Z'). A date-only value is due at the END
-- of that day.
-- ============================================================================

CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL
                        CHECK (length(trim(title)) > 0 AND length(title) <= 200),
  description   TEXT,
  roadmap_slug  TEXT    REFERENCES roadmaps(slug) ON DELETE SET NULL,
  topic_key     TEXT,                              -- only valid together with roadmap_slug
  priority      TEXT    NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date      TEXT    CHECK (due_date IS NULL OR datetime(due_date) IS NOT NULL),
  completed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_due    ON tasks(user_id, due_date);
CREATE INDEX idx_tasks_topic       ON tasks(roadmap_slug, topic_key);

-- ----------------------------------------------------------------- triggers --
-- A topic must exist inside the given roadmap.
CREATE TRIGGER trg_tasks_topic_bi BEFORE INSERT ON tasks
WHEN NEW.topic_key IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'topic_key requires a valid roadmap_slug + topic_key pair')
   WHERE NEW.roadmap_slug IS NULL
      OR NOT EXISTS (SELECT 1 FROM roadmap_topics t
                      WHERE t.roadmap_slug = NEW.roadmap_slug AND t.topic_key = NEW.topic_key);
END;

CREATE TRIGGER trg_tasks_topic_bu BEFORE UPDATE OF roadmap_slug, topic_key ON tasks
WHEN NEW.topic_key IS NOT NULL AND NEW.roadmap_slug IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'topic_key requires a valid roadmap_slug + topic_key pair')
   WHERE NOT EXISTS (SELECT 1 FROM roadmap_topics t
                      WHERE t.roadmap_slug = NEW.roadmap_slug AND t.topic_key = NEW.topic_key);
END;

-- When a roadmap disappears (FK SET NULL on roadmap_slug) drop the dangling topic_key too.
CREATE TRIGGER trg_tasks_orphan_topic AFTER UPDATE OF roadmap_slug ON tasks
WHEN NEW.roadmap_slug IS NULL AND NEW.topic_key IS NOT NULL
BEGIN
  UPDATE tasks SET topic_key = NULL WHERE id = NEW.id;
END;

-- completed_at follows status.
CREATE TRIGGER trg_tasks_ai AFTER INSERT ON tasks
WHEN NEW.status = 'completed' AND NEW.completed_at IS NULL
BEGIN
  UPDATE tasks SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- updated_at + completed_at on every update (a trigger never re-fires itself).
CREATE TRIGGER trg_tasks_au AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks
     SET updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         completed_at = CASE WHEN NEW.status = 'completed'
                             THEN COALESCE(NEW.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                        END
   WHERE id = NEW.id;
END;

-- ------------------------------------------------------------------- views --
-- effective_status: completed | overdue | in_progress | pending
-- Typical API queries:
--   SELECT * FROM v_tasks WHERE user_id = ? ORDER BY is_overdue DESC, due_at IS NULL, due_at
--   SELECT * FROM v_tasks WHERE user_id = ? AND effective_status = 'overdue'
CREATE VIEW v_tasks AS
SELECT x.*,
       CASE
         WHEN x.status = 'completed' THEN 'completed'
         WHEN x.is_overdue = 1       THEN 'overdue'
         ELSE x.status                       -- pending | in_progress
       END AS effective_status
  FROM (
    SELECT t.*,
           r.title AS roadmap_title,
           tp.label AS topic_label,
           CASE WHEN t.due_date IS NULL THEN NULL
                WHEN length(t.due_date) = 10 THEN datetime(t.due_date, '+1 day', '-1 second')
                ELSE datetime(t.due_date)
           END AS due_at,                     -- normalised 'YYYY-MM-DD HH:MM:SS' (UTC)
           CASE WHEN t.status <> 'completed'
                 AND t.due_date IS NOT NULL
                 AND (CASE WHEN length(t.due_date) = 10
                           THEN datetime(t.due_date, '+1 day', '-1 second')
                           ELSE datetime(t.due_date) END) < datetime('now')
                THEN 1 ELSE 0
           END AS is_overdue
      FROM tasks t
      LEFT JOIN roadmaps r         ON r.slug = t.roadmap_slug
      LEFT JOIN roadmap_topics tp  ON tp.roadmap_slug = t.roadmap_slug AND tp.topic_key = t.topic_key
  ) x;