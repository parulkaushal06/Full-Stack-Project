import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp } from './helpers.js';
import { query } from '../src/db/index.js';
import { seedResources, extractLinks, classifyUrl } from '../src/db/seed_resources.js';
import { seedQuizzes } from '../src/db/seed_quizzes.js';

function makeUser(name) {
  return query.run(
    `INSERT INTO users (email, username, password_hash) VALUES (?, ?, 'x')`,
    `${name}@example.com`,
    name,
  ).lastInsertRowid;
}

describe('migrations', () => {
  beforeAll(() => {
    setupTestApp();
  });

  it('applies all migrations once', () => {
    const names = query.all('SELECT name FROM schema_migrations ORDER BY name').map((r) => r.name);
    expect(names).toEqual([
      '001_init.sql',
      '002_progress_tracking.sql',
      '003_resources_search.sql',
      '004_tasks.sql',
      '005_quizzes.sql',
    ]);
  });
});

/* ===================================================== PERSON 2 ========= */
describe('progress tracking (002)', () => {
  let uid;
  beforeAll(() => {
    setupTestApp();
    uid = makeUser('prog');
  });

  it('only accepts not_started / in_progress / completed', () => {
    expect(() =>
      query.run(
        `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status)
         VALUES (?, 'frontend', '100-internet', 'done')`,
        uid,
      ),
    ).toThrow(/CHECK/i);
  });

  it('rejects topics that do not exist (composite FK)', () => {
    expect(() =>
      query.run(
        `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status)
         VALUES (?, 'frontend', '999-ghost', 'completed')`,
        uid,
      ),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('stamps started_at / completed_at automatically', () => {
    query.run(
      `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status)
       VALUES (?, 'frontend', '100-internet', 'in_progress')`,
      uid,
    );
    let row = query.get(`SELECT * FROM user_progress WHERE user_id = ? AND topic_key = '100-internet'`, uid);
    expect(row.started_at).toBeTruthy();
    expect(row.completed_at).toBeNull();

    query.run(`UPDATE user_progress SET status = 'completed' WHERE id = ?`, row.id);
    row = query.get('SELECT * FROM user_progress WHERE id = ?', row.id);
    expect(row.completed_at).toBeTruthy();

    query.run(`UPDATE user_progress SET status = 'not_started' WHERE id = ?`, row.id);
    row = query.get('SELECT * FROM user_progress WHERE id = ?', row.id);
    expect(row.completed_at).toBeNull();
    expect(row.started_at).toBeNull();
  });

  it('v_roadmap_progress computes completed / in progress / pending / percent', () => {
    query.run(`DELETE FROM user_progress WHERE user_id = ?`, uid);
    query.run(
      `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status) VALUES (?, 'frontend', '100-internet', 'completed')`,
      uid,
    );
    query.run(
      `INSERT INTO user_progress (user_id, roadmap_slug, topic_key, status) VALUES (?, 'frontend', '101-html', 'in_progress')`,
      uid,
    );
    const row = query.get('SELECT * FROM v_roadmap_progress WHERE user_id = ?', uid);
    expect(row).toMatchObject({
      roadmap_slug: 'frontend',
      total_topics: 2,
      completed_topics: 1,
      in_progress_topics: 1,
      pending_topics: 0,
      percent: 50,
    });
  });

  it('v_continue_learning lists in-progress topics, newest first', () => {
    const rows = query.all(
      'SELECT * FROM v_continue_learning WHERE user_id = ? ORDER BY last_accessed_at DESC',
      uid,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic_key: '101-html', topic_label: 'HTML' });
  });
});

/* ===================================================== PERSON 1 ========= */
describe('resources + search (003)', () => {
  beforeAll(() => {
    setupTestApp();
  });

  it('classifies YouTube links as video and the rest as article', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=abc')).toBe('video');
    expect(classifyUrl('https://youtu.be/abc')).toBe('video');
    expect(classifyUrl('https://developer.mozilla.org/en-US/docs/Web/HTML')).toBe('article');
    expect(classifyUrl('not a url')).toBeNull();

    expect(
      extractLinks('- [HTML Full Course](https://youtu.be/mJgBOIoGihA)\n- [W3Schools](https://www.w3schools.com/html/)'),
    ).toEqual([
      { title: 'HTML Full Course', url: 'https://youtu.be/mJgBOIoGihA', type: 'video' },
      { title: 'W3Schools', url: 'https://www.w3schools.com/html/', type: 'article' },
    ]);
  });

  it('seeds resources from topic/sub-topic content and is idempotent', () => {
    query.run(
      `UPDATE roadmap_topics SET content_md = '- [Intro video](https://www.youtube.com/watch?v=xyz)'
        WHERE roadmap_slug = 'frontend' AND topic_key = '101-html'`,
    );
    const first = seedResources();
    expect(first.resources).toBe(2); // fixture sub-topic link + the video above
    expect(seedResources().resources).toBe(0);

    const video = query.get(`SELECT * FROM topic_resources WHERE resource_type = 'video'`);
    expect(video).toMatchObject({ roadmap_slug: 'frontend', topic_key: '101-html', article_key: '' });
    const article = query.get(`SELECT * FROM topic_resources WHERE resource_type = 'article'`);
    expect(article).toMatchObject({ topic_key: '100-internet', article_key: '100-how-does-the-internet-work' });
  });

  it('v_search_index finds roadmaps, topics and sub-topics', () => {
    const rows = query.all(
      `SELECT kind, title FROM v_search_index WHERE title LIKE '%' || ? || '%' ORDER BY kind, title`,
      'internet',
    );
    expect(rows.map((r) => r.kind)).toEqual(['subtopic', 'topic']);
  });
});

/* ===================================================== PERSON 3 ========= */
describe('tasks (004)', () => {
  let uid;
  beforeAll(() => {
    setupTestApp();
    uid = makeUser('tasker');
  });

  const insertTask = (fields) =>
    query.run(
      `INSERT INTO tasks (user_id, title, status, due_date, roadmap_slug, topic_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      uid,
      fields.title,
      fields.status || 'pending',
      fields.due ?? null,
      fields.roadmap ?? null,
      fields.topic ?? null,
    ).lastInsertRowid;

  it('validates title, priority and status', () => {
    expect(() => insertTask({ title: '   ' })).toThrow(/CHECK/i);
    expect(() => query.run(`INSERT INTO tasks (user_id, title, priority) VALUES (?, 'x', 'urgent')`, uid)).toThrow(/CHECK/i);
    expect(() => insertTask({ title: 'x', status: 'done' })).toThrow(/CHECK/i);
    expect(() => insertTask({ title: 'x', due: 'tomorrow' })).toThrow(/CHECK/i);
  });

  it('only allows a topic that belongs to the roadmap', () => {
    expect(() => insertTask({ title: 'bad', roadmap: 'frontend', topic: '999-ghost' })).toThrow(/topic_key/i);
    expect(() => insertTask({ title: 'bad', topic: '101-html' })).toThrow(/topic_key/i);
    const id = insertTask({ title: 'ok', roadmap: 'frontend', topic: '101-html' });
    const row = query.get('SELECT * FROM v_tasks WHERE id = ?', id);
    expect(row).toMatchObject({ roadmap_title: 'Frontend Developer', topic_label: 'HTML' });
  });

  it('computes pending / overdue / completed in v_tasks', () => {
    const past = insertTask({ title: 'late', due: '2020-01-01' });
    const future = insertTask({ title: 'later', due: '2999-01-01T10:00:00.000Z' });
    const today = insertTask({ title: 'today (date only = end of day)', due: new Date().toISOString().slice(0, 10) });
    const none = insertTask({ title: 'no deadline' });
    const donePast = insertTask({ title: 'done late', due: '2020-01-01', status: 'completed' });

    const state = (id) => query.get('SELECT effective_status, is_overdue FROM v_tasks WHERE id = ?', id);
    expect(state(past)).toEqual({ effective_status: 'overdue', is_overdue: 1 });
    expect(state(future)).toEqual({ effective_status: 'pending', is_overdue: 0 });
    expect(state(today).effective_status).toBe('pending');
    expect(state(none).effective_status).toBe('pending');
    expect(state(donePast)).toEqual({ effective_status: 'completed', is_overdue: 0 });
  });

  it('sets completed_at when completed and clears it when reopened', () => {
    const id = insertTask({ title: 'finish me' });
    expect(query.get('SELECT completed_at FROM tasks WHERE id = ?', id).completed_at).toBeNull();

    query.run(`UPDATE tasks SET status = 'completed' WHERE id = ?`, id);
    expect(query.get('SELECT completed_at FROM tasks WHERE id = ?', id).completed_at).toBeTruthy();

    query.run(`UPDATE tasks SET status = 'pending' WHERE id = ?`, id);
    expect(query.get('SELECT completed_at FROM tasks WHERE id = ?', id).completed_at).toBeNull();
  });

  it('keeps the task but drops the link when its roadmap is deleted', () => {
    const id = insertTask({ title: 'linked', roadmap: 'python' });
    query.run(`DELETE FROM roadmaps WHERE slug = 'python'`);
    const row = query.get('SELECT roadmap_slug, topic_key FROM tasks WHERE id = ?', id);
    expect(row).toEqual({ roadmap_slug: null, topic_key: null });
  });
});

describe('quizzes (005)', () => {
  let uid;
  let quizId;
  let questions; // [{ id, correctId, wrongId }]

  beforeAll(() => {
    setupTestApp();
    uid = makeUser('quizzer');
    seedQuizzes([
      {
        roadmap: 'frontend',
        topic: '101-html',
        title: 'Mini quiz',
        pass: 50,
        questions: [
          { q: 'Q1', options: ['a', 'b', 'c'], correct: 0 },
          { q: 'Q2', options: ['a', 'b', 'c'], correct: 1 },
          { q: 'Q3', options: ['a', 'b', 'c'], correct: 2 },
          { q: 'Q4', options: ['a', 'b', 'c'], correct: 0 },
        ],
      },
    ]);
    quizId = query.get(`SELECT id FROM quizzes WHERE title = 'Mini quiz'`).id;
    questions = query
      .all('SELECT id FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index', quizId)
      .map((q) => ({
        id: q.id,
        correctId: query.get('SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 1', q.id).id,
        wrongId: query.get('SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 0', q.id).id,
      }));
  });

  const startAttempt = () =>
    query.run('INSERT INTO quiz_attempts (user_id, quiz_id) VALUES (?, ?)', uid, quizId).lastInsertRowid;
  const answer = (attemptId, q, optionId) =>
    query.run(
      'INSERT INTO quiz_attempt_answers (attempt_id, question_id, option_id) VALUES (?, ?, ?)',
      attemptId,
      q.id,
      optionId,
    );

  it('seed is idempotent and enforces one correct option per question', () => {
    expect(seedQuizzes([]).quizzes).toBe(0);
    const q = questions[0];
    expect(() => query.run('UPDATE quiz_options SET is_correct = 1 WHERE id = ?', q.wrongId)).toThrow(/UNIQUE/i);
  });

  it('snapshots quiz info and question count when an attempt starts', () => {
    const id = startAttempt();
    expect(query.get('SELECT * FROM quiz_attempts WHERE id = ?', id)).toMatchObject({
      quiz_title: 'Mini quiz',
      roadmap_slug: 'frontend',
      topic_key: '101-html',
      total_questions: 4,
      pass_percent: 50,
      score: 0,
    });
  });

  it('calculates score, percent and pass/fail automatically', () => {
    const id = startAttempt();
    answer(id, questions[0], questions[0].correctId); // correct
    answer(id, questions[1], questions[1].correctId); // correct
    answer(id, questions[2], questions[2].wrongId); // wrong
    answer(id, questions[3], null); // skipped = wrong

    expect(query.get('SELECT score, total_questions, percent, passed FROM quiz_attempts WHERE id = ?', id)).toEqual({
      score: 2,
      total_questions: 4,
      percent: 50,
      passed: 1, // 50% >= pass_percent 50
    });

    query.run(`UPDATE quiz_attempts SET submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, id);
    expect(query.get('SELECT duration_seconds FROM quiz_attempts WHERE id = ?', id).duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it('marks a low score as failed', () => {
    const id = startAttempt();
    answer(id, questions[0], questions[0].correctId);
    answer(id, questions[1], questions[1].wrongId);
    answer(id, questions[2], questions[2].wrongId);
    const row = query.get('SELECT score, percent, passed FROM quiz_attempts WHERE id = ?', id);
    expect(row).toEqual({ score: 1, percent: 25, passed: 0 });
  });

  it('blocks tampering: forged is_correct, wrong option, duplicate answer, edits after submit', () => {
    const id = startAttempt();
    expect(() =>
      query.run(
        'INSERT INTO quiz_attempt_answers (attempt_id, question_id, option_id, is_correct) VALUES (?, ?, ?, 1)',
        id,
        questions[0].id,
        questions[0].wrongId,
      ),
    ).toThrow(/computed automatically/);

    // option belongs to a different question
    expect(() => answer(id, questions[0], questions[1].correctId)).toThrow(/option does not belong/);

    answer(id, questions[0], questions[0].correctId);
    expect(() => answer(id, questions[0], questions[0].correctId)).toThrow(/UNIQUE/i);
    expect(() => query.run('UPDATE quiz_attempt_answers SET is_correct = 1 WHERE attempt_id = ?', id)).toThrow(
      /immutable/,
    );

    query.run(`UPDATE quiz_attempts SET submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, id);
    expect(() => answer(id, questions[1], questions[1].correctId)).toThrow(/already submitted/);
  });

  it('exposes history and per-quiz stats for finished attempts only', () => {
    const history = query.all('SELECT * FROM v_quiz_history WHERE user_id = ?', uid);
    expect(history).toHaveLength(2); // the 50% attempt + the tamper-test attempt
    const stats = query.get('SELECT * FROM v_quiz_stats WHERE user_id = ? AND quiz_id = ?', uid, quizId);
    expect(stats.attempts).toBe(2);
    expect(stats.best_percent).toBe(50);
    expect(stats.ever_passed).toBe(1);
  });

  it('keeps history readable after the quiz is deleted', () => {
    query.run('DELETE FROM quizzes WHERE id = ?', quizId);
    const history = query.all('SELECT quiz_id, quiz_title, percent FROM v_quiz_history WHERE user_id = ?', uid);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toMatchObject({ quiz_id: null, quiz_title: 'Mini quiz' });
  });

  it('refuses attempts on a missing or inactive quiz', () => {
    expect(() => query.run('INSERT INTO quiz_attempts (user_id, quiz_id) VALUES (?, 99999)', uid)).toThrow(
      /quiz must exist/,
    );
  });
});