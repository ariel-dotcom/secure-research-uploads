import { json, error } from '@sveltejs/kit';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { createPresignedView } from '$lib/server/storage';
import { requireActor } from '$lib/server/responses';
import { DOWNLOAD_URL_TTL_SECONDS } from '$lib/server/config';
import type { RequestHandler } from './$types';

/**
 * Its own route rather than a flag on the download route, so the browser cannot
 * turn one into the other by editing a query parameter.
 *
 * Viewing is not a lesser operation than downloading - same bytes, same screen
 * - so it gets the same check, not a relaxed one.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);
	const row = await requireAccessibleUpload(actor, params.id);

	if (row.status === 'pending') {
		// Authorization already passed, so saying plainly what is wrong is safe.
		error(409, 'This upload has no file yet.');
	}

	const url = await createPresignedView(row.objectKey, row.filename);

	return json({ url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
};
