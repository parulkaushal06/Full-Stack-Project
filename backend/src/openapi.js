/**
 * OpenAPI 3.1 description of the whole v1 API.
 * Served as JSON at GET /api/openapi.json and rendered by Swagger UI at
 * GET /api/docs (docs/API_DOCUMENTATION.md).
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'roadmap.sh API',
    version: '1.0.0',
    description: [
      'RESTful API for the rebuilt roadmap.sh frontend.',
      '',
      '**Design conventions**',
      '- Resource oriented URLs under a URI version prefix `/api/v1`',
      '- Statelessness: every request carries its identity (session cookie or Bearer JWT)',
      '- Error body: `{ "error": { "code", "message", "details?" } }` (OAuth endpoints use RFC 6749 `{ error, error_description }`)',
      '- Collection responses: `{ "data": [...], "meta": { page, limit, total, totalPages }, "links": {...} }`',
      '- `GET` responses are cacheable (ETag / Cache-Control) and may answer `304 Not Modified`',
      '- Mutations accept an `Idempotency-Key` header where noted',
      '- Rate limits are advertised via `X-RateLimit-*` and `429 Too Many Requests`',
    ].join('\n'),
    license: { name: 'MIT', url: 'https://github.com/RoboSchmied/kamranahmedse-developer-roadmap' },
  },
  servers: [{ url: '/', description: 'Current host' }],
  tags: [
    { name: 'Health', description: 'Service status' },
    { name: 'Roadmaps', description: 'Roadmap collection and its topics' },
    { name: 'Auth', description: 'Registration, login, token refresh, logout' },
    { name: 'Me', description: 'Per-user progress (private)' },
    { name: 'OAuth 2.0', description: 'Authorization code + client credentials flows' },
  ],
  paths: {
    '/api/v1/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Service status including cache statistics',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
    '/api/v1/roadmaps': {
      get: {
        tags: ['Roadmaps'],
        summary: 'List roadmaps (paginated, filterable, sortable)',
        security: [],
        parameters: [
          { $ref: '#/components/parameters/page' },
          { $ref: '#/components/parameters/limit' },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Matches title / brief title / description' },
          { name: 'category', in: 'query', schema: { $ref: '#/components/schemas/Category' } },
          { name: 'tag', in: 'query', schema: { type: 'string', maxLength: 40 } },
          { name: 'difficulty', in: 'query', schema: { $ref: '#/components/schemas/Difficulty' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['title', 'order', 'category', 'difficulty', 'created_at', 'updated_at'], default: 'order' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
          { name: 'If-None-Match', in: 'header', schema: { type: 'string' }, description: 'Conditional request; 304 when the ETag still matches' },
        ],
        responses: {
          200: {
            description: 'Paginated collection',
            headers: {
              ETag: { schema: { type: 'string' } },
              'X-Cache': { schema: { type: 'string', enum: ['HIT', 'MISS'] }, description: 'cache-aside result' },
              'Cache-Control': { schema: { type: 'string' } },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapCollection' } } },
          },
          304: { description: 'Not modified (ETag match)' },
          429: { $ref: '#/components/responses/TooManyRequests' },
        },
      },
      post: {
        tags: ['Roadmaps'],
        summary: 'Create a roadmap (admin only)',
        description: 'Supports the `Idempotency-Key` header: retrying the same request replays the original response.',
        parameters: [{ $ref: '#/components/parameters/idempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapWrite' } } },
        },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' } }, 'Idempotency-Replayed': { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapResponse' } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/api/v1/roadmaps/{slug}': {
      parameters: [{ $ref: '#/components/parameters/slug' }],
      get: {
        tags: ['Roadmaps'],
        summary: 'Roadmap details',
        security: [],
        parameters: [{ name: 'If-None-Match', in: 'header', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Single roadmap with topic/article counts',
            headers: { ETag: { schema: { type: 'string' } }, 'X-Cache': { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapResponse' } } },
          },
          304: { description: 'Not modified' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['Roadmaps'],
        summary: 'Replace a roadmap (admin only, idempotent)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapWrite' } } } },
        responses: {
          200: { description: 'Replaced', content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapResponse' } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
      patch: {
        tags: ['Roadmaps'],
        summary: 'Partially update a roadmap (admin only)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapPatch' } } } },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadmapResponse' } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Roadmaps'],
        summary: 'Delete a roadmap (admin only, idempotent)',
        responses: {
          204: { description: 'Deleted (repeat deletes are also 204)' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/api/v1/roadmaps/{slug}/topics': {
      parameters: [{ $ref: '#/components/parameters/slug' }],
      get: {
        tags: ['Roadmaps'],
        summary: 'List the topics of a roadmap',
        security: [],
        responses: {
          200: {
            description: 'Ordered topic list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/TopicSummary' } } } } } },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/roadmaps/{slug}/topics/{topicKey}': {
      parameters: [{ $ref: '#/components/parameters/slug' }, { $ref: '#/components/parameters/topicKey' }],
      get: {
        tags: ['Roadmaps'],
        summary: 'Topic content with its resource articles',
        security: [],
        responses: {
          200: {
            description: 'Topic including rendered HTML for the markdown content',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/TopicDetail' } } } } },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account (starts a session and returns tokens)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterInput' } } },
        },
        responses: {
          201: {
            description: 'Account created; `Set-Cookie: sid` + `rt` are issued',
            headers: { 'Set-Cookie': { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email/username + password',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } },
        },
        responses: {
          200: {
            description: 'Signed in; session cookie + token pair issued',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { $ref: '#/components/responses/TooManyRequests', description: 'Brute-force protection (5 attempts / 15 min / identifier)' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token and get a new access token',
        security: [],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: {
          200: { description: 'New token pair', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          401: { $ref: '#/components/responses/Unauthorized', description: 'Invalid/expired/reused refresh token (reuse revokes the family)' },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'End the current session and revoke the refresh token',
        responses: {
          204: { description: 'Signed out' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/auth/logout-all': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke every session and token of the current user',
        responses: {
          204: { description: 'All sessions revoked' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current identity (session cookie or Bearer JWT)',
        responses: {
          200: {
            description: 'The signed-in user',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' }, authType: { type: 'string', enum: ['session', 'jwt'] } } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/me/progress': {
      get: {
        tags: ['Me'],
        summary: 'All roadmap progress of the signed-in user',
        responses: {
          200: {
            description: 'Progress rows',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Progress' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/me/progress/{slug}': {
      parameters: [{ $ref: '#/components/parameters/slug' }],
      get: {
        tags: ['Me'],
        summary: 'Progress summary for one roadmap',
        responses: {
          200: { description: 'Summary with percentage', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ProgressSummary' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/me/progress/{slug}/{topicKey}': {
      parameters: [{ $ref: '#/components/parameters/slug' }, { $ref: '#/components/parameters/topicKey' }],
      put: {
        tags: ['Me'],
        summary: 'Mark a topic (idempotent upsert)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['done', 'learning', 'skipped'], default: 'done' } } } } } },
        responses: {
          200: { description: 'Saved state', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Progress' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Me'],
        summary: 'Clear the topic progress (idempotent)',
        responses: {
          204: { description: 'Cleared (even when nothing existed)' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/oauth/clients': {
      post: {
        tags: ['OAuth 2.0'],
        summary: 'Register an OAuth client application',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthClientInput' } } } },
        responses: {
          201: { description: 'Client created; `clientSecret` is returned exactly once', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/OAuthClient' } } } } } },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      get: {
        tags: ['OAuth 2.0'],
        summary: 'List your OAuth clients',
        responses: {
          200: { description: 'Client list (no secrets)', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/OAuthClient' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/oauth/authorize': {
      get: {
        tags: ['OAuth 2.0'],
        summary: 'Authorization code endpoint (browser redirect flow)',
        description: 'Redirects the signed-in user back to `redirect_uri` with `code` and `state`. Signed-out users are sent to `/login.html?next=...` first. PKCE S256 is supported and recommended.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'response_type', in: 'query', required: true, schema: { type: 'string', enum: ['code'] } },
          { name: 'client_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
          { name: 'state', in: 'query', schema: { type: 'string' } },
          { name: 'code_challenge', in: 'query', schema: { type: 'string' } },
          { name: 'code_challenge_method', in: 'query', schema: { type: 'string', enum: ['S256', 'plain'], default: 'S256' } },
        ],
        responses: {
          302: { description: 'Redirect to redirect_uri?code=...&state=... (or to login when signed out)' },
          400: { description: 'OAuth error envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthError' } } } },
        },
      },
    },
    '/api/v1/oauth/token': {
      post: {
        tags: ['OAuth 2.0'],
        summary: 'Token endpoint (authorization_code + client_credentials)',
        description: 'RFC 6749 token endpoint. Supports PKCE (`code_verifier`) for the authorization code grant.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: { $ref: '#/components/schemas/TokenRequest' },
            },
            'application/json': { schema: { $ref: '#/components/schemas/TokenRequest' } },
          },
        },
        responses: {
          200: { description: 'Access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenResponse' } } } },
          400: { description: 'OAuth error envelope (invalid_request / invalid_grant / unauthorized_client)', content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthError' } } } },
          401: { description: 'invalid_client', content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthError' } } } },
          429: { $ref: '#/components/responses/TooManyRequests' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sid', description: 'Server side session cookie (browser)' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from /auth/login, /auth/refresh or /oauth/token' },
    },
    parameters: {
      page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
      slug: { name: 'slug', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
      topicKey: { name: 'topicKey', in: 'path', required: true, schema: { type: 'string' } },
      idempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 }, description: 'Replay protection for retried POSTs' },
    },
    responses: {
      ValidationError: {
        description: 'Validation failed',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
      },
      Unauthorized: {
        description: 'Not authenticated (or bad credentials)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated but not allowed (RBAC / origin check)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'Conflict (duplicate slug/email/username)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unprocessable: {
        description: 'Semantically invalid (e.g. Idempotency-Key reuse with a different payload)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      TooManyRequests: {
        description: 'Rate limit exceeded',
        headers: { 'Retry-After': { schema: { type: 'integer' } }, 'X-RateLimit-Limit': { schema: { type: 'integer' } } },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'roadmap_not_found' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
            },
          },
        },
      },
      ValidationError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'validation_error' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
            },
          },
        },
      },
      OAuthError: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'invalid_grant' },
          error_description: { type: 'string' },
        },
      },
      Category: { type: 'string', enum: ['role', 'language', 'framework', 'tool', 'database', 'concept', 'other'] },
      Difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      Roadmap: {
        type: 'object',
        properties: {
          slug: { type: 'string', example: 'frontend' },
          title: { type: 'string', example: 'Frontend Developer' },
          brief_title: { type: 'string' },
          description: { type: 'string' },
          category: { $ref: '#/components/schemas/Category' },
          difficulty: { $ref: '#/components/schemas/Difficulty' },
          tag: { type: 'string', example: 'web' },
          order: { type: 'integer', description: 'Editorial order (alias of order_index)' },
          image_url: { type: ['string', 'null'] },
          article_md: { type: ['string', 'null'], description: 'Markdown article ("What is X?")' },
          is_forkable: { type: 'integer', enum: [0, 1] },
          has_topics: { type: 'integer', enum: [0, 1] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      RoadmapDetail: {
        allOf: [
          { $ref: '#/components/schemas/Roadmap' },
          { type: 'object', properties: { topics_count: { type: 'integer' }, articles_count: { type: 'integer' } } },
        ],
      },
      RoadmapWrite: {
        type: 'object',
        required: ['slug', 'title'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          title: { type: 'string', maxLength: 120 },
          briefTitle: { type: 'string', maxLength: 120 },
          description: { type: 'string', maxLength: 600 },
          category: { $ref: '#/components/schemas/Category' },
          difficulty: { $ref: '#/components/schemas/Difficulty' },
          tag: { type: 'string' },
          order: { type: 'integer', minimum: 0 },
          isForkable: { type: 'boolean' },
          hasTopics: { type: 'boolean' },
          articleMd: { type: 'string' },
          imageUrl: { type: 'string' },
        },
      },
      RoadmapPatch: {
        type: 'object',
        minProperties: 1,
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          briefTitle: { type: 'string' },
          description: { type: 'string' },
          category: { $ref: '#/components/schemas/Category' },
          difficulty: { $ref: '#/components/schemas/Difficulty' },
          tag: { type: 'string' },
          order: { type: 'integer' },
          isForkable: { type: 'boolean' },
          hasTopics: { type: 'boolean' },
          articleMd: { type: 'string' },
          imageUrl: { type: 'string' },
        },
      },
      RoadmapCollection: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Roadmap' } },
          meta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
          links: { type: 'object', properties: { self: { type: 'string' }, prev: { type: 'string' }, next: { type: 'string' } } },
        },
      },
      RoadmapResponse: { type: 'object', properties: { data: { $ref: '#/components/schemas/RoadmapDetail' } } },
      TopicSummary: {
        type: 'object',
        properties: {
          topic_key: { type: 'string', example: '102-css' },
          label: { type: 'string', example: 'CSS' },
          order_index: { type: 'integer' },
          article_count: { type: 'integer' },
        },
      },
      TopicDetail: {
        type: 'object',
        properties: {
          topic_key: { type: 'string' },
          label: { type: 'string' },
          order_index: { type: 'integer' },
          content_md: { type: ['string', 'null'] },
          contentHtml: { type: ['string', 'null'], description: 'Server-rendered markdown (trusted repo content)' },
          articles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                article_key: { type: 'string' },
                title: { type: 'string' },
                content_md: { type: 'string' },
                contentHtml: { type: 'string' },
              },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          username: { type: 'string' },
          role: { type: 'string', enum: ['user', 'admin'] },
        },
      },
      RegisterInput: {
        type: 'object',
        required: ['email', 'username', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          username: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,30}$' },
          password: { type: 'string', minLength: 8, maxLength: 72, description: 'needs a letter and a number' },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['identifier', 'password'],
        properties: {
          identifier: { type: 'string', description: 'email or username' },
          password: { type: 'string' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              accessToken: { type: 'string', description: 'JWT, 15 minutes, send as Authorization: Bearer' },
              refreshToken: { type: 'string', description: 'rotating JWT, 7 days (also set as httpOnly cookie `rt`)' },
              tokenType: { type: 'string', example: 'Bearer' },
              expiresIn: { type: 'integer', example: 900 },
            },
          },
        },
      },
      Progress: {
        type: 'object',
        properties: {
          roadmapSlug: { type: 'string' },
          topicKey: { type: 'string' },
          status: { type: 'string', enum: ['done', 'learning', 'skipped'] },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProgressSummary: {
        type: 'object',
        properties: {
          roadmapSlug: { type: 'string' },
          totalTopics: { type: 'integer' },
          done: { type: 'integer' },
          learning: { type: 'integer' },
          percent: { type: 'integer' },
          topics: { type: 'array', items: { $ref: '#/components/schemas/Progress' } },
        },
      },
      OAuthClientInput: {
        type: 'object',
        required: ['name', 'redirectUri'],
        properties: {
          name: { type: 'string' },
          redirectUri: { type: 'string', format: 'uri' },
          grantTypes: { type: 'array', items: { type: 'string', enum: ['authorization_code', 'client_credentials'] }, default: ['authorization_code'] },
          scopes: { type: 'array', items: { type: 'string', enum: ['read', 'write'] }, default: ['read'] },
        },
      },
      OAuthClient: {
        type: 'object',
        properties: {
          clientId: { type: 'string' },
          clientSecret: { type: 'string', description: 'returned only once, at creation' },
          name: { type: 'string' },
          redirectUri: { type: 'string' },
          grantTypes: { type: 'array', items: { type: 'string' } },
          scopes: { type: 'array', items: { type: 'string' } },
        },
      },
      TokenRequest: {
        type: 'object',
        required: ['grant_type', 'client_id'],
        properties: {
          grant_type: { type: 'string', enum: ['authorization_code', 'client_credentials'] },
          code: { type: 'string', description: 'authorization_code grant' },
          redirect_uri: { type: 'string', description: 'authorization_code grant' },
          code_verifier: { type: 'string', description: 'PKCE verifier' },
          client_id: { type: 'string' },
          client_secret: { type: 'string' },
          scope: { type: 'string' },
        },
      },
      TokenResponse: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'integer', example: 900 },
          scope: { type: 'string' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          version: { type: 'string', example: 'v1' },
          uptimeSeconds: { type: 'integer' },
          database: { type: 'string', enum: ['up', 'down'] },
          cache: { type: 'object', properties: { hits: { type: 'integer' }, misses: { type: 'integer' }, size: { type: 'integer' }, hitRate: { type: 'number' } } },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
};

export default openApiSpec;
