-- ============================================================================
-- 005_quizzes.sql  (Person 3: Topic-wise MCQ quizzes, scores, history)
--
--   quizzes 1--* quiz_questions 1--* quiz_options
--   users   1--* quiz_attempts  1--* quiz_attempt_answers
--
-- Scoring is automatic and lives in the database:
--   1. INSERT INTO quiz_attempts (user_id, quiz_id)       -> total_questions,
--      pass_percent and the quiz title/roadmap/topic are snapshotted by a trigger
--   2. INSERT INTO quiz_attempt_answers (attempt_id, question_id, option_id)
--      -> is_correct is computed and score / percent / passed are updated
--         (option_id NULL = question skipped = wrong)
--   3. UPDATE quiz_attempts SET submitted_at = <now> WHERE id = ?
--      -> locks the attempt and stores duration_seconds
--
-- History survives quiz edits/deletes: attempts keep a snapshot of the quiz
-- title/topic and quiz_id becomes NULL if the quiz is removed.
-- ============================================================================

CREATE TABLE quizzes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_slug   TEXT    NOT NULL REFERENCES roadmaps(slug) ON DELETE CASCADE,
  topic_key      TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  description    TEXT,
  pass_percent   INTEGER NOT NULL DEFAULT 60 CHECK (pass_percent BETWEEN 0 AND 100),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (roadmap_slug, topic_key, title),
  FOREIGN KEY (roadmap_slug, topic_key)
    REFERENCES roadmap_topics(roadmap_slug, topic_key) ON DELETE CASCADE
);
CREATE INDEX idx_quizzes_topic ON quizzes(roadmap_slug, topic_key);

CREATE TABLE quiz_questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id       INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text TEXT    NOT NULL CHECK (length(trim(question_text)) > 0),
  explanation   TEXT,                              -- shown after answering
  order_index   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_questions_quiz ON quiz_questions(quiz_id, order_index);

CREATE TABLE quiz_options (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_text   TEXT    NOT NULL CHECK (length(trim(option_text)) > 0),
  is_correct    INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  order_index   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_options_question ON quiz_options(question_id, order_index);
-- single-answer MCQ: at most one correct option per question
CREATE UNIQUE INDEX idx_options_one_correct ON quiz_options(question_id) WHERE is_correct = 1;

CREATE TABLE quiz_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id          INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
  -- snapshot columns (filled by trigger) so history stays readable forever
  quiz_title       TEXT,
  roadmap_slug     TEXT,
  topic_key        TEXT,
  pass_percent     INTEGER NOT NULL DEFAULT 60,
  -- result (maintained by triggers)
  total_questions  INTEGER NOT NULL DEFAULT 0,
  score            INTEGER NOT NULL DEFAULT 0,
  percent          INTEGER NOT NULL DEFAULT 0,
  passed           INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  started_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_at     TEXT,                           -- NULL = still in progress
  duration_seconds INTEGER
);
CREATE INDEX idx_attempts_user      ON quiz_attempts(user_id, submitted_at DESC);
CREATE INDEX idx_attempts_user_quiz ON quiz_attempts(user_id, quiz_id);

CREATE TABLE quiz_attempt_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id   INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id  INTEGER REFERENCES quiz_questions(id) ON DELETE SET NULL,
  option_id    INTEGER REFERENCES quiz_options(id) ON DELETE SET NULL,  -- NULL = skipped
  is_correct   INTEGER CHECK (is_correct IN (0, 1)),                    -- computed by trigger
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX idx_attempt_answers_attempt ON quiz_attempt_answers(attempt_id);

-- ----------------------------------------------------------------- triggers --
-- New attempt: needs a quiz; snapshot quiz info + number of questions.
CREATE TRIGGER trg_attempts_bi BEFORE INSERT ON quiz_attempts
BEGIN
  SELECT RAISE(ABORT, 'quiz_id is required and the quiz must exist and be active')
   WHERE NEW.quiz_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM quizzes q WHERE q.id = NEW.quiz_id AND q.is_active = 1);
END;

