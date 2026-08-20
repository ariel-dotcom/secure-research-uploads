import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { isHttpError, type HttpError, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { ensureBucket } from './storage';
import { uploads } from './db/schema';
import { seedDevData, SEED } from './db/seed';
import type { Actor } from './authz';

/**
 * Shared plumbing for the integration tests, which run against the real
 * Postgres and MinIO. What is worth proving here - policy limits, URL expiry,
 * a missing object - are all storage behaviour; a mock would only prove the
 * mock agrees with me.
 */

export const HOSPITAL_A = SEED.companies[0].id;
export const HOSPITAL_B = SEED.companies[1].id;

/** Dana works at Hospital A. */
export const dana: Actor = { userId: SEED.users[0].id, companyId: HOSPITAL_A };

/** Ben works at Hospital B, and should never see anything of Dana's. */
export const ben: Actor = { userId: SEED.users[1].id, companyId: HOSPITAL_B };

/** Well-formed but never issued. Refusals are compared against it. */
export const NEVER_ISSUED_ID = '99999999-9999-4999-8999-999999999999';

/** Without this the first case dies in a wall of ECONNREFUSED stack traces. */
async function requireServices(): Promise<void> {
	try {
		await db.execute(sql`select 1`);
	} catch {
		throw new Error(notRunning('Postgres'));
	}

	try {
		await ensureBucket();
	} catch {
		throw new Error(notRunning('MinIO'));
	}
}

function notRunning(service: string): string {
	return [
		`${service} is not reachable.`,
		'These tests run against the real services, so start them first:',
		'',
		'  docker compose up -d',
		'',
		'then run the tests again.'
	].join('\n');
}

export async function prepareDatabase(): Promise<void> {
	await requireServices();
	// Idempotent: drizzle records which migrations it has already applied.
	await migrate(db, { migrationsFolder: 'drizzle' });
	await seedDevData(db);
}

/** Companies and users stay; only the uploads change between cases. */
export async function resetUploads(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE uploads`);
}

/**
 * Calls handlers directly rather than driving a live server over HTTP. The
 * thing under test is the authorization decision, which is the same function
 * either way; the extra machinery would only buy realism about routing.
 *
 * The return type is inferred from the call site, since every route has its own
 * generated params type and one concrete type would not satisfy them all.
 */
export function requestEvent<Event = RequestEvent>(options: {
	actor: Actor | null;
	params?: Record<string, string>;
	body?: unknown;
	method?: string;
}): Event {
	const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');

	return {
		request: new Request('http://localhost/api/uploads', {
			method,
			headers: { 'content-type': 'application/json' },
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		}),
		locals: { actor: options.actor },
		params: options.params ?? {},
		url: new URL('http://localhost/api/uploads')
	} as unknown as Event;
}

/**
 * SvelteKit's error() throws rather than returns, so without this every refusal
 * case is a try/catch that could silently pass if the handler stopped refusing.
 */
export async function refusal(run: () => unknown): Promise<HttpError> {
	try {
		await run();
	} catch (thrown) {
		if (isHttpError(thrown)) return thrown;
		throw thrown;
	}

	throw new Error('Expected the handler to refuse, but it returned a response.');
}

/** Reads the JSON body out of a handler's Response. */
export async function bodyOf<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

/** Exactly what the browser does: multipart POST, policy fields first. */
export async function sendBytesToStorage(
	presigned: { postURL: string; formData: Record<string, string> },
	bytes: Uint8Array<ArrayBuffer>,
	filename: string,
	contentType: string
): Promise<Response> {
	const form = new FormData();

	for (const [name, value] of Object.entries(presigned.formData)) {
		form.append(name, value);
	}
	form.append('file', new Blob([bytes], { type: contentType }), filename);

	return fetch(presigned.postURL, { method: 'POST', body: form });
}

/** A tiny but real PNG. */
export const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82
]);

export { uploads, db };
