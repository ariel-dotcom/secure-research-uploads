import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { GET as listUploads, POST as createUpload } from '../../routes/api/uploads/+server';
import { UPLOAD_URL_TTL_SECONDS } from './config';
import type { UploadView } from '../uploads';
import {
	db,
	uploads,
	dana,
	PNG_BYTES,
	bodyOf,
	prepareDatabase,
	requestEvent,
	resetUploads
} from './test-support';

/**
 * An upload abandoned part-way through, found by refreshing mid-upload. The
 * record never resolved, and the page polled it forever. This covers the first;
 * the second is a one-line change in the page.
 */

const validMetadata = {
	sampleId: 'ABANDONED',
	filename: 'never-sent.png',
	classification: 'internal',
	contentType: 'image/png',
	sizeBytes: PNG_BYTES.byteLength
};

beforeAll(prepareDatabase);
beforeEach(resetUploads);

describe('Uploads abandoned before the bytes arrived', () => {
	it('leaves a record pending when nothing confirms it', async () => {
		// Then do what a refreshed tab does: nothing.
		const created = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));
		expect(row.status).toBe('pending');
	});

	it('is left alone while the upload URL could still succeed', async () => {
		const created = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		await listUploads(requestEvent({ actor: dana }));

		// The URL has not expired, so failing it here would be guessing.
		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));
		expect(row.status).toBe('pending');
	});

	it('fails the record once the upload URL could no longer possibly work', async () => {
		const created = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		// Age it past the deadline rather than waiting six minutes.
		const longAgo = new Date(Date.now() - (UPLOAD_URL_TTL_SECONDS + 120) * 1000);
		await db.update(uploads).set({ createdAt: longAgo }).where(eq(uploads.id, created.upload.id));

		const listed = await bodyOf<{ uploads: UploadView[] }>(
			await listUploads(requestEvent({ actor: dana }))
		);

		const shown = listed.uploads.find((u) => u.id === created.upload.id);
		expect(shown?.status).toBe('failed');
		expect(shown?.failureReason).toContain('did not finish');
	});

	it('does not touch uploads that completed normally', async () => {
		const created = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		await db
			.update(uploads)
			.set({ status: 'completed', createdAt: new Date(Date.now() - 86_400_000) })
			.where(eq(uploads.id, created.upload.id));

		await listUploads(requestEvent({ actor: dana }));

		// Old, but finished. The sweep only looks at pending records.
		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));
		expect(row.status).toBe('completed');
	});
});
