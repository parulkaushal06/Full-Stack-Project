// Runs before every test file is imported (vitest setupFiles).
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:'; // fresh SQLite per test file/worker
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_TTL = '15m';
// Generous global API limit so unrelated tests never trip it; the dedicated
// login/register limiters stay at their real (small) values to be testable.
process.env.RATE_LIMIT_MAX = '100000';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
process.env.REGISTER_RATE_LIMIT_MAX = '100';