CREATE TRIGGER trg_attempts_ai AFTER INSERT ON quiz_attempts
BEGIN
  UPDATE quiz_attempts
     SET quiz_title      = (SELECT q.title        FROM quizzes q WHERE q.id = NEW.quiz_id),
         roadmap_slug    = (SELECT q.roadmap_slug FROM quizzes q WHERE q.id = NEW.quiz_id),
         topic_key       = (SELECT q.topic_key    FROM quizzes q WHERE q.id = NEW.quiz_id),
         pass_percent    = (SELECT q.pass_percent FROM quizzes q WHERE q.id = NEW.quiz_id),
         total_questions = (SELECT COUNT(*) FROM quiz_questions z WHERE z.quiz_id = NEW.quiz_id)
   WHERE id = NEW.id;
END;

-- Submitting: store how long it took.
CREATE TRIGGER trg_attempts_submit AFTER UPDATE OF submitted_at ON quiz_attempts
WHEN OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL
BEGIN
  UPDATE quiz_attempts
     SET duration_seconds = MAX(0, CAST(ROUND((julianday(NEW.submitted_at) - julianday(NEW.started_at)) * 86400) AS INTEGER))
   WHERE id = NEW.id;
END;

-- Answer validation.
CREATE TRIGGER trg_answers_bi BEFORE INSERT ON quiz_attempt_answers
BEGIN
  SELECT RAISE(ABORT, 'is_correct is computed automatically')
   WHERE NEW.is_correct IS NOT NULL;
  SELECT RAISE(ABORT, 'attempt already submitted')
   WHERE EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.id = NEW.attempt_id AND a.submitted_at IS NOT NULL);
  SELECT RAISE(ABORT, 'question does not belong to the quiz of this attempt')
   WHERE NEW.question_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM quiz_attempts a
                       JOIN quiz_questions q ON q.quiz_id = a.quiz_id
                      WHERE a.id = NEW.attempt_id AND q.id = NEW.question_id);
  SELECT RAISE(ABORT, 'option does not belong to the question')
   WHERE NEW.option_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM quiz_options o
                      WHERE o.id = NEW.option_id AND o.question_id = NEW.question_id);
END;

-- Automatic scoring.
CREATE TRIGGER trg_answers_ai AFTER INSERT ON quiz_attempt_answers
BEGIN
  UPDATE quiz_attempt_answers
     SET is_correct = COALESCE((SELECT o.is_correct FROM quiz_options o WHERE o.id = NEW.option_id), 0)
   WHERE id = NEW.id;

  UPDATE quiz_attempts
     SET score   = (SELECT COALESCE(SUM(is_correct), 0) FROM quiz_attempt_answers WHERE attempt_id = NEW.attempt_id),
         percent = CASE WHEN total_questions = 0 THEN 0
                        ELSE CAST(ROUND(100.0 *
                               (SELECT COALESCE(SUM(is_correct), 0) FROM quiz_attempt_answers WHERE attempt_id = NEW.attempt_id)
                               / total_questions) AS INTEGER)
                   END
   WHERE id = NEW.attempt_id;

  UPDATE quiz_attempts
     SET passed = CASE WHEN percent >= pass_percent THEN 1 ELSE 0 END
   WHERE id = NEW.attempt_id;
END;

-- Stored results can never be rewritten afterwards (history integrity).
CREATE TRIGGER trg_answers_immutable BEFORE UPDATE OF attempt_id, is_correct ON quiz_attempt_answers
WHEN OLD.is_correct IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'quiz answers are immutable');
END;

-- ------------------------------------------------------------------- views --
-- Quiz history (only finished attempts):
--   SELECT * FROM v_quiz_history WHERE user_id = ? ORDER BY submitted_at DESC
CREATE VIEW v_quiz_history AS
SELECT a.id AS attempt_id, a.user_id, a.quiz_id, a.quiz_title, a.roadmap_slug, a.topic_key,
       a.score, a.total_questions, a.percent, a.pass_percent, a.passed,
       a.started_at, a.submitted_at, a.duration_seconds
  FROM quiz_attempts a
 WHERE a.submitted_at IS NOT NULL;

-- Per user + quiz summary: attempts, best / average score, last attempt.
CREATE VIEW v_quiz_stats AS
SELECT a.user_id, a.quiz_id,
       MAX(a.quiz_title)                      AS quiz_title,
       COUNT(*)                               AS attempts,
       MAX(a.percent)                         AS best_percent,
       CAST(ROUND(AVG(a.percent)) AS INTEGER) AS avg_percent,
       MAX(a.passed)                          AS ever_passed,
       MAX(a.submitted_at)                    AS last_attempt_at
  FROM quiz_attempts a
 WHERE a.submitted_at IS NOT NULL
 GROUP BY a.user_id, a.quiz_id;