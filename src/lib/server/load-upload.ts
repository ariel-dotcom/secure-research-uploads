import { eq } from 'drizzle-orm';
import { db } from './db';
import { uploads, type Upload } from './db/schema';
import { canAccess, type Actor } from './authz';
import { isUuid } from './dev-user';
import { notFound } from './responses';
import { traceAccessDecision } from './debug';

/**
 * Look up one upload for one actor, or refuse. Every id-keyed route goes
 * through here, so the sequence exists once and cannot drift between routes.
 *
 * Four cases give an identical 404 - bad uuid, no such row, another company's
 * row, deleted row - so a refusal never reveals which upload ids are real.
 *
 * The uuid check also stops Postgres raising on a malformed uuid, which would
 * turn a 404 into a 500 and be a signal in itself.
 */
export async function requireAccessibleUpload(actor: Actor, uploadId: string): Promise<Upload> {
	if (!isUuid(uploadId)) notFound();

	const [row] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);

	const allowed = canAccess(actor, row ?? null);
	const deleted = row?.deletedAt != null;

	traceAccessDecision({
		uploadId,
		actorCompanyId: actor.companyId,
		recordCompanyId: row?.companyId ?? null,
		allowed,
		deleted,
		outcome: allowed && !deleted ? 'allow' : '404'
	});

	if (!allowed) notFound();

	// Checked here rather than inside canAccess: that asks whether this person
	// may touch the record, this asks whether it still exists at all.
	if (deleted) notFound();

	return row;
}
