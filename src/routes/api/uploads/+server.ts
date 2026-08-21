import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { uploads } from '$lib/server/db/schema';
import { canAccess } from '$lib/server/authz';
import { buildObjectKey } from '$lib/server/object-key';
import { createPresignedUpload } from '$lib/server/storage';
import { validateUploadInput } from '$lib/server/validation';
import { requireActor, toUploadView } from '$lib/server/responses';
import type { RequestHandler } from './$types';

/**
 * The company filter is in the SQL because a list cannot ask per row without
 * fetching the whole table. canAccess() is still applied to what comes back:
 * the query narrows, the function decides.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const actor = requireActor(locals.actor);

	// The only read that does not go through requireAccessibleUpload(), so the
	// only place the soft-delete filter has to be repeated.
	const rows = await db
		.select()
		.from(uploads)
		.where(and(eq(uploads.companyId, actor.companyId), isNull(uploads.deletedAt)))
		.orderBy(desc(uploads.createdAt));

	return json({ uploads: rows.filter((row) => canAccess(actor, row)).map(toUploadView) });
};

/**
 * Step one: create the record, then hand back a presigned URL. The record must
 * exist first because its id is part of the object key.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const actor = requireActor(locals.actor);

	const body = await request.json().catch(() => null);
	const result = validateUploadInput(body);

	if (!result.ok) {
		return json({ errors: result.errors }, { status: 400 });
	}

	// Generated here rather than by the database, so the key can be built and
	// stored in one insert. Still server-side; the browser has no influence.
	const uploadId = crypto.randomUUID();

	// The company comes from the resolved actor, never the request body - which
	// makes a cross-company write impossible rather than merely checked.
	const objectKey = buildObjectKey(actor.companyId, uploadId, result.value.filename);

	// Row first, then sign. A failed signing leaves a visible `pending` record
	// the user can retry; the reverse would leave bytes in the bucket with no
	// record pointing at them.
	//
	// sizeBytes and contentType stay null until confirm reads them from MinIO.
	const [row] = await db
		.insert(uploads)
		.values({
			id: uploadId,
			sampleId: result.value.sampleId,
			filename: result.value.filename,
			classification: result.value.classification,
			companyId: actor.companyId,
			objectKey,
			status: 'pending'
		})
		.returning();

	const presignedUpload = await createPresignedUpload(objectKey, result.value.contentType);

	return json({ upload: toUploadView(row), presignedUpload }, { status: 201 });
};
