import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { query, getDb } from './index.js';
import { migrate } from './migrate.js';
import { readRoadmapMeta } from '../lib/frontmatter.js';
import { hashPassword } from '../lib/password.js';

/**
 * Static seed metadata (category / difficulty / tag facets used for
 * filtering and sorting on the frontend). See docs/DATABASE_DESIGN.md.
 */
export const SLUG_META = {
  'frontend': ['role', 'beginner', 'web'],
  'backend': ['role', 'beginner', 'web'],
  'full-stack': ['role', 'beginner', 'web'],
  'devops': ['role', 'intermediate', 'infrastructure'],
  'game-developer': ['role', 'intermediate', 'games'],
  'server-side-game-developer': ['role', 'advanced', 'games'],
  'data-analyst': ['role', 'beginner', 'data'],
  'ai-data-scientist': ['role', 'advanced', 'data'],
  'cyber-security': ['role', 'intermediate', 'security'],
  'qa': ['role', 'beginner', 'quality'],
  'ux-design': ['role', 'beginner', 'design'],
  'technical-writer': ['role', 'beginner', 'docs'],
  'software-architect': ['role', 'advanced', 'architecture'],
  'mlops': ['role', 'advanced', 'data'],
  'prompt-engineering': ['concept', 'beginner', 'ai'],
  'computer-science': ['concept', 'intermediate', 'fundamentals'],
  'system-design': ['concept', 'advanced', 'architecture'],
  'software-design-architecture': ['concept', 'advanced', 'architecture'],
  'datastructures-and-algorithms': ['concept', 'intermediate', 'fundamentals'],
  'code-review': ['concept', 'intermediate', 'quality'],
  'design-system': ['concept', 'intermediate', 'design'],
  'blockchain': ['concept', 'intermediate', 'web3'],
  'javascript': ['language', 'beginner', 'web'],
  'typescript': ['language', 'beginner', 'web'],
  'python': ['language', 'beginner', 'general'],
  'java': ['language', 'intermediate', 'enterprise'],
  'golang': ['language', 'intermediate', 'systems'],
  'rust': ['language', 'advanced', 'systems'],
  'cpp': ['language', 'advanced', 'systems'],
  'sql': ['language', 'beginner', 'data'],
  'graphql': ['language', 'intermediate', 'api'],
  'react': ['framework', 'intermediate', 'web'],
  'vue': ['framework', 'beginner', 'web'],
  'angular': ['framework', 'intermediate', 'web'],
  'flutter': ['framework', 'intermediate', 'mobile'],
  'react-native': ['framework', 'intermediate', 'mobile'],
  'android': ['framework', 'intermediate', 'mobile'],
  'spring-boot': ['framework', 'intermediate', 'enterprise'],
  'aspnet-core': ['framework', 'intermediate', 'enterprise'],
  'nodejs': ['framework', 'beginner', 'web'],
  'aws': ['tool', 'intermediate', 'cloud'],
  'docker': ['tool', 'beginner', 'infrastructure'],
  'kubernetes': ['tool', 'advanced', 'infrastructure'],
  'mongodb': ['database', 'beginner', 'data'],
  'postgresql-dba': ['database', 'advanced', 'data'],
};

