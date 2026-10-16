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

/* Aggregated dashboard summary across every roadmap the user has started.
   Must be declared BEFORE /progress/:slug or "summary" matches the slug param.
   Status mapping (PRD): 'done' = Completed, 'learning' = In Progress,
   no row = Not Started (a cleared status counts as Not Started). */
router.get('/progress/summary', (req, res, next) => {
  try {
    const started = query.all(
      `SELECT roadmap_slug AS slug FROM user_progress
        WHERE user_id = ?
        GROUP BY roadmap_slug
        ORDER BY MAX(updated_at) DESC`,
      req.user.id,
    );

    const roadmaps = started.map(({ slug }) => {
      const meta = query.get('SELECT slug, title FROM roadmaps WHERE slug = ?', slug);
      // LEFT JOIN so topics without a progress row show up as Not Started
      const topics = query.all(
        `SELECT t.topic_key AS topicKey, t.label, t.order_index AS orderIndex,
                COALESCE(p.status, '') AS status
           FROM roadmap_topics t
           LEFT JOIN user_progress p ON p.roadmap_slug = t.roadmap_slug
                AND p.topic_key = t.topic_key AND p.user_id = ?
          WHERE t.roadmap_slug = ?
          ORDER BY t.order_index ASC`,
        req.user.id,
        slug,
      );
      const completed = topics.filter((t) => t.status === 'done').length;
      const inProgress = topics.filter((t) => t.status === 'learning').length;
      return {
        slug,
        title: meta.title,
        totalTopics: topics.length,
        completed,
        inProgress,
        notStarted: topics.length - completed - inProgress,
        percent: topics.length ? Math.round((completed / topics.length) * 100) : 0,
        topics,
      };
    });

    // Continue Learning: newest In Progress topic, else the first topic that is
    // not Completed yet inside the most recently updated roadmap.
    let continueLearning = query.get(
      `SELECT p.roadmap_slug AS slug, p.topic_key AS topicKey,
              r.title AS roadmapTitle, t.label AS topicLabel
         FROM user_progress p
         JOIN roadmaps r ON r.slug = p.roadmap_slug
         JOIN roadmap_topics t ON t.roadmap_slug = p.roadmap_slug
              AND t.topic_key = p.topic_key
        WHERE p.user_id = ? AND p.status = 'learning'
        ORDER BY p.updated_at DESC
        LIMIT 1`,
      req.user.id,
    );
    if (!continueLearning && started.length) {
      continueLearning = query.get(
        `SELECT r.slug, t.topic_key AS topicKey,
                r.title AS roadmapTitle, t.label AS topicLabel
           FROM roadmap_topics t
           JOIN roadmaps r ON r.slug = t.roadmap_slug
          WHERE t.roadmap_slug = (SELECT roadmap_slug FROM user_progress
                                   WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1)
            AND NOT EXISTS (SELECT 1 FROM user_progress p
                             WHERE p.user_id = ? AND p.roadmap_slug = t.roadmap_slug
                               AND p.topic_key = t.topic_key AND p.status = 'done')
          ORDER BY t.order_index ASC
          LIMIT 1`,
        req.user.id,
        req.user.id,
      );
    }

    const sum = (key) => roadmaps.reduce((n, r) => n + r[key], 0);
    const totals = {
      completed: sum('completed'),
      inProgress: sum('inProgress'),
      notStarted: sum('notStarted'),
      topics: sum('totalTopics'),
    };
    return res.json({
      data: {
        totals,
        overallPercent: totals.topics ? Math.round((totals.completed / totals.topics) * 100) : 0,
        roadmaps,
        continueLearning: continueLearning || null,
      },
    });
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