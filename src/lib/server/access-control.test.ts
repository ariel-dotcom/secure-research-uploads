import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { GET as listUploads, POST as createUpload } from '../../routes/api/uploads/+server';
import { GET as getUploadRecord } from '../../routes/api/uploads/[id]/+server';
import { POST as confirmUpload } from '../../routes/api/uploads/[id]/confirm/+server';
import { GET as getDownloadUrl } from '../../routes/api/uploads/[id]/download/+server';
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

/** The four tests the brief requires. Needs `docker compose up -d` first. */

const validMetadata = {
	sampleId: 'SAMPLE-0142',
	filename: 'scan.png',
	classification: 'confidential',
	contentType: 'image/png',
	sizeBytes: PNG_BYTES.byteLength
};

beforeAll(prepareDatabase);
beforeEach(resetUploads);

/** Creates a record and puts real bytes behind it, as Dana at Hospital A. */
async function uploadAsDana() {
	const created = await bodyOf<{
		upload: UploadView;
		presignedUpload: { postURL: string; formData: Record<string, string> };
	}>(await createUpload(requestEvent({ actor: dana, body: validMetadata })));

	const stored = await sendBytesToStorage(
		created.presignedUpload,
		PNG_BYTES,
		validMetadata.filename,
		validMetadata.contentType
	);
	expect(stored.status).toBe(204);

	await confirmUpload(requestEvent({ actor: dana, params: { id: created.upload.id } }));

	return created.upload;
}

describe('1. Hospital A can create and access its own upload record', () => {
	it('creates the record, and Dana can read it back and see it in her list', async () => {
		const response = await createUpload(requestEvent({ actor: dana, body: validMetadata }));
		expect(response.status).toBe(201);

		const created = await bodyOf<{ upload: UploadView }>(response);
		expect(created.upload.sampleId).toBe('SAMPLE-0142');
		// Created before the bytes exist, because the id is part of the object key.
		expect(created.upload.status).toBe('pending');

		const fetched = await bodyOf<{ upload: UploadView }>(
			await getUploadRecord(requestEvent({ actor: dana, params: { id: created.upload.id } }))
		);
		expect(fetched.upload.id).toBe(created.upload.id);

		const listed = await bodyOf<{ uploads: UploadView[] }>(
			await listUploads(requestEvent({ actor: dana }))
		);
		expect(listed.uploads.map((upload) => upload.id)).toContain(created.upload.id);
	});

	it('stores the object key in the database and never sends it to the browser', async () => {
		const created = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		expect(created.upload).not.toHaveProperty('objectKey');
		expect(created.upload).not.toHaveProperty('companyId');

		const [row] = await db.select().from(uploads).where(eq(uploads.id, created.upload.id));
		expect(row.objectKey).toBe(`uploads/${dana.companyId}/${created.upload.id}/scan.png`);
	});
});

describe('2. Hospital B is denied access to a Hospital A upload record', () => {
	it('answers Ben with the same 404 it gives for an id that was never issued', async () => {
		const danasUpload = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		const denied = await refusal(() =>
			getUploadRecord(requestEvent({ actor: ben, params: { id: danasUpload.upload.id } }))
		);
		const missing = await refusal(() =>
			getUploadRecord(requestEvent({ actor: ben, params: { id: NEVER_ISSUED_ID } }))
		);

		// A 403 would confirm the record is real - the leak this prevents.
		expect(denied.status).toBe(404);
		expect(denied.status).toBe(missing.status);
		expect(denied.body).toEqual(missing.body);
	});

	it('refuses Ben even though he knows the upload id, and keeps it out of his list', async () => {
		const danasUpload = await bodyOf<{ upload: UploadView }>(
			await createUpload(requestEvent({ actor: dana, body: validMetadata }))
		);

		const bensList = await bodyOf<{ uploads: UploadView[] }>(
			await listUploads(requestEvent({ actor: ben }))
		);
		expect(bensList.uploads).toHaveLength(0);

		const confirmRefusal = await refusal(() =>
			confirmUpload(requestEvent({ actor: ben, params: { id: danasUpload.upload.id } }))
		);
		expect(confirmRefusal.status).toBe(404);
	});
});

describe('3. Hospital B cannot obtain a presigned download URL for a Hospital A object', () => {
	it('gives Dana a URL for her own object and Ben a 404 for the same one', async () => {
		const danasUpload = await uploadAsDana();

		const granted = await bodyOf<{ url: string }>(
			await getDownloadUrl(requestEvent({ actor: dana, params: { id: danasUpload.id } }))
		);
		expect(granted.url).toContain(danasUpload.id);

		// The URL Dana was given actually works.
		const download = await fetch(granted.url);
		expect(download.status).toBe(200);
		expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_BYTES);

		const denied = await refusal(() =>
			getDownloadUrl(requestEvent({ actor: ben, params: { id: danasUpload.id } }))
		);
		expect(denied.status).toBe(404);

		// Nothing about Dana's file appears in the refusal.
		const refusalText = JSON.stringify(denied.body);
		expect(refusalText).not.toContain(validMetadata.filename);
		expect(refusalText).not.toContain(validMetadata.sampleId);
		expect(refusalText).not.toContain(dana.companyId);
	});

	it('does not help Ben to know the object key, because the route only takes an id', async () => {
		const danasUpload = await uploadAsDana();
		const [row] = await db.select().from(uploads).where(eq(uploads.id, danasUpload.id));

		// Ben knows the object key. No route accepts one.
		const denied = await refusal(() =>
			getDownloadUrl(requestEvent({ actor: ben, params: { id: row.objectKey } }))
		);
		expect(denied.status).toBe(404);
	});
});

describe('4. Invalid or missing upload metadata is rejected', () => {
	it('rejects an empty body and names every missing field', async () => {
		const response = await createUpload(requestEvent({ actor: dana, body: {} }));
		expect(response.status).toBe(400);

		const { errors } = await bodyOf<{ errors: Record<string, string> }>(response);
		expect(Object.keys(errors).sort()).toEqual([
			'classification',
			'contentType',
			'filename',
			'sampleId',
			'sizeBytes'
		]);
	});

	it('rejects a file type outside the allowlist', async () => {
		const response = await createUpload(
			requestEvent({
				actor: dana,
				body: { ...validMetadata, filename: 'payload.exe', contentType: 'application/x-msdownload' }
			})
		);

		expect(response.status).toBe(400);
	});

	it('writes nothing to the database when the metadata is rejected', async () => {
		await createUpload(requestEvent({ actor: dana, body: { sampleId: 'SAMPLE-1' } }));

		const rows = await db.select().from(uploads);
		expect(rows).toHaveLength(0);
	});
});