function firstHeading(markdown) {
  if (!markdown) return null;
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

function titleFromKey(key) {
  // "100-internet" -> "Internet"
  const name = key.replace(/^\d+-/, '').replace(/-/g, ' ');
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function readMarkdownIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Seeds roadmaps + topics + articles from src/data/roadmaps. */
export function seedRoadmaps({ force = false } = {}) {
  const dataDir = config.roadmapsDataDir;
  if (!fs.existsSync(dataDir)) {
    console.warn(`No roadmap data directory at ${dataDir}`);
    return { roadmaps: 0, topics: 0, articles: 0 };
  }

  const existing = query.get('SELECT COUNT(*) AS c FROM roadmaps');
  if (existing.c > 0 && !force) {
    return { roadmaps: 0, topics: 0, articles: 0, skipped: true };
  }
  if (force && existing.c > 0) {
    query.run('DELETE FROM roadmaps'); // cascades to topics/articles
  }

  const slugs = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let topicsCount = 0;
  let articlesCount = 0;
  let orderFallback = 0;

  const stats = query.tx(() => {
    let roadmaps = 0;
    for (const slug of slugs) {
      const dir = path.join(dataDir, slug);
      const metaFile = path.join(dir, `${slug}.md`);
      const raw = readMarkdownIfExists(metaFile);
      const meta = raw ? readRoadmapMeta(raw) : {};

      const [category, difficulty, tag] = SLUG_META[slug] || ['other', 'beginner', 'general'];
      const title = meta.title || meta.briefTitle || titleFromKey(slug);
      const description = meta.briefDescription || meta.description || '';
      const orderIndex = meta.order != null && meta.order > 0 ? meta.order : (orderFallback += 100);

      const imageUrl = fs.existsSync(path.join(config.publicDir, 'roadmaps', `${slug}.png`))
        ? `/roadmaps/${slug}.png`
        : null;

      query.run(
        `INSERT INTO roadmaps
           (slug, title, brief_title, description, category, difficulty, tag,
            order_index, is_forkable, has_topics, article_md, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        slug,
        title,
        meta.briefTitle || title,
        description,
        category,
        difficulty,
        tag,
        orderIndex,
        meta.isForkable ? 1 : 0,
        meta.hasTopics ? 1 : 0,
        meta.articleMd || null,
        imageUrl,
      );
      roadmaps += 1;

      // ---- topics + articles -------------------------------------------------
      const contentDir = path.join(dir, 'content');
      if (!fs.existsSync(contentDir)) continue;

      const entries = fs.readdirSync(contentDir, { withFileTypes: true });
      const topicDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => {
          const na = parseInt(a, 10);
          const nb = parseInt(b, 10);
          if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        });

      topicDirs.forEach((topicKey, idx) => {
        const topicPath = path.join(contentDir, topicKey);
        const indexMd = readMarkdownIfExists(path.join(topicPath, 'index.md'));
        const label = firstHeading(indexMd) || titleFromKey(topicKey);

        query.run(
          `INSERT INTO roadmap_topics (roadmap_slug, topic_key, label, order_index, content_md)
           VALUES (?, ?, ?, ?, ?)`,
          slug,
          topicKey,
          label,
          idx + 1,
          indexMd || null,
        );
        topicsCount += 1;

        const articleFiles = fs
          .readdirSync(topicPath)
          .filter((f) => f.endsWith('.md') && f !== 'index.md')
          .sort((a, b) => {
            const na = parseInt(a, 10);
            const nb = parseInt(b, 10);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return a.localeCompare(b);
          });

        articleFiles.forEach((file, aidx) => {
          const content = readMarkdownIfExists(path.join(topicPath, file));
          if (!content) return;
          const articleKey = file.replace(/\.md$/, '');
          query.run(
            `INSERT INTO topic_articles
               (roadmap_slug, topic_key, article_key, title, content_md, order_index)
             VALUES (?, ?, ?, ?, ?, ?)`,
            slug,
            topicKey,
            articleKey,
            firstHeading(content) || titleFromKey(articleKey),
            content,
            aidx + 1,
          );
          articlesCount += 1;
        });
      });
    }
    return { roadmaps, topics: topicsCount, articles: articlesCount };
  });

  return stats;
}

/** Creates the bootstrap admin when the users table is empty. */
export function seedAdmin() {
  const { c } = query.get('SELECT COUNT(*) AS c FROM users');
  if (c > 0) return null;

  const res = query.run(
    `INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'admin')`,
    config.adminEmail,
    config.adminUsername,
    hashPassword(config.adminPassword),
  );
  return res.lastInsertRowid;
}

export function runSeed({ force = false } = {}) {
  migrate();
  getDb();
  const stats = seedRoadmaps({ force });
  const adminId = seedAdmin();
  return { ...stats, adminId };
}

// CLI: npm run seed [-- --force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const result = runSeed({ force });
  console.log(
    result.skipped
      ? 'Database already seeded (use --force to re-seed).'
      : `Seeded ${result.roadmaps} roadmaps, ${result.topics} topics, ${result.articles} articles.`,
  );
  if (result.adminId) console.log(`Created admin user "${config.adminUsername}".`);
}
