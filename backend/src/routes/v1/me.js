import { Router } from 'express';
import Joi from 'joi';
import { query } from '../../db/index.js';
import { ApiError } from '../../middleware/error.js';
import { validate, common } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// Everything under /api/v1/me is private per-user data -> auth required.
router.use(requireAuth);

const slugParams = Joi.object({ slug: common.slug.required() });
const topicParams = slugParams.keys({
  topicKey: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).required(),
});

/* ====================================================== MY PROGRESS ====== */
router.get('/progress', (req, res, next) => {
  try {
    const rows = query.all(
      `SELECT p.roadmap_slug AS roadmapSlug, p.topic_key AS topicKey, p.status,
              p.updated_at AS updatedAt, r.title AS roadmapTitle
         FROM user_progress p
         JOIN roadmaps r ON r.slug = p.roadmap_slug
        WHERE p.user_id = ?
        ORDER BY r.title ASC, p.topic_key ASC`,
      req.user.id,
    );
    return res.json({ data: rows });
  } catch (err) {
    return next(err);
  }
});

/* Progress summary for one roadmap. */
router.get('/progress/:slug', validate({ params: slugParams }), (req, res, next) => {
  try {
    const { slug } = req.params;
    const roadmap = query.get('SELECT slug, title FROM roadmaps WHERE slug = ?', slug);
    if (!roadmap) {
      return next(ApiError.notFound('roadmap_not_found', `Roadmap "${slug}" not found`));
    }

    const { total } = query.get('SELECT COUNT(*) AS total FROM roadmap_topics WHERE roadmap_slug = ?', slug);
    const rows = query.all(
      'SELECT topic_key, status FROM user_progress WHERE user_id = ? AND roadmap_slug = ?',
      req.user.id,
      slug,
    );
    const completed = rows.filter((r) => r.status === 'completed').length;
    const inProgress = rows.filter((r) => r.status === 'in_progress').length;

    return res.json({
      data: {
        roadmapSlug: slug,
        roadmapTitle: roadmap.title,
        totalTopics: Number(total),
        completed,
        inProgress,
        pending: Number(total) - completed - inProgress, // not completed + not in progress
        done: completed, // legacy alias
        learning: inProgress, // legacy alias
        percent: total ? Math.round((completed / total) * 100) : 0,
        topics: rows,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/* Upsert - PUT is idempotent: repeating it leaves the same state. */
router.put(
  '/progress/:slug/:topicKey',
  validate({
    params: topicParams,
    body: Joi.object({
      status: Joi.string().valid('not_started', 'in_progress', 'completed').default('completed'),
    }),
  }),
  (req, res, next) => {
    try {
      const { slug, topicKey } = req.params;
      const { status } = req.body;

      const roadmap = query.get('SELECT slug FROM roadmaps WHERE slug = ?', slug);
      if (!roadmap) return next(ApiError.notFound('roadmap_not_found', `Roadmap "${slug}" not found`));
      const topic = query.get(
        'SELECT topic_key FROM roadmap_topics WHERE roadmap_slug = ? AND topic_key = ?',
        slug,
        topicKey,
      );
      if (!topic) return next(ApiError.notFound('topic_not_found', `Topic "${topicKey}" not found`));

      query.run(
        `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, roadmap_slug, topic_key)
         DO UPDATE SET status = excluded.status,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        req.user.id,
        slug,
        topicKey,
        status,
      );

      const row = query.get(
        `SELECT roadmap_slug AS roadmapSlug, topic_key AS topicKey, status,
                started_at AS startedAt, completed_at AS completedAt,
                last_accessed_at AS lastAccessedAt, updated_at AS updatedAt
           FROM user_progress WHERE user_id = ? AND roadmap_slug = ? AND topic_key = ?`,
        req.user.id,
        slug,
        topicKey,
      );
      return res.json({ data: row });
    } catch (err) {
      return next(err);
    }
  },
);

/* Idempotent delete: removing progress that is already gone stays 204. */
router.delete('/progress/:slug/:topicKey', validate({ params: topicParams }), (req, res, next) => {
  try {
    query.run(
      'DELETE FROM user_progress WHERE user_id = ? AND roadmap_slug = ? AND topic_key = ?',
      req.user.id,
      req.params.slug,
      req.params.topicKey,
    );
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

export default router;