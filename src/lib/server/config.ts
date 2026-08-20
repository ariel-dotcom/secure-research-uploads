// The one place that reads the environment, so the app, the tests and the seed
// script agree on where Postgres and MinIO are.
//
// dotenv here rather than $env/dynamic/private, because the tests and the seed
// script run outside SvelteKit - and Vite does not put .env into process.env,
// which broke `vite build`. dotenv never overwrites an already-set variable,
// so a real deployment still wins.
import 'dotenv/config';

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

/** 5 minutes: has to cover a 25 MB upload on a slow link. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** 60 seconds: the browser follows it immediately, so it only needs to survive
 *  one round trip. A leaked download URL is stale a minute later. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;
