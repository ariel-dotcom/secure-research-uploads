import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { uploads } from './db/schema';
import type { UploadStatus } from '../uploads';

/**
 * Simulated image processing: a chain of timers, which the brief permits.
 *
 * The limitations are why real systems use a queue and a separate worker - it
 * dies with the process, leaving records stranded in `processing`; it cannot
 * scale past one instance; and there is no backpressure. See the README.
 */

/** Long enough to watch the status change, short enough not to annoy. */
const STEP_MS = 1200;

/** The simulator's one knob, so `failed` is reachable in a demo. */
export const SIMULATED_FAILURE_SAMPLE_ID = 'FAIL-TEST';

/** Fire and forget; the browser watches the status change by polling. */
export function startSimulatedProcessing(uploadId: string, sampleId: string): void {
	void runPipeline(uploadId, sampleId).catch(async (cause) => {
		// Must land somewhere the user can see, rather than becoming an
		// unhandled rejection and a record stuck in `processing`.
		console.error(`[processing] ${uploadId} failed`, cause);
		await markFailed(uploadId, 'Processing failed unexpectedly.').catch(() => {});
	});
}

async function runPipeline(uploadId: string, sampleId: string): Promise<void> {
	await sleep(STEP_MS);
	if (!(await advance(uploadId, 'uploaded', 'queued'))) return;

	await sleep(STEP_MS);
	if (!(await advance(uploadId, 'queued', 'processing'))) return;

	await sleep(STEP_MS * 2);

	if (sampleId === SIMULATED_FAILURE_SAMPLE_ID) {
		await markFailed(uploadId, 'Image could not be read. The file may be corrupt.');
		return;
	}

	await advance(uploadId, 'processing', 'completed');
}

/**
 * Only moves a record still in the status we expect. The condition lives in the
 * `where`, so the check and the write are one statement and two runs cannot
 * fight. False means something else moved it on - stop.
 */
async function advance(uploadId: string, from: UploadStatus, to: UploadStatus): Promise<boolean> {
	const updated = await db
		.update(uploads)
		.set({ status: to, updatedAt: new Date() })
		.where(
			and(
				eq(uploads.id, uploadId),
				eq(uploads.status, from),
				// A record deleted mid-pipeline stops moving.
				isNull(uploads.deletedAt)
			)
		)
		.returning({ id: uploads.id });

	return updated.length > 0;
}

async function markFailed(uploadId: string, reason: string): Promise<void> {
	await db
		.update(uploads)
		.set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
		.where(and(eq(uploads.id, uploadId), isNull(uploads.deletedAt)));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
