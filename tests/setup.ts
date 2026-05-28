// Set required env vars before any module loads config
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.HMAC_REQUIRED = "false";
