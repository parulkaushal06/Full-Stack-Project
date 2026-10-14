import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp, client, adminCreds } from './helpers.js';

describe('GET /api/v1/roadmaps - pagination, filtering, sorting', () => {
  let app;
  let admin;

  beforeAll(async () => {
    app = setupTestApp();
    admin = client(app);
    await admin.post('/api/v1/auth/login').send(adminCreds).expect(200);
  });

  it('paginates with meta + links', async () => {
    const res = await client(app)
      .get('/api/v1/roadmaps?limit=2&page=2')
      .expect(200);

    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.links.prev).toContain('page=1');
    expect(res.body.links.next).toBeUndefined();
    expect(res.headers['x-api-version']).toBe('v1');
  });

  it('filters by category, tag and difficulty', async () => {
    const byCategory = await client(app)
      .get('/api/v1/roadmaps?category=framework')
      .expect(200);
    expect(byCategory.body.data.map((r) => r.slug)).toEqual(['react']);

    const byTag = await client(app).get('/api/v1/roadmaps?tag=general').expect(200);
    expect(byTag.body.data.map((r) => r.slug)).toEqual(['python']);

    const byDifficulty = await client(app)
      .get('/api/v1/roadmaps?difficulty=intermediate')
      .expect(200);
    expect(byDifficulty.body.data.map((r) => r.slug)).toEqual(['react']);
  });

  it('searches title/description', async () => {
    const res = await client(app).get('/api/v1/roadmaps?search=python').expect(200);
    expect(res.body.data.map((r) => r.slug)).toEqual(['python']);
    expect(res.body.meta.total).toBe(1);
  });

  it('sorts with sort + order', async () => {
    const res = await client(app)
      .get('/api/v1/roadmaps?sort=title&order=desc')
      .expect(200);
    expect(res.body.data.map((r) => r.title)).toEqual([
      'React Developer',
      'Python Developer',
      'Frontend Developer',
    ]);
  });

  it('returns 400 with per-field details on invalid query', async () => {
    const res = await client(app).get('/api/v1/roadmaps?limit=999').expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details[0].field).toBe('limit');
  });

  it('serves ETag + cache-aside headers and 304 on If-None-Match', async () => {
    const key = 'etag-test';
    const first = await client(app).get(`/api/v1/roadmaps?search=${key}`).expect(200);
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await client(app).get(`/api/v1/roadmaps?search=${key}`).expect(200);
    expect(second.headers['x-cache']).toBe('HIT');

    const cached = await client(app)
      .get(`/api/v1/roadmaps?search=${key}`)
      .set('If-None-Match', first.headers.etag)
      .expect(304);
    expect(cached.text).toBeFalsy();
  });
});

describe('roadmap detail + topics', () => {
  let app;

  beforeAll(() => {
    app = setupTestApp();
  });

  it('returns a roadmap with topic/article counts', async () => {
    const res = await client(app).get('/api/v1/roadmaps/frontend').expect(200);
    expect(res.body.data.slug).toBe('frontend');
    expect(res.body.data.topics_count).toBe(2);
    expect(res.body.data.articles_count).toBe(1);
    expect(res.body.data.article_md).toContain('Frontend');
  });

  it('404 uses the error envelope', async () => {
    const res = await client(app).get('/api/v1/roadmaps/does-not-exist').expect(404);
    expect(res.body.error).toEqual({
      code: 'roadmap_not_found',
      message: 'Roadmap "does-not-exist" not found',
    });
  });

  it('lists topics ordered with article counts', async () => {
    const res = await client(app).get('/api/v1/roadmaps/frontend/topics').expect(200);
    expect(res.body.data.map((t) => t.topic_key)).toEqual(['100-internet', '101-html']);
    expect(res.body.data[0].article_count).toBe(1);
    expect(res.body.data[1].article_count).toBe(0);
  });

  it('returns topic content rendered as HTML plus its articles', async () => {
    const res = await client(app)
      .get('/api/v1/roadmaps/frontend/topics/100-internet')
      .expect(200);
    expect(res.body.data.label).toBe('Internet');
    expect(res.body.data.contentHtml).toContain('<h1');
    expect(res.body.data.articles).toHaveLength(1);
    expect(res.body.data.articles[0].contentHtml).toContain('<a href="https://example.com"');
  });

  it('404s for an unknown topic', async () => {
    const res = await client(app)
      .get('/api/v1/roadmaps/frontend/topics/999-nope')
      .expect(404);
    expect(res.body.error.code).toBe('topic_not_found');
  });
});

