import { eq } from 'drizzle-orm';
import { db } from './db';
import { uploads, type Upload } from './db/schema';
import { canAccess, type Actor } from './authz';
import { isUuid } from './dev-user';
import { notFound } from './responses';

/**
 * Look up one upload for one actor, or refuse. Every id-keyed route goes
 * through here, so the sequence exists once and cannot drift between routes.
 *
 * Every route keyed by an upload id goes through here, so the sequence -
 * look up, ask canAccess, answer 404 - exists once instead of three times and
 * cannot drift between routes as the app grows. The rule itself still lives in
 * canAccess(); this is only the lookup around it.
 *
 * All three refusals produce exactly the same response:
 *
 *   - the id is not a uuid at all
 *   - the id is a uuid but no such upload exists
 *   - the upload exists and belongs to another company
 *
 * That is the point. If the third case answered differently from the second,
 * the difference would tell Hospital B which of Hospital A's upload ids are
 * real, which is the leak this whole design is trying to avoid.
 *
 * The uuid check is not only about tidiness: Postgres raises an error when a
 * malformed uuid is compared against a uuid column, so without it a junk id
 * would produce a 500 - and a 500 where a 404 was expected is itself a signal.
 */
export async function requireAccessibleUpload(actor: Actor, uploadId: string): Promise<Upload> {
	if (!isUuid(uploadId)) notFound();

	const [row] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);

	if (!canAccess(actor, row ?? null)) notFound();

	return row;
}
