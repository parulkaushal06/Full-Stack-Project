import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp, client } from './helpers.js';

describe('per-user progress', () => {
  let app;
  let user1;
  let user2;

  beforeAll(async () => {
    app = setupTestApp();

    user1 = client(app);
    await user1
      .post('/api/v1/auth/register')
      .send({ email: 'p1@example.com', username: 'progress1', password: 'password123' })
      .expect(201);

    user2 = client(app);
    await user2
      .post('/api/v1/auth/register')
      .send({ email: 'p2@example.com', username: 'progress2', password: 'password123' })
      .expect(201);
  });

  it('requires authentication', async () => {
    await client(app).get('/api/v1/me/progress').expect(401);
    await client(app)
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'done' })
      .expect(401);
  });

  it('PUT upserts topic progress (idempotent)', async () => {
    const first = await user1
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'done' })
      .expect(200);
    expect(first.body.data).toMatchObject({
      roadmapSlug: 'frontend',
      topicKey: '100-internet',
      status: 'done',
    });

    const repeat = await user1
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'done' })
      .expect(200);
    expect(repeat.body.data.status).toBe('done');

    const update = await user1
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'learning' })
      .expect(200);
    expect(update.body.data.status).toBe('learning');

    await user1
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'done' })
      .expect(200);
    await user1
      .put('/api/v1/me/progress/frontend/101-html')
      .send({ status: 'learning' })
      .expect(200);
  });

  it('summarises progress per roadmap with a percentage', async () => {
    const res = await user1.get('/api/v1/me/progress/frontend').expect(200);
    expect(res.body.data.totalTopics).toBe(2);
    expect(res.body.data.done).toBe(1);
    expect(res.body.data.learning).toBe(1);
    expect(res.body.data.percent).toBe(50);
  });

  it('lists all progress rows for the user', async () => {
    const res = await user1.get('/api/v1/me/progress').expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r) => r.roadmapTitle === 'Frontend Developer')).toBe(true);
  });

  it('DELETE clears progress and stays idempotent', async () => {
    await user1.delete('/api/v1/me/progress/frontend/101-html').expect(204);
    await user1.delete('/api/v1/me/progress/frontend/101-html').expect(204);

    const summary = await user1.get('/api/v1/me/progress/frontend').expect(200);
    expect(summary.body.data.done).toBe(1);
    expect(summary.body.data.learning).toBe(0);
  });

  it('keeps users isolated (user2 sees nothing)', async () => {
    const res = await user2.get('/api/v1/me/progress').expect(200);
    expect(res.body.data).toHaveLength(0);

    const summary = await user2.get('/api/v1/me/progress/frontend').expect(200);
    expect(summary.body.data.done).toBe(0);
    expect(summary.body.data.percent).toBe(0);
  });

  it('404s for unknown roadmaps and topics', async () => {
    const unknownRoadmap = await user1.get('/api/v1/me/progress/no-such-road').expect(404);
    expect(unknownRoadmap.body.error.code).toBe('roadmap_not_found');

    const unknownTopic = await user1
      .put('/api/v1/me/progress/frontend/999-ghost')
      .send({ status: 'done' })
      .expect(404);
    expect(unknownTopic.body.error.code).toBe('topic_not_found');
  });

  it('rejects invalid statuses', async () => {
    const res = await user1
      .put('/api/v1/me/progress/frontend/100-internet')
      .send({ status: 'banana' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
