import { query } from './index.js';

/**
 * Extracts learning resources (markdown links) from the topic overview
 * (roadmap_topics.content_md) and from every sub-topic article
 * (topic_articles.content_md) and stores them in topic_resources.
 *
 *   YouTube links (youtube.com / youtu.be) -> resource_type = 'video'
 *   everything else                         -> resource_type = 'article'
 *
 * Idempotent: the unique index (roadmap, topic, article, url) + INSERT OR IGNORE
 * means it can be run any number of times.
 */

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const VIDEO_HOST_RE = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function classifyUrl(url) {
  try {
    return VIDEO_HOST_RE.test(new URL(url).hostname) ? 'video' : 'article';
  } catch {
    return null; // not a valid URL
  }
}

/** Returns [{ title, url, type }] for every external link in a markdown string. */
export function extractLinks(markdown) {
  if (!markdown) return [];
  const out = [];
  for (const match of markdown.matchAll(LINK_RE)) {
    const url = match[2].replace(/[.,;]+$/, '');
    const type = classifyUrl(url);
    if (!type) continue;
    const title = match[1].replace(/^@\w+@/, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!title) continue;
    out.push({ title, url, type });
  }
  return out;
}

export function seedResources() {
  let inserted = 0;

  query.tx(() => {
    const insert = (slug, topicKey, articleKey, md) => {
      extractLinks(md).forEach((link, idx) => {
        const res = query.run(
          `INSERT OR IGNORE INTO topic_resources
             (roadmap_slug, topic_key, article_key, resource_type, title, url, order_index)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          slug,
          topicKey,
          articleKey,
          link.type,
          link.title,
          link.url,
          idx + 1,
        );
        inserted += res.changes;
      });
    };

    for (const t of query.all(
      'SELECT roadmap_slug, topic_key, content_md FROM roadmap_topics WHERE content_md IS NOT NULL',
    )) {
      insert(t.roadmap_slug, t.topic_key, '', t.content_md);
    }
    for (const a of query.all(
      'SELECT roadmap_slug, topic_key, article_key, content_md FROM topic_articles',
    )) {
      insert(a.roadmap_slug, a.topic_key, a.article_key, a.content_md);
    }
  });

  return { resources: inserted };
}