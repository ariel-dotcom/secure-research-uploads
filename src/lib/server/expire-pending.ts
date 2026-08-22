import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from './db';
import { uploads } from './db/schema';
import { UPLOAD_URL_TTL_SECONDS } from './config';

/**
 * Resolves uploads whose bytes were never going to arrive. A tab closed
 * mid-upload leaves a record at `pending` with nobody left to confirm it.
 *
 * The deadline is not a guess: once the presigned URL has expired the browser
 * cannot finish even if it returns, because storage would refuse the bytes. So
 * the record is provably dead rather than merely late.
 */

/** Grace on top of the URL's lifetime, so an upload finishing at the last
 *  second is never failed underneath itself. */
const GRACE_SECONDS = 60;

export async function expireStalePendingUploads(companyId: string): Promise<void> {
	const deadline = new Date(Date.now() - (UPLOAD_URL_TTL_SECONDS + GRACE_SECONDS) * 1000);

	await db
		.update(uploads)
		.set({
			status: 'failed',
			failureReason: 'The upload did not finish. The file was never received.',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(uploads.companyId, companyId),
				eq(uploads.status, 'pending'),
				lt(uploads.createdAt, deadline),
				isNull(uploads.deletedAt)
			)
		);
}
