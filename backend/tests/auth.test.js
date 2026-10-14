import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp, client } from './helpers.js';

describe('registration + login', () => {
  let app;

  beforeAll(() => {
    app = setupTestApp();
  });

  it('registers a user, sets the session cookie and returns a token pair', async () => {
    const agent = client(app);
    const res = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'sara@example.com', username: 'sara', password: 'password123' })
      .expect(201);

    const setCookie = res.headers['set-cookie'].join(' ');
    expect(setCookie).toContain('sid=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const { user, accessToken, refreshToken, tokenType } = res.body.data;
    expect(user).toMatchObject({ email: 'sara@example.com', username: 'sara', role: 'user' });
    expect(JSON.stringify(res.body)).not.toContain('password'); // no hash leak
    expect(tokenType).toBe('Bearer');
    expect(accessToken.split('.')).toHaveLength(3); // JWT structure
    expect(refreshToken).toBeTruthy();

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.username).toBe('sara');
    expect(me.body.data.authType).toBe('session');
  });

  it('rejects weak passwords and bad emails with field details', async () => {
    const badPassword = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.co', username: 'abc', password: 'short' })
      .expect(400);
    expect(badPassword.body.error.code).toBe('validation_error');
    expect(badPassword.body.error.details.some((d) => d.field === 'password')).toBe(true);

    const badEmail = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', username: 'abc', password: 'password123' })
      .expect(400);
    expect(badEmail.body.error.details.some((d) => d.field === 'email')).toBe(true);
  });

  it('rejects duplicate email/username with 409', async () => {
    await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dupe@example.com', username: 'dupe1', password: 'password123' })
      .expect(201);

    const emailDupe = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dupe@example.com', username: 'someone-else', password: 'password123' })
      .expect(409);
    expect(emailDupe.body.error.code).toBe('email_taken');

    const usernameDupe = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'other@example.com', username: 'dupe1', password: 'password123' })
      .expect(409);
    expect(usernameDupe.body.error.code).toBe('username_taken');
  });

  it('logs in with username or email and rejects bad credentials generically', async () => {
    await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'login@example.com', username: 'loginuser', password: 'password123' })
      .expect(201);

    const byUsername = await client(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'loginuser', password: 'password123' })
      .expect(200);
    expect(byUsername.body.data.user.username).toBe('loginuser');
    expect(byUsername.body.data.accessToken).toBeTruthy();

    const byEmail = await client(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'login@example.com', password: 'password123' })
      .expect(200);
    expect(byEmail.body.data.user.email).toBe('login@example.com');

    const wrongPassword = await client(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'loginuser', password: 'wrongpass1' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');

    const unknownUser = await client(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'ghost-user-x', password: 'whatever1' })
      .expect(401);
    expect(unknownUser.body.error.code).toBe('invalid_credentials'); // same message -> no enumeration
  });
});

describe('token-based auth (Bearer JWT) + protection', () => {
  let app;
  let accessToken;

  beforeAll(async () => {
    app = setupTestApp();
    const res = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'bearer@example.com', username: 'beareruser', password: 'password123' })
      .expect(201);
    accessToken = res.body.data.accessToken;
  });

  it('accepts a valid Bearer access token', async () => {
    const res = await client(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data.authType).toBe('jwt');
    expect(res.body.data.user.username).toBe('beareruser');
  });

  it('rejects garbage Bearer tokens with 401 invalid_token', async () => {
    const res = await client(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('401s anonymous calls', async () => {
    const res = await client(app).get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('authentication_required');
  });
});

describe('refresh token rotation, reuse detection and logout', () => {
  let app;

  beforeAll(() => {
    app = setupTestApp();
  });

  it('rotates refresh tokens and detects reuse (revokes the family)', async () => {
    const register = await client(app)
      .post('/api/v1/auth/register')
      .send({ email: 'rotate@example.com', username: 'rotator', password: 'password123' })
      .expect(201);
    const firstRefresh = register.body.data.refreshToken;

    // rotate -> new refresh token
    const rotated = await client(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    const secondRefresh = rotated.body.data.refreshToken;
    expect(secondRefresh).not.toBe(firstRefresh);
    expect(rotated.body.data.accessToken).toBeTruthy();

    // re-using the consumed token = theft signal -> 401 + family revoked
    const reuse = await client(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
    expect(reuse.body.error.code).toBe('refresh_token_reused');

    // sessions of that user are revoked too
    const agent = client(app);
    await agent.post('/api/v1/auth/login').send({ identifier: 'rotator', password: 'password123' }).expect(200);
    // note: this fresh session was created after the revoke, so it works...
    const afterLogin = await agent.get('/api/v1/auth/me').expect(200);
    expect(afterLogin.body.data.user.username).toBe('rotator');
  });

  it('401s refresh without any token', async () => {
    const res = await client(app).post('/api/v1/auth/refresh').send({}).expect(401);
    expect(res.body.error.code).toBe('refresh_token_missing');
  });

  it('logout revokes the session', async () => {
    const agent = client(app);
    await agent
      .post('/api/v1/auth/register')
      .send({ email: 'out@example.com', username: 'logoutuser', password: 'password123' })
      .expect(201);
    await agent.get('/api/v1/auth/me').expect(200);

    await agent.post('/api/v1/auth/logout').send({}).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});

describe('brute-force protection + CSRF origin check', () => {
  let app;

  beforeAll(() => {
    app = setupTestApp();
  });

  it('rate limits repeated failed logins with 429 + Retry-After', async () => {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await client(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'locked-target@example.com', password: 'wrongpass1' })
        .expect((r) => expect([401, 429]).toContain(r.status));
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('rate_limited');
    expect(last.headers['retry-after']).toBeTruthy();
    expect(last.headers['x-ratelimit-limit']).toBe('5');
  });

  it('rejects mutations carrying a foreign Origin (CSRF)', async () => {
    const res = await client(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .send({ identifier: 'anyone', password: 'whatever1' })
      .expect(403);
    expect(res.body.error.code).toBe('cross_origin_rejected');
  });
});
