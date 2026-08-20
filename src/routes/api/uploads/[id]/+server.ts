import { json } from '@sveltejs/kit';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { requireActor, toUploadView } from '$lib/server/responses';
import type { RequestHandler } from './$types';

/** Another company's id gets the same 404 as one that was never issued. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);
	const row = await requireAccessibleUpload(actor, params.id);

	return json({ upload: toUploadView(row) });
};