describe('roadmap CRUD - auth, RBAC, idempotency', () => {
  let app;
  let admin;
  let user;

  beforeAll(async () => {
    app = setupTestApp();

    admin = client(app);
    await admin.post('/api/v1/auth/login').send(adminCreds).expect(200);

    user = client(app);
    await user.post('/api/v1/auth/register').send({
      email: 'crud-user@example.com',
      username: 'cruduser',
      password: 'password123',
    }).expect(201);
  });

  it('rejects anonymous creates with 401', async () => {
    const res = await client(app)
      .post('/api/v1/roadmaps')
      .send({ slug: 'nope', title: 'Nope' })
      .expect(401);
    expect(res.body.error.code).toBe('authentication_required');
  });

  it('rejects non-admin creates with 403 (RBAC)', async () => {
    const res = await user
      .post('/api/v1/roadmaps')
      .send({ slug: 'nope', title: 'Nope' })
      .expect(403);
    expect(res.body.error.code).toBe('insufficient_role');
  });

  it('creates as admin with Location header', async () => {
    const res = await admin
      .post('/api/v1/roadmaps')
      .send({ slug: 'temp-roadmap', title: 'Temp Roadmap', category: 'concept' })
      .expect(201);
    expect(res.headers.location).toBe('/api/v1/roadmaps/temp-roadmap');
    expect(res.body.data.slug).toBe('temp-roadmap');
    expect(res.body.data.difficulty).toBe('beginner'); // default applied
  });

  it('rejects duplicate slugs with 409', async () => {
    const res = await admin
      .post('/api/v1/roadmaps')
      .send({ slug: 'temp-roadmap', title: 'Again' })
      .expect(409);
    expect(res.body.error.code).toBe('slug_exists');
  });

  it('rejects invalid slugs with 400', async () => {
    const res = await admin
      .post('/api/v1/roadmaps')
      .send({ slug: 'Bad Slug!', title: 'Bad' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.some((d) => d.field === 'slug')).toBe(true);
  });

  it('replays the original response for an Idempotency-Key retry', async () => {
    const payload = { slug: 'idem-roadmap', title: 'Idem', category: 'tool' };

    const first = await admin
      .post('/api/v1/roadmaps')
      .set('Idempotency-Key', 'key-1')
      .send(payload)
      .expect(201);

    const replay = await admin
      .post('/api/v1/roadmaps')
      .set('Idempotency-Key', 'key-1')
      .send(payload)
      .expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const conflict = await admin
      .post('/api/v1/roadmaps')
      .set('Idempotency-Key', 'key-1')
      .send({ ...payload, title: 'Different' })
      .expect(422);
    expect(conflict.body.error.code).toBe('idempotency_key_conflict');

    await admin.delete('/api/v1/roadmaps/idem-roadmap').expect(204);
  });

  it('PUT is a full, idempotent replacement', async () => {
    await admin
      .post('/api/v1/roadmaps')
      .send({ slug: 'replace-me', title: 'Old Title', category: 'concept' })
      .expect(201);

    const body = {
      slug: 'replace-me',
      title: 'New Title',
      category: 'language',
      difficulty: 'advanced',
      tag: 'testing',
      order: 42,
      description: 'Fully described',
    };

    const first = await admin.put('/api/v1/roadmaps/replace-me').send(body).expect(200);
    const second = await admin.put('/api/v1/roadmaps/replace-me').send(body).expect(200);

    // repeating changes nothing (except the updated_at audit timestamp)
    const { updated_at: _firstUpdated, ...firstData } = first.body.data;
    const { updated_at: _secondUpdated, ...secondData } = second.body.data;
    expect(secondData).toEqual(firstData);
    expect(first.body.data.title).toBe('New Title');
    expect(first.body.data.category).toBe('language');
    expect(first.body.data.order).toBe(42);
    expect(first.body.data.difficulty).toBe('advanced');
  });

  it('PATCH only touches supplied fields (no default bleed)', async () => {
    await admin
      .post('/api/v1/roadmaps')
      .send({ slug: 'patch-me', title: 'Patch Me', category: 'concept', difficulty: 'beginner' })
      .expect(201);

    const res = await admin
      .patch('/api/v1/roadmaps/patch-me')
      .send({ difficulty: 'advanced' })
      .expect(200);

    expect(res.body.data.difficulty).toBe('advanced');
    expect(res.body.data.title).toBe('Patch Me');
    expect(res.body.data.category).toBe('concept');
    expect(res.body.data.tag).toBe('general'); // untouched default from POST, not re-applied

    const empty = await admin.patch('/api/v1/roadmaps/patch-me').send({}).expect(400);
    expect(empty.body.error.code).toBe('validation_error');
  });

  it('DELETE is idempotent (204, 204, then 404 on GET)', async () => {
    await admin.delete('/api/v1/roadmaps/temp-roadmap').expect(204);
    await admin.delete('/api/v1/roadmaps/temp-roadmap').expect(204);
    await admin.get('/api/v1/roadmaps/temp-roadmap').expect(404);
    await admin.delete('/api/v1/roadmaps/patch-me').expect(204);
  });

  it('rejects cross-origin mutations (CSRF origin check)', async () => {
    const res = await admin
      .post('/api/v1/roadmaps')
      .set('Origin', 'https://evil.example')
      .send({ slug: 'evil', title: 'Evil' })
      .expect(403);
    expect(res.body.error.code).toBe('cross_origin_rejected');
  });
});
