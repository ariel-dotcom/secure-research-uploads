import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { uploads } from '$lib/server/db/schema';
import { requireAccessibleUpload } from '$lib/server/load-upload';
import { requireActor, toUploadView } from '$lib/server/responses';
import type { RequestHandler } from './$types';

/** Another company's id gets the same 404 as one that was never issued. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);
	const row = await requireAccessibleUpload(actor, params.id);

	return json({ upload: toUploadView(row) });
};

/**
 * Soft delete: the row and the object stay, `deleted_at` is stamped. Retention
 * obligations outlive one user's decision, and nothing in the app can restore
 * it, so the warning the user confirms is accurate. See db/schema.ts.
 *
 * The first destructive route here, which makes the shared authorization check
 * matter more - a wrong answer loses data rather than merely disclosing it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const actor = requireActor(locals.actor);
	const row = await requireAccessibleUpload(actor, params.id);

	// Conditional, so a repeated delete never overwrites the original
	// timestamp. requireAccessibleUpload() already refuses a deleted record,
	// but the guard belongs in the statement rather than upstream of it.
	await db
		.update(uploads)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(uploads.id, row.id), isNull(uploads.deletedAt)));

	// Nothing meaningful left to return.
	return new Response(null, { status: 204 });
};
