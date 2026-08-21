import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { GET as listUploads, POST as createUpload } from '../../routes/api/uploads/+server';
import {
	GET as getUploadRecord,
	DELETE as deleteUpload
} from '../../routes/api/uploads/[id]/+server';
import { POST as confirmUpload } from '../../routes/api/uploads/[id]/confirm/+server';
import { GET as getViewUrl } from '../../routes/api/uploads/[id]/view/+server';
import { GET as getDownloadUrl } from '../../routes/api/uploads/[id]/download/+server';
import { statObject } from './storage';
import type { UploadView } from '../uploads';
import {
	db,
	uploads,
	dana,
	ben,
	NEVER_ISSUED_ID,
	PNG_BYTES,
	bodyOf,
	prepareDatabase,
	refusal,
	requestEvent,
	resetUploads,
	sendBytesToStorage
} from './test-support';

/**
 * View and delete are not in the brief, so their tests live here and the
 * required four and extra four stay exactly as described.
 *
 * Delete is destructive, so a mistake here loses data rather than disclosing it.
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

/** A complete upload owned by Dana, with real bytes behind it. */
async function danaUpload() {
	const created = await bodyOf<{
		upload: UploadView;
		presignedUpload: { postURL: string; formData: Record<string, string> };
	}>(await createUpload(requestEvent({ actor: dana, body: validMetadata })));

	await sendBytesToStorage(
		created.presignedUpload,
		PNG_BYTES,
		validMetadata.filename,
		validMetadata.contentType
	);
	await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }));

	return created.upload;
}

describe('Viewing', () => {
	it('gives the owner a working URL that renders inline', async () => {
		const upload = await danaUpload();

		const { url } = await bodyOf<{ url: string }>(
			await getViewUrl(requestEvent({ actor: dana, params: { id: upload.id } }))
		);

		const response = await fetch(url);
		expect(response.status).toBe(200);

		// The one difference from the download route.
		expect(response.headers.get('content-disposition')).toContain('inline');
	});

	it('refuses another company exactly as the record route does', async () => {
		const upload = await danaUpload();

		const denied = await refusal(() =>
			getViewUrl(requestEvent({ actor: ben, params: { id: upload.id } }))
		);
		const missing = await refusal(() =>
			getViewUrl(requestEvent({ actor: ben, params: { id: NEVER_ISSUED_ID } }))
		);

		expect(denied.status).toBe(404);
		expect(denied.body).toEqual(missing.body);
	});
});

describe('Deleting', () => {
	it('lets the owner delete, after which the record is gone from every route', async () => {
		const upload = await danaUpload();

		const response = await deleteUpload(requestEvent({ actor: dana, params: { id: upload.id } }));
		expect(response.status).toBe(204);

		// Gone from the list.
		const listed = await bodyOf<{ uploads: UploadView[] }>(
			await listUploads(requestEvent({ actor: dana }))
		);
		expect(listed.uploads.map((u) => u.id)).not.toContain(upload.id);

		// Gone from every id-keyed route, including for the owner.
		for (const route of [getUploadRecord, getViewUrl, getDownloadUrl]) {
			const gone = await refusal(() =>
				route(requestEvent({ actor: dana, params: { id: upload.id } }))
			);
			expect(gone.status).toBe(404);
		}
	});

	it('keeps the row and the deletion timestamp rather than destroying data', async () => {
		const upload = await danaUpload();
		await deleteUpload(requestEvent({ actor: dana, params: { id: upload.id } }));

		// The point of soft delete: retained, but withdrawn from the app.
		const [row] = await db.select().from(uploads).where(eq(uploads.id, upload.id));
		expect(row).toBeDefined();
		expect(row.deletedAt).not.toBeNull();

		// The bytes too - an audit trail pointing at nothing is no trail.
		expect(await statObject(row.objectKey)).not.toBeNull();
	});

	it('refuses another company, and leaves the record untouched', async () => {
		const upload = await danaUpload();

		const denied = await refusal(() =>
			deleteUpload(requestEvent({ actor: ben, params: { id: upload.id } }))
		);
		expect(denied.status).toBe(404);

		// The important half: Ben's attempt changed nothing.
		const [row] = await db.select().from(uploads).where(eq(uploads.id, upload.id));
		expect(row.deletedAt).toBeNull();

		const stillThere = await bodyOf<{ uploads: UploadView[] }>(
			await listUploads(requestEvent({ actor: dana }))
		);
		expect(stillThere.uploads.map((u) => u.id)).toContain(upload.id);
	});

	it('is safe to call twice and does not move the deletion timestamp', async () => {
		const upload = await danaUpload();
		await deleteUpload(requestEvent({ actor: dana, params: { id: upload.id } }));

		const [afterFirst] = await db.select().from(uploads).where(eq(uploads.id, upload.id));

		// Answered like any other request for a record that is gone.
		const second = await refusal(() =>
			deleteUpload(requestEvent({ actor: dana, params: { id: upload.id } }))
		);
		expect(second.status).toBe(404);

		const [afterSecond] = await db.select().from(uploads).where(eq(uploads.id, upload.id));
		expect(afterSecond.deletedAt?.getTime()).toBe(afterFirst.deletedAt?.getTime());
	});
});
