import { error } from '@sveltejs/kit';
import type { Actor } from './authz';
import type { Upload } from './db/schema';
import type { UploadView } from '../uploads';

/**
 * 404, never 403. A 403 would confirm the record exists, letting Hospital B
 * walk upload ids and learn what Hospital A has. One function, so the refusals
 * cannot drift apart later.
 */
export function notFound(): never {
	error(404, 'Upload not found.');
}

/** Only happens when the dev user cookie names nobody. Not keyed by an upload
 *  id, so it leaks nothing. */
export function requireActor(actor: Actor | null): Actor {
	if (!actor) error(401, 'No user selected.');
	return actor;
}

/**
 * What the browser is allowed to see. Not the whole row: objectKey and
 * companyId stay server-side, so they cannot end up in devtools or a log.
 */
export function toUploadView(row: Upload): UploadView {
	return {
		id: row.id,
		sampleId: row.sampleId,
		filename: row.filename,
		classification: row.classification,
		status: row.status,
		sizeBytes: row.sizeBytes,
		contentType: row.contentType,
		failureReason: row.failureReason,
		createdAt: row.createdAt.toISOString()
	};
}
