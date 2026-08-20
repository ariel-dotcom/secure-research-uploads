import { json, error } from '@sveltejs/kit';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { createPresignedDownload } from '$lib/server/storage';
import { requireActor, toUploadView } from '$lib/server/responses';
import { DOWNLOAD_URL_TTL_SECONDS } from '$lib/server/config';
import type { RequestHandler } from './$types';

/**
 * Authorize first, sign second - that order is the whole requirement. The
 * signer has no idea who is asking and would sign anything, which is why it is
 * unreachable without passing the check.
 *
 * The key is read off the record, so knowing a key is worth nothing: callers
 * can only ask by upload id.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);
	const row = await requireAccessibleUpload(actor, params.id);

	if (row.status === 'pending') {
		// Nothing has been uploaded against this record yet, so there is no
		// object to sign. Safe to say so plainly: authorization already passed,
		// which means this record belongs to the caller's own company. A record
		// belonging to anyone else never reaches this line.
		error(409, 'This upload has no file yet.');
	}

	const url = await createPresignedDownload(row.objectKey, row.filename);

	return json({
		url,
		expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
		upload: toUploadView(row)
	});
};
