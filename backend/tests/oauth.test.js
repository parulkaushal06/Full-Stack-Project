import crypto from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp, client, adminCreds } from './helpers.js';

function sha256base64url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

describe('OAuth 2.0 - client registration', () => {
  let app;
  let admin;

  beforeAll(async () => {
    app = setupTestApp();
    admin = client(app);
    await admin.post('/api/v1/auth/login').send(adminCreds).expect(200);
  });

  it('requires auth to register a client', async () => {
    await client(app)
      .post('/api/v1/oauth/clients')
      .send({ name: 'X', redirectUri: 'https://x.example/cb' })
      .expect(401);
  });

  it('creates a client and shows the secret exactly once', async () => {
    const res = await admin
      .post('/api/v1/oauth/clients')
      .send({
        name: 'Mobile App',
        redirectUri: 'https://mobile.example/callback',
        grantTypes: ['authorization_code', 'client_credentials'],
        scopes: ['read', 'write'],
      })
      .expect(201);

    expect(res.body.data.clientId).toMatch(/^cli_/);
    expect(res.body.data.clientSecret).toBeTruthy();

    const list = await admin.get('/api/v1/oauth/clients').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('clientSecret');
  });
});

describe('OAuth 2.0 - authorization code flow with PKCE', () => {
  let app;
  let admin;
  let clientId;
  let clientSecret;
  const redirectUri = 'https://app.example/callback';

  beforeAll(async () => {
    app = setupTestApp();
    admin = client(app);
    await admin.post('/api/v1/auth/login').send(adminCreds).expect(200);

    const res = await admin
      .post('/api/v1/oauth/clients')
      .send({
        name: 'PKCE App',
        redirectUri,
        grantTypes: ['authorization_code', 'client_credentials'],
        scopes: ['read', 'write'],
      })
      .expect(201);
    clientId = res.body.data.clientId;
    clientSecret = res.body.data.clientSecret;
  });

  it('sends signed-out users to the login page first', async () => {
    const res = await client(app)
      .get(
        `/api/v1/oauth/authorize?response_type=code&client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}&state=abc`,
      )
      .expect(302);
    expect(res.headers.location).toContain('/login.html?next=');
  });

  it('rejects a redirect_uri that is not the registered one', async () => {
    const res = await admin
      .get(
        `/api/v1/oauth/authorize?response_type=code&client_id=${clientId}` +
          '&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&state=abc',
      )
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('redirects back with a code + state, exchanges it for an access token (PKCE)', async () => {
    const verifier = 'test-verifier-0123456789abcdef';
    const challenge = sha256base64url(verifier);

    const redirect = await admin
      .get(
        `/api/v1/oauth/authorize?response_type=code&client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}&state=xyz123` +
          `&code_challenge=${challenge}&code_challenge_method=S256`,
      )
      .expect(302);

    const location = new URL(redirect.headers.location);
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get('state')).toBe('xyz123');
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();

    // wrong verifier must fail
    const bad = await client(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: 'wrong-verifier-xxxxxxxxxxxx',
      })
      .expect(400);
    expect(bad.body.error).toBe('invalid_grant');

    // correct verifier succeeds
    const ok = await client(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      })
      .expect(200);
    expect(ok.body.token_type).toBe('Bearer');
    expect(ok.body.expires_in).toBe(900);
    expect(ok.body.scope).toBe('read write');

    // the access token works as a Bearer token
    const me = await client(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ok.body.access_token}`)
      .expect(200);
    expect(me.body.data.authType).toBe('jwt');

    // codes are single use
    const replay = await client(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      })
      .expect(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('rejects unsupported grant types and bad responses', async () => {
    const badType = await client(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'password', client_id: clientId })
      .expect(400);
    expect(badType.body.error.code).toBe('validation_error');

    const badResponseType = await admin
      .get(
        `/api/v1/oauth/authorize?response_type=token&client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}`,
      )
      .expect(400);
    expect(badResponseType.body.error).toBe('invalid_request');
  });
});

describe('OAuth 2.0 - client credentials flow', () => {
  let app;
  let clientId;
  let clientSecret;

  beforeAll(async () => {
    app = setupTestApp();
    const admin = client(app);
    await admin.post('/api/v1/auth/login').send(adminCreds).expect(200);

    const res = await admin
      .post('/api/v1/oauth/clients')
      .send({
        name: 'CI Bot',
        redirectUri: 'https://ci.example/noop',
        grantTypes: ['client_credentials'],
        scopes: ['read'],
      })
      .expect(201);
    clientId = res.body.data.clientId;
    clientSecret = res.body.data.clientSecret;
  });

  it('issues a token for valid machine credentials', async () => {
    const res = await client(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
      .expect(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.scope).toBe('read');
  });

  it('401s invalid client secrets (invalid_client)', async () => {
    const res = await client(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: 'nope' })
      .expect(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('401s unknown client ids', async () => {
    const res = await client(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: 'cli_missing', client_secret: 'x' })
      .expect(401);
    expect(res.body.error).toBe('invalid_client');
  });
});
