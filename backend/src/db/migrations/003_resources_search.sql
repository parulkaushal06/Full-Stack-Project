-- ============================================================================
-- 003_resources_search.sql  (Person 1: Roadmaps & Learning Resources)
--
-- * topic_resources: clickable YouTube tutorials + article links per topic
--   (and per sub-topic: sub-topics are the rows of topic_articles, referenced
--   here through article_key; '' means "belongs to the topic itself")
-- * v_search_index: one searchable list of roadmaps + topics + sub-topics
--   for the roadmap search/filter feature
-- ============================================================================

CREATE TABLE topic_resources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_slug   TEXT    NOT NULL REFERENCES roadmaps(slug) ON DELETE CASCADE,
  topic_key      TEXT    NOT NULL,
  article_key    TEXT    NOT NULL DEFAULT '',   -- sub-topic (topic_articles.article_key) or ''
  resource_type  TEXT    NOT NULL CHECK (resource_type IN ('video', 'article')),
  title          TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (roadmap_slug, topic_key)
    REFERENCES roadmap_topics(roadmap_slug, topic_key) ON DELETE CASCADE
);
-- same link is stored once per (topic, sub-topic)
CREATE UNIQUE INDEX idx_resources_unique
  ON topic_resources(roadmap_slug, topic_key, article_key, url);
CREATE INDEX idx_resources_topic
  ON topic_resources(roadmap_slug, topic_key, resource_type, order_index);

-- Helps title/label lookups used by search.
CREATE INDEX idx_topics_label ON roadmap_topics(label COLLATE NOCASE);
CREATE INDEX idx_articles_title ON topic_articles(title COLLATE NOCASE);

-- Search index. Use it like:
--   SELECT * FROM v_search_index
--    WHERE title LIKE '%' || ? || '%' ESCAPE '\' ORDER BY kind, title LIMIT 20
-- kind = 'roadmap' | 'topic' | 'subtopic'
CREATE VIEW v_search_index AS
SELECT 'roadmap'  AS kind,
       r.slug     AS roadmap_slug,
       NULL       AS topic_key,
       NULL       AS article_key,
       r.title    AS title,
       r.description AS snippet
  FROM roadmaps r
UNION ALL
SELECT 'topic', t.roadmap_slug, t.topic_key, NULL, t.label, NULL
  FROM roadmap_topics t
UNION ALL
SELECT 'subtopic', a.roadmap_slug, a.topic_key, a.article_key, a.title, NULL
  FROM topic_articles a;