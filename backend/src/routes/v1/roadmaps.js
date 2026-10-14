import { Router } from 'express';
import crypto from 'node:crypto';
import Joi from 'joi';
import { marked } from 'marked';
import config from '../../config.js';
import { query } from '../../db/index.js';
import { cache } from '../../lib/cache.js';
import { ApiError } from '../../middleware/error.js';
import { validate, common } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = Router();

marked.setOptions({ gfm: true, breaks: false });

const render = (md) => (md ? marked.parse(md) : null);

const listQuerySchema = Joi.object({
  page: common.page,
  limit: common.limit,
  search: Joi.string().trim().min(1).max(100).allow(''),
  category: Joi.string().valid('role', 'language', 'framework', 'tool', 'database', 'concept', 'other'),
  tag: Joi.string().trim().max(40),
  difficulty: Joi.string().valid('beginner', 'intermediate', 'advanced'),
  sort: common.sort,
  order: common.order,
});

const roadmapBodySchema = Joi.object({
  slug: common.slug.required(),
  title: Joi.string().trim().min(1).max(120).required(),
  briefTitle: Joi.string().trim().max(120).allow('', null),
  description: Joi.string().trim().max(600).allow('', null),
  category: Joi.string().valid('role', 'language', 'framework', 'tool', 'database', 'concept', 'other').default('other'),
  difficulty: Joi.string().valid('beginner', 'intermediate', 'advanced').default('beginner'),
  tag: Joi.string().trim().max(40).default('general'),
  order: Joi.number().integer().min(0).default(0),
  isForkable: Joi.boolean().default(true),
  hasTopics: Joi.boolean().default(true),
  articleMd: Joi.string().max(50_000).allow('', null),
  imageUrl: Joi.string().max(300).allow('', null),
});

// PATCH: every field optional AND no defaults - a partial payload must not
// silently re-apply the POST defaults to untouched columns.
const patchSchema = Joi.object({
  slug: common.slug.optional(),
  title: Joi.string().trim().min(1).max(120),
  briefTitle: Joi.string().trim().max(120).allow('', null),
  description: Joi.string().trim().max(600).allow('', null),
  category: Joi.string().valid('role', 'language', 'framework', 'tool', 'database', 'concept', 'other'),
  difficulty: Joi.string().valid('beginner', 'intermediate', 'advanced'),
  tag: Joi.string().trim().max(40),
  order: Joi.number().integer().min(0),
  isForkable: Joi.boolean(),
  hasTopics: Joi.boolean(),
  articleMd: Joi.string().max(50_000).allow('', null),
  imageUrl: Joi.string().max(300).allow('', null),
}).min(1);

const SORT_COLUMNS = {
  title: 'title',
  order: 'order_index',
  category: 'category',
  difficulty: 'difficulty',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

const HASH_ALGO = 'sha256';

/** Single roadmap resource: keeps DB columns and adds the public `order` alias. */
function roadmapResource(row) {
  return row ? { ...row, order: row.order_index } : row;
}

function etagFor(payload) {
  return `"${crypto.createHash(HASH_ALGO).update(payload).digest('base64url').slice(0, 40)}"`;
}

/** Sends a JSON payload with ETag/304 support + cacheability headers. */
function sendWithEtag(req, res, status, payload, { maxAge = 0, cacheStatus } = {}) {
  const body = JSON.stringify(payload);
  const etag = etagFor(body);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  if (cacheStatus) res.setHeader('X-Cache', cacheStatus);
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  return res.status(status).type('application/json').send(body);
}

/* ============================================================== LIST ===== */
/* GET /api/v1/roadmaps?page=&limit=&search=&category=&tag=&difficulty=
 *      &sort=&order=   -> paginated, filtered, sorted collection           */
router.get('/', validate({ query: listQuerySchema }), (req, res, next) => {
  try {
    const { page, limit, search, category, tag, difficulty, sort, order } = req.query;
    const where = [];
    const params = [];

    if (search) {
      where.push('(title LIKE ? OR brief_title LIKE ? OR description LIKE ?)');
      const like = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
    if (category) {
      where.push('category = ?');
      params.push(category);
    }
    if (tag) {
      where.push('tag = ?');
      params.push(tag);
    }
    if (difficulty) {
      where.push('difficulty = ?');
      params.push(difficulty);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const cacheKey = `roadmaps:list:${JSON.stringify({ page, limit, search, category, tag, difficulty, sort, order })}`;

    const { value, hit } = cache.wrap(cacheKey, config.cacheListTtl, () => {
      const { c: total } = query.get(`SELECT COUNT(*) AS c FROM roadmaps ${whereSql}`, ...params);
      const rows = query.all(
        `SELECT slug, title, brief_title, description, category, difficulty, tag,
                order_index, image_url, created_at, updated_at
           FROM roadmaps ${whereSql}
          ORDER BY ${SORT_COLUMNS[sort]} ${order === 'desc' ? 'DESC' : 'ASC'}, slug ASC
          LIMIT ? OFFSET ?`,
        ...params,
        limit,
        (page - 1) * limit,
      );
      const totalRows = Number(total);
      return {
        data: rows.map((r) => ({ ...r, order: r.order_index })),
        meta: {
          page,
          limit,
          total: totalRows,
          totalPages: Math.max(1, Math.ceil(totalRows / limit)),
        },
      };
    });

    const links = {};
    links.self = `?page=${page}&limit=${limit}`;
    if (page > 1) links.prev = `?page=${page - 1}&limit=${limit}`;
    if (page < value.meta.totalPages) links.next = `?page=${page + 1}&limit=${limit}`;

    sendWithEtag(req, res, 200, { ...value, links }, {
      maxAge: config.cacheListTtl,
      cacheStatus: hit ? 'HIT' : 'MISS',
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================== CREATE ====== */
/* POST /api/v1/roadmaps (admin) - supports Idempotency-Key for retries    */
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate({ body: roadmapBodySchema }),
  (req, res, next) => {
    try {
      const body = req.body;
      const idempotencyKey = req.headers['idempotency-key'];
      const endpoint = 'POST /api/v1/roadmaps';
      const userId = req.user.id;
      const requestHash = crypto
        .createHash(HASH_ALGO)
        .update(JSON.stringify(body))
        .digest('hex');

      if (idempotencyKey) {
        const previous = query.get(
          'SELECT * FROM idempotency_keys WHERE key = ? AND endpoint = ? AND user_id = ?',
          String(idempotencyKey).slice(0, 255),
          endpoint,
          userId,
        );
        if (previous) {
          if (previous.request_hash !== requestHash) {
            return next(
              ApiError.unprocessable(
                'idempotency_key_conflict',
                'Idempotency-Key was already used with a different payload',
              ),
            );
          }
          res.setHeader('Idempotency-Replayed', 'true');
          return res
            .status(previous.response_status)
            .type('application/json')
            .send(previous.response_body);
        }
      }

      const exists = query.get('SELECT slug FROM roadmaps WHERE slug = ?', body.slug);
      if (exists) {
        return next(ApiError.conflict('slug_exists', `Roadmap "${body.slug}" already exists`));
      }

      query.run(
        `INSERT INTO roadmaps (slug, title, brief_title, description, category, difficulty,
                               tag, order_index, is_forkable, has_topics, article_md, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.slug,
        body.title,
        body.briefTitle || body.title,
        body.description || null,
        body.category,
        body.difficulty,
        body.tag,
        body.order,
        body.isForkable ? 1 : 0,
        body.hasTopics ? 1 : 0,
        body.articleMd || null,
        body.imageUrl || null,
      );

      const row = query.get('SELECT * FROM roadmaps WHERE slug = ?', body.slug);
      cache.invalidate('roadmaps:');

      const payload = JSON.stringify({ data: roadmapResource(row) });
      if (idempotencyKey) {
        query.run(
          `INSERT INTO idempotency_keys (key, endpoint, user_id, request_hash, response_status, response_body)
           VALUES (?, ?, ?, ?, ?, ?)`,
          String(idempotencyKey).slice(0, 255),
          endpoint,
          userId,
          requestHash,
          201,
          payload,
        );
      }

      res.setHeader('Location', `/api/v1/roadmaps/${row.slug}`);
      return res.status(201).type('application/json').send(payload);
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================ DETAIL ===== */
router.get('/:slug', validate({ params: Joi.object({ slug: common.slug.required() }) }), (req, res, next) => {
  try {
    const cacheKey = `roadmaps:detail:${req.params.slug}`;
    const { value, hit } = cache.wrap(cacheKey, config.cacheDetailTtl, () => {
      const row = query.get(
        `SELECT r.*,
                (SELECT COUNT(*) FROM roadmap_topics t WHERE t.roadmap_slug = r.slug) AS topics_count,
                (SELECT COUNT(*) FROM topic_articles a WHERE a.roadmap_slug = r.slug) AS articles_count
           FROM roadmaps r WHERE r.slug = ?`,
        req.params.slug,
      );        if (!row) return null;
        return row && row.article_md
          ? { ...row, article_html: render(row.article_md) }
          : row;
    });

    if (!value) {
      cache.invalidate(cacheKey);
      return next(
        ApiError.notFound('roadmap_not_found', `Roadmap "${req.params.slug}" not found`),
      );
    }
    return sendWithEtag(req, res, 200, { data: roadmapResource(value) }, {
      maxAge: config.cacheDetailTtl,
      cacheStatus: hit ? 'HIT' : 'MISS',
    });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================ TOPICS ===== */
router.get('/:slug/topics', validate({ params: Joi.object({ slug: common.slug.required() }) }), (req, res, next) => {
  try {
    const roadmap = query.get('SELECT slug FROM roadmaps WHERE slug = ?', req.params.slug);
    if (!roadmap) {
      return next(ApiError.notFound('roadmap_not_found', `Roadmap "${req.params.slug}" not found`));
    }
    const rows = query.all(
      `SELECT t.topic_key, t.label, t.order_index,
              (SELECT COUNT(*) FROM topic_articles a
                WHERE a.roadmap_slug = t.roadmap_slug AND a.topic_key = t.topic_key) AS article_count
         FROM roadmap_topics t
        WHERE t.roadmap_slug = ?
        ORDER BY t.order_index ASC`,
      req.params.slug,
    );
    return sendWithEtag(req, res, 200, { data: rows }, { cacheStatus: 'MISS' });
  } catch (err) {
    return next(err);
  }
});

router.get(
  '/:slug/topics/:topicKey',
  validate({
    params: Joi.object({
      slug: common.slug.required(),
      topicKey: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).required(),
    }),
  }),
  (req, res, next) => {
    try {
      const { slug, topicKey } = req.params;
      const cacheKey = `roadmaps:topic:${slug}:${topicKey}`;
      const { value, hit } = cache.wrap(cacheKey, config.cacheDetailTtl, () => {
        const topic = query.get(
          'SELECT * FROM roadmap_topics WHERE roadmap_slug = ? AND topic_key = ?',
          slug,
          topicKey,
        );
        if (!topic) return null;
        const articles = query.all(
          `SELECT article_key, title, content_md, order_index
             FROM topic_articles
            WHERE roadmap_slug = ? AND topic_key = ?
            ORDER BY order_index ASC`,
          slug,
          topicKey,
        );
        return {
          ...topic,
          contentHtml: render(topic.content_md),
          articles: articles.map((a) => ({
            ...a,
            contentHtml: render(a.content_md),
          })),
        };
      });

      if (!value) {
        cache.invalidate(cacheKey);
        return next(
          ApiError.notFound('topic_not_found', `Topic "${topicKey}" not found on roadmap "${slug}"`),
        );
      }
      return sendWithEtag(req, res, 200, { data: value }, {
        maxAge: config.cacheDetailTtl,
        cacheStatus: hit ? 'HIT' : 'MISS',
      });
    } catch (err) {
      return next(err);
    }
  },
);

/* =============================================================== PUT ===== */
/* Full replacement - idempotent by definition: repeating the same PUT
   leaves the same state.                                                     */
router.put(
  '/:slug',
  requireAuth,
  requireRole('admin'),
  validate({
    params: Joi.object({ slug: common.slug.required() }),
    body: roadmapBodySchema,
  }),
  (req, res, next) => {
    try {
      const { slug } = req.params;
      const existing = query.get('SELECT * FROM roadmaps WHERE slug = ?', slug);
      if (!existing) {
        return next(ApiError.notFound('roadmap_not_found', `Roadmap "${slug}" not found`));
      }
      if (req.body.slug !== slug) {
        const clash = query.get('SELECT slug FROM roadmaps WHERE slug = ?', req.body.slug);
        if (clash) return next(ApiError.conflict('slug_exists', `Roadmap "${req.body.slug}" already exists`));
      }

      query.run(
        `UPDATE roadmaps SET slug = ?, title = ?, brief_title = ?, description = ?, category = ?,
                             difficulty = ?, tag = ?, order_index = ?, is_forkable = ?, has_topics = ?,
                             article_md = ?, image_url = ?,
                             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE slug = ?`,
        req.body.slug,
        req.body.title,
        req.body.briefTitle || req.body.title,
        req.body.description || null,
        req.body.category,
        req.body.difficulty,
        req.body.tag,
        req.body.order,
        req.body.isForkable ? 1 : 0,
        req.body.hasTopics ? 1 : 0,
        req.body.articleMd || null,
        req.body.imageUrl || null,
        slug,
      );
      cache.invalidate('roadmaps:');
      const row = query.get('SELECT * FROM roadmaps WHERE slug = ?', req.body.slug);
      return sendWithEtag(req, res, 200, { data: roadmapResource(row) });
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================== PATCH ==== */
/* Partial update - only the fields present in the payload are touched.      */
router.patch(
  '/:slug',
  requireAuth,
  requireRole('admin'),
  validate({
    params: Joi.object({ slug: common.slug.required() }),
    body: patchSchema,
  }),
  (req, res, next) => {
    try {
      const { slug } = req.params;
      const existing = query.get('SELECT * FROM roadmaps WHERE slug = ?', slug);
      if (!existing) {
        return next(ApiError.notFound('roadmap_not_found', `Roadmap "${slug}" not found`));
      }

      const FIELD_MAP = {
        title: 'title',
        briefTitle: 'brief_title',
        description: 'description',
        category: 'category',
        difficulty: 'difficulty',
        tag: 'tag',
        order: 'order_index',
        isForkable: 'is_forkable',
        hasTopics: 'has_topics',
        articleMd: 'article_md',
        imageUrl: 'image_url',
      };

      const sets = [];
      const params = [];
      for (const [key, column] of Object.entries(FIELD_MAP)) {
        if (req.body[key] !== undefined) {
          sets.push(`${column} = ?`);
          const value = req.body[key];
          params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }
      }
      if (req.body.slug !== undefined && req.body.slug !== slug) {
        const clash = query.get('SELECT slug FROM roadmaps WHERE slug = ?', req.body.slug);
        if (clash) return next(ApiError.conflict('slug_exists', `Roadmap "${req.body.slug}" already exists`));
        sets.push('slug = ?');
        params.push(req.body.slug);
      }
      if (!sets.length) {
        return next(ApiError.badRequest('empty_patch', 'No updatable fields supplied'));
      }

      sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
      query.run(`UPDATE roadmaps SET ${sets.join(', ')} WHERE slug = ?`, ...params, slug);
      cache.invalidate('roadmaps:');

      const row = query.get('SELECT * FROM roadmaps WHERE slug = ?', req.body.slug || slug);
      return sendWithEtag(req, res, 200, { data: roadmapResource(row) });
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================ DELETE ===== */
/* Idempotent: DELETE repeated N times still converges on "resource gone"
   and keeps returning 204.                                                   */
router.delete(
  '/:slug',
  requireAuth,
  requireRole('admin'),
  validate({ params: Joi.object({ slug: common.slug.required() }) }),
  (req, res, next) => {
    try {
      query.run('DELETE FROM roadmaps WHERE slug = ?', req.params.slug); // cascades
      cache.invalidate('roadmaps:');
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
