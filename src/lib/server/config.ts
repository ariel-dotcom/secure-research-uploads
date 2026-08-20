// One place that reads the environment, so that the app, the test suite and
// the seed script all agree on where Postgres and MinIO are.
//
// This reads `process.env` rather than SvelteKit's `$env/dynamic/private`
// because the seed script and the tests run outside SvelteKit and cannot
// import `$env`. SvelteKit loads .env into process.env for the dev server;
// the tests and the seed script load it with dotenv themselves.

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env.`);
	}
	return value;
}

export const config = {
	databaseUrl: required('DATABASE_URL'),
	minio: {
		endPoint: required('MINIO_ENDPOINT'),
		port: Number(required('MINIO_PORT')),
		useSSL: required('MINIO_USE_SSL') === 'true',
		accessKey: required('MINIO_ACCESS_KEY'),
		secretKey: required('MINIO_SECRET_KEY'),
		bucket: required('MINIO_BUCKET')
	}
};

// --- Upload limits -----------------------------------------------------
// These are baked into the presigned upload policy, so MinIO rejects an
// upload that breaks them before a single byte reaches the database.

/** 25 MB. Large enough for a research scan, small enough that a mistaken or
 *  malicious upload cannot fill the disk. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Formats a research imaging workflow actually produces. An allowlist rather
 *  than a blocklist: anything not named here is rejected by default. */
export const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/tiff'] as const;

/** 5 minutes: has to cover a 25 MB upload on a slow link. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** 60 seconds: the browser follows it immediately, so it only needs to survive
 *  one round trip. A leaked download URL is stale a minute later. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;
