// The only file that holds MinIO credentials.
import * as Minio from 'minio';
import { config, UPLOAD_URL_TTL_SECONDS, DOWNLOAD_URL_TTL_SECONDS } from './config';
import { MAX_UPLOAD_BYTES } from '../uploads';

const client = new Minio.Client({
	endPoint: config.minio.endPoint,
	port: config.minio.port,
	useSSL: config.minio.useSSL,
	accessKey: config.minio.accessKey,
	secretKey: config.minio.secretKey
});

const bucket = config.minio.bucket;

// Created on first use, not at import time, so the app still starts if MinIO
// is a few seconds behind it. Cached, so the check runs once per process.
let bucketReady: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
	if (!bucketReady) {
		bucketReady = (async () => {
			if (!(await client.bucketExists(bucket))) {
				await client.makeBucket(bucket);
			}
			// No bucket policy is set. A new MinIO bucket is private by default,
			// and a public-read policy here would break the whole security model.
		})().catch((error) => {
			// Do not cache a failure - the next request should retry.
			bucketReady = null;
			throw error;
		});
	}
	return bucketReady;
}

/**
 * A POST policy rather than a presigned PUT, because a PUT cannot constrain
 * upload size. The conditions are signed, so MinIO enforces them itself:
 * one key, one content type, under the size limit, for five minutes.
 */
export async function createPresignedUpload(objectKey: string, contentType: string) {
	await ensureBucket();

	const policy = client.newPostPolicy();
	policy.setBucket(bucket);
	// Exact key, not a prefix: a different value fails the signature check.
	policy.setKey(objectKey);
	policy.setContentType(contentType);
	// The 1-byte minimum also rejects an empty file.
	policy.setContentLengthRange(1, MAX_UPLOAD_BYTES);
	policy.setExpires(new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000));

	const { postURL, formData } = await client.presignedPostPolicy(policy);
	return { postURL, formData };
}

/**
 * Callers must have checked authorization already: this has no idea who is
 * asking and will sign anything handed to it. That separation is the point.
 *
 * ttlSeconds is only for the expiry test; every route takes the default.
 */
export async function createPresignedDownload(
	objectKey: string,
	downloadFilename: string,
	ttlSeconds: number = DOWNLOAD_URL_TTL_SECONDS
): Promise<string> {
	await ensureBucket();

	return client.presignedGetObject(bucket, objectKey, ttlSeconds, {
		'response-content-disposition': contentDisposition(downloadFilename)
	});
}

/**
 * Restores the user's original filename. Two forms because these are not all
 * ASCII - `filename*=UTF-8''` (RFC 5987) carries the real name, the plain one
 * is a fallback. Encoding both also strips quotes that could break the header.
 */
function contentDisposition(filename: string): string {
	const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

	return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Size and content type of a stored object, or null if it is not there. */
export async function statObject(
	objectKey: string
): Promise<{ sizeBytes: number; contentType: string | null } | null> {
	await ensureBucket();

	try {
		const stat = await client.statObject(bucket, objectKey);
		return {
			sizeBytes: stat.size,
			contentType: stat.metaData?.['content-type'] ?? null
		};
	} catch (error) {
		// Only "no such object" means absent. Anything else is a real failure and
		// must not be swallowed into a silent "the file isn't there".
		const code = (error as { code?: string }).code;
		if (code === 'NotFound' || code === 'NoSuchKey') return null;
		throw error;
	}
}

/** Test helper. */
export async function removeObject(objectKey: string): Promise<void> {
	await ensureBucket();
	await client.removeObject(bucket, objectKey);
}
