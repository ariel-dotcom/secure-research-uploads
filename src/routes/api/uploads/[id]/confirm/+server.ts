import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { uploads } from '$lib/server/db/schema';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { statObject } from '$lib/server/storage';
import { startSimulatedProcessing } from '$lib/server/processing';
import { requireActor, toUploadView } from '$lib/server/responses';
import type { RequestHandler } from './$types';

/**
 * Step two: the browser says it finished, and the server checks.
 *
 * Nothing in the request body is used - the key is read off the record the
 * server created. Accepting one from the browser would let a caller confirm
 * against somebody else's object.
 *
 * Idempotent, because browsers retry and users double-click: only a `pending`
 * record advances, and one that has moved on is returned unchanged.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);

	// Same lookup-and-refuse path as every other id-keyed route.
	const row = await requireAccessibleUpload(actor, params.id);

	// Already confirmed: no second record, and never dragged backwards.
	if (row.status !== 'pending') {
		return json({ upload: toUploadView(row) });
	}

	const stored = await statObject(row.objectKey);

	if (!stored) {
		// Stays `pending` rather than `failed`, because this is retryable - the
		// user can upload again against a fresh URL.
		error(400, 'The file did not finish uploading. Please try again.');
	}

	// Conditional, so two racing confirms cannot both advance the record. The
	// loser gets no row back and falls through to returning current state.
	const [updated] = await db
		.update(uploads)
		.set({
			status: 'uploaded',
			sizeBytes: stored.sizeBytes,
			contentType: stored.contentType,
			updatedAt: new Date()
		})
		.where(and(eq(uploads.id, row.id), eq(uploads.status, 'pending')))
		.returning();

	if (!updated) {
		const [current] = await db.select().from(uploads).where(eq(uploads.id, row.id)).limit(1);
		return json({ upload: toUploadView(current) });
	}

	startSimulatedProcessing(updated.id, updated.sampleId);

	return json({ upload: toUploadView(updated) });
};
