import 'dotenv/config';

/**
 * Runs before any test file is imported - the only moment this works, since
 * config.ts reads these on first import and a beforeAll() would be too late.
 *
 * Tests truncate between cases, so they get their own database and bucket.
 */
process.env.DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgres://research:research@localhost:5432/research_uploads_test';

process.env.MINIO_BUCKET = 'research-uploads-test';
