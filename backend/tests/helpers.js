import request from 'supertest';
import { migrate } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { seedAdmin } from '../src/db/seed.js';
import { cache } from '../src/lib/cache.js';
import { createApp } from '../src/app.js';

/** Migrates the in-memory DB, seeds fixtures + admin, returns an express app. */
export function setupTestApp() {
  migrate();
  cache.clear();
  seedFixtures();
  seedAdmin();
  return createApp();
}

function insertRoadmap(r) {
  query.run(
    `INSERT INTO roadmaps (slug, title, brief_title, description, category, difficulty, tag,
                           order_index, is_forkable, has_topics, article_md, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    r.slug,
    r.title,
    r.title,
    r.description,
    r.category,
    r.difficulty,
    r.tag,
    r.order_index,
    r.articleMd || null,
    r.image_url || null,
  );
}

export function seedFixtures() {
  if (query.get('SELECT COUNT(*) AS c FROM roadmaps').c > 0) return;

  [
    {
      slug: 'frontend',
      title: 'Frontend Developer',
      description: 'Step by step guide to become a frontend developer',
      category: 'role',
      difficulty: 'beginner',
      tag: 'web',
      order_index: 1,
      articleMd: '# Frontend Development\n\nFrontend is the craft of building web UIs.',
    },
    {
      slug: 'react',
      title: 'React Developer',
      description: 'Step by step guide to become a React developer',
      category: 'framework',
      difficulty: 'intermediate',
      tag: 'web',
      order_index: 2,
    },
    {
      slug: 'python',
      title: 'Python Developer',
      description: 'Step by step guide to become a Python developer',
      category: 'language',
      difficulty: 'beginner',
      tag: 'general',
      order_index: 3,
    },
  ].forEach(insertRoadmap);

  query.run(
    `INSERT INTO roadmap_topics (roadmap_slug, topic_key, label, order_index, content_md)
     VALUES ('frontend', '100-internet', 'Internet', 1, '# Internet\n\nHow the internet works.')`,
  );
  query.run(
    `INSERT INTO roadmap_topics (roadmap_slug, topic_key, label, order_index, content_md)
     VALUES ('frontend', '101-html', 'HTML', 2, '# HTML\n\nThe backbone of the web.')`,
  );
  query.run(
    `INSERT INTO topic_articles (roadmap_slug, topic_key, article_key, title, content_md, order_index)
     VALUES ('frontend', '100-internet', '100-how-does-the-internet-work',
             'How does the Internet work?',
             '# Internet\n\n[Packets, routers and protocols.](https://example.com)', 1)`,
  );
}

/** Fresh, cookie preserving supertest agent. */
export function client(app) {
  return request.agent(app);
}

export const adminCreds = { identifier: 'admin', password: 'Admin@12345' };
