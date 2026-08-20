import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { POST as createUpload } from '../../routes/api/uploads/+server';
import { POST as confirmUpload } from '../../routes/api/uploads/[id]/confirm/+server';
import { createPresignedDownload } from './storage';
import type { UploadView } from '../uploads';
import {
	db,
	uploads,
	dana,
	PNG_BYTES,
	bodyOf,
	prepareDatabase,
	refusal,
	requestEvent,
	resetUploads,
	sendBytesToStorage
} from './test-support';

/**
 * The four extra tests beyond the required ones. Each covers a step that can be
 * skipped, repeated, attacked, or left too long.
 */

const validMetadata = {
	sampleId: 'SAMPLE-0142',
	filename: 'scan.png',
	classification: 'confidential',
	contentType: 'image/png',
	sizeBytes: PNG_BYTES.byteLength
};

beforeAll(prepareDatabase);
beforeEach(resetUploads);

async function createRecord(overrides: Partial<typeof validMetadata> = {}) {
	return bodyOf<{
		upload: UploadView;
		presignedUpload: { postURL: string; formData: Record<string, string> };
	}>(await createUpload(requestEvent({ actor: dana, body: { ...validMetadata, ...overrides } })));
}

describe('5. Confirm is rejected when the object is not actually in MinIO', () => {
	it('refuses to mark an upload received when nothing was ever sent', async () => {
		// The record exists, but nothing was ever uploaded against it.
		const created = await createRecord();

		const denied = await refusal(() =>
			confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);
		expect(denied.status).toBe(400);

		// Stays pending rather than failed, because this is retryable.
		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));
		expect(row.status).toBe('pending');
		expect(row.sizeBytes).toBeNull();
	});
});

describe('6. Confirm called twice is safe', () => {
	it('does not create a second record or move the first one backwards', async () => {
		const created = await createRecord();
		await sendBytesToStorage(
			created.presignedUpload,
			PNG_BYTES,
			validMetadata.filename,
			validMetadata.contentType
		);

		const first = await bodyOf<{ upload: UploadView }>(
			await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);
		expect(first.upload.status).toBe('uploaded');
		expect(first.upload.sizeBytes).toBe(PNG_BYTES.byteLength);

		// A retry, a proxy repeat, or an impatient second click.
		const second = await bodyOf<{ upload: UploadView }>(
			await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);

		expect(second.upload.id).toBe(first.upload.id);
		expect(second.upload.status).not.toBe('pending');
		expect(second.upload.sizeBytes).toBe(PNG_BYTES.byteLength);

		const rows = await db.select().from(uploads);
		expect(rows).toHaveLength(1);

		// A late retry does not drag a finished record back to 'uploaded'.
		await db.update(uploads).set({ status: 'completed' }).where(eq(uploads.id, created.upload.id));

		const late = await bodyOf<{ upload: UploadView }>(
			await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);
		expect(late.upload.status).toBe('completed');
	});
});

describe('7. A filename containing path traversal cannot escape the key prefix', () => {
	it('keeps the object inside this company and this upload', async () => {
		const created = await createRecord({
			filename: '../../00000000-0000-4000-8000-00000000000b/stolen.png'
		});

		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));

		// Only the last path segment survives, so the traversal and the other
		// company's id are dropped outright rather than flattened into the name.
		expect(row.objectKey).toBe(`uploads/${dana.companyId}/${created.upload.id}/stolen.png`);
		expect(row.objectKey.startsWith(`uploads/${dana.companyId}/${created.upload.id}/`)).toBe(true);
		expect(row.objectKey).not.toContain('..');
		expect(row.objectKey).not.toContain('00000000-0000-4000-8000-00000000000b');

		// The original filename is still kept for display - only the key
		// component was sanitised.
		expect(row.filename).toBe('../../00000000-0000-4000-8000-00000000000b/stolen.png');

		// And the bytes really do land at the safe key, not the attempted one.
		const stored = await sendBytesToStorage(
			created.presignedUpload,
			PNG_BYTES,
			'stolen.png',
			validMetadata.contentType
		);
		expect(stored.status).toBe(204);

		const confirmed = await bodyOf<{ upload: UploadView }>(
			await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);
		expect(confirmed.upload.status).toBe('uploaded');
	});
});

describe('8. An expired presigned URL is rejected', () => {
	it('stops working once its deadline passes', async () => {
		const created = await createRecord();
		await sendBytesToStorage(
			created.presignedUpload,
			PNG_BYTES,
			validMetadata.filename,
			validMetadata.contentType
		);
		await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }));

		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));

		// One second, so the deadline passes during the test.
		const url = await createPresignedDownload(row.objectKey, row.filename, 1);

		const beforeExpiry = await fetch(url);
		expect(beforeExpiry.status).toBe(200);

		await new Promise((resolve) => setTimeout(resolve, 2000));

		// The property the design leans on: the deadline is in the signature and
		// MinIO enforces it. Nothing in this app is consulted here.
		const afterExpiry = await fetch(url);
		expect(afterExpiry.status).toBe(403);
	});
});
