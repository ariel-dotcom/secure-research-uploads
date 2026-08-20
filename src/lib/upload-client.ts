import type { UploadView } from './uploads';

/**
 * The browser half of the upload:
 *
 *   1. ask the server to create a record and sign an upload URL
 *   2. send the bytes straight to MinIO, never through the server
 *   3. tell the server they arrived, so it can verify and record it
 *
 * Step 2 is the point: a 25 MB file never passes through the app server, and
 * the browser only ever holds a URL good for one object for five minutes.
 */

/** Where the upload has got to. The UI shows a different thing for each. */
export type UploadPhase = 'idle' | 'creating' | 'sending' | 'confirming' | 'done' | 'error';

export interface UploadFailure {
	message: string;
	/** Per-field messages from server-side validation, keyed by field name. */
	fieldErrors?: Record<string, string>;
}

export class UploadError extends Error implements UploadFailure {
	fieldErrors?: Record<string, string>;

	constructor(failure: UploadFailure) {
		super(failure.message);
		this.name = 'UploadError';
		this.fieldErrors = failure.fieldErrors;
	}
}

interface UploadCallbacks {
	onPhase: (phase: UploadPhase) => void;
	/** Real bytes sent, 0-100. Only meaningful during the `sending` phase. */
	onProgress: (percent: number) => void;
}

export async function uploadFile(
	input: { sampleId: string; classification: string; file: File },
	{ onPhase, onProgress }: UploadCallbacks
): Promise<UploadView> {
	onPhase('creating');

	const created = await createRecord(input);

	onPhase('sending');
	onProgress(0);
	await sendBytes(created.presignedUpload, input.file, onProgress);

	onPhase('confirming');
	const confirmed = await confirmUpload(created.upload.id);

	onPhase('done');
	return confirmed;
}

async function createRecord(input: { sampleId: string; classification: string; file: File }) {
	const response = await fetch('/api/uploads', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			sampleId: input.sampleId,
			filename: input.file.name,
			classification: input.classification,
			// Claims, not facts. The same limits are signed into the policy, and
			// the real values are read back from MinIO at confirm time.
			contentType: input.file.type,
			sizeBytes: input.file.size
		})
	});

	const body = await response.json().catch(() => null);

	if (!response.ok) {
		throw new UploadError({
			message: body?.message ?? 'Could not start the upload.',
			fieldErrors: body?.errors
		});
	}

	return body as {
		upload: UploadView;
		presignedUpload: { postURL: string; formData: Record<string, string> };
	};
}

/**
 * XMLHttpRequest rather than fetch, because fetch cannot report how much of a
 * request body has been sent - a fetch version could only fake the progress
 * bar. XHR exposes upload.onprogress, so the number on screen is real.
 */
function sendBytes(
	presigned: { postURL: string; formData: Record<string, string> },
	file: File,
	onProgress: (percent: number) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		const form = new FormData();

		// Policy fields first, file last: S3 ignores anything after the file.
		for (const [name, value] of Object.entries(presigned.formData)) {
			form.append(name, value);
		}
		form.append('file', file);

		const request = new XMLHttpRequest();
		request.open('POST', presigned.postURL);

		request.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) {
				onProgress(Math.round((event.loaded / event.total) * 100));
			}
		});

		request.addEventListener('load', () => {
			// MinIO answers a successful POST policy upload with 204.
			if (request.status >= 200 && request.status < 300) {
				onProgress(100);
				resolve();
				return;
			}

			reject(
				new UploadError({ message: describeStorageError(request.status, request.responseText) })
			);
		});

		request.addEventListener('error', () => {
			reject(new UploadError({ message: 'The connection to storage failed. Please try again.' }));
		});

		request.addEventListener('abort', () => {
			reject(new UploadError({ message: 'The upload was cancelled.' }));
		});

		request.send(form);
	});
}

/**
 * Turns MinIO's XML error into something a person can act on. These are the
 * signed conditions working as intended; the user still needs to know which.
 */
function describeStorageError(status: number, responseText: string): string {
	if (responseText.includes('EntityTooLarge')) {
		return 'That file is larger than the upload limit allows.';
	}
	if (responseText.includes('ExpiredToken') || responseText.includes('expired')) {
		return 'The upload link expired before the file finished sending. Please try again.';
	}
	if (status === 403) {
		return 'Storage rejected the upload. The file may not match what was requested.';
	}
	return `Storage rejected the upload (HTTP ${status}).`;
}

async function confirmUpload(uploadId: string): Promise<UploadView> {
	const response = await fetch(`/api/uploads/${uploadId}/confirm`, { method: 'POST' });
	const body = await response.json().catch(() => null);

	if (!response.ok) {
		throw new UploadError({ message: body?.message ?? 'Could not confirm the upload.' });
	}

	return (body as { upload: UploadView }).upload;
}

/** Two steps on purpose: the server decides, then signs a URL good for a
 *  minute. Not a permanent link, and stored nowhere. */
export async function downloadUpload(uploadId: string): Promise<void> {
	const response = await fetch(`/api/uploads/${uploadId}/download`);
	const body = await response.json().catch(() => null);

	if (!response.ok) {
		throw new UploadError({ message: body?.message ?? 'Could not download this file.' });
	}

	window.location.assign((body as { url: string }).url);
}

export async function listUploads(): Promise<UploadView[]> {
	const response = await fetch('/api/uploads');
	const body = await response.json().catch(() => null);

	if (!response.ok) {
		throw new UploadError({ message: body?.message ?? 'Could not load your uploads.' });
	}

	return (body as { uploads: UploadView[] }).uploads;
}
