import { json, error } from '@sveltejs/kit';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { createPresignedDownload } from '$lib/server/storage';
import { hasStoredFile } from '$lib/uploads';
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

	if (!hasStoredFile(row)) {
		// Signing a URL for an object that was never stored would hand the user
		// storage's raw XML error page. Safe to say plainly what is wrong -
		// authorization already passed, so this record is the caller's own.
		error(409, 'This upload has no file.');
	}

	const url = await createPresignedDownload(row.objectKey, row.filename);

	return json({
		url,
		expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
		upload: toUploadView(row)
	});
};
