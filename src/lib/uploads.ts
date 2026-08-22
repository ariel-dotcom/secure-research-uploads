// Shared by the server and the browser, so nothing here is secret. The server
// enforces all of it again regardless.

/** Used to build the Postgres enum and to render status text. `pending` is a
 *  deliberate addition to the brief - see server/db/schema.ts. */
export const UPLOAD_STATUSES = [
	'pending',
	'uploaded',
	'queued',
	'processing',
	'completed',
	'failed'
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/** Large enough for a research scan, small enough that a mistaken upload
 *  cannot fill the disk. Signed into the upload policy. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** An allowlist: anything not named here is rejected by default. */
export const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/tiff'] as const;

/**
 * The brief requires this field but never says what it holds. Read as
 * sensitivity, since the rest of the brief is about access control. Raised in
 * the README rather than assumed silently.
 */
export const CLASSIFICATIONS = ['internal', 'confidential', 'restricted'] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/** One plain sentence per status. The enum values stay exactly as the brief
 *  names them in the database and API; this is presentation only. */
export const STATUS_TEXT: Record<UploadStatus, string> = {
	pending: 'Waiting for the file. Nothing has been uploaded yet.',
	uploaded: 'File received and stored. Waiting to be picked up for processing.',
	queued: 'Queued for processing. It will start shortly.',
	processing: 'Processing now. This usually takes a few seconds.',
	completed: 'Ready. You can download this file.',
	failed: 'Something went wrong. Upload the file again.'
};

/** Statuses that will not change on their own, so the UI can stop polling. */
export const TERMINAL_STATUSES: UploadStatus[] = ['completed', 'failed'];

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the browser sees. The object key and owning company never leave the
 *  server - see toUploadView() in server/responses.ts. */
export interface UploadView {
	id: string;
	sampleId: string;
	filename: string;
	classification: string;
	status: UploadStatus;
	sizeBytes: number | null;
	contentType: string | null;
	failureReason: string | null;
	createdAt: string;
}

/**
 * Statuses the server moves by itself, so the page polls only while a record is
 * in one. `pending` is deliberately absent: it waits on a browser, not on us,
 * and a tab closed mid-upload would leave the page polling forever.
 */
export const SERVER_ADVANCING_STATUSES: UploadStatus[] = ['uploaded', 'queued', 'processing'];

/**
 * Whether bytes actually exist for this record. A better test than the status,
 * because `failed` covers two cases: an abandoned upload has no file, while a
 * failed *processing* run has its file intact.
 *
 * Asked by the UI to decide what to offer and by the routes to decide what to
 * allow - the button is a courtesy, the server is the rule.
 */
export function hasStoredFile(record: Pick<UploadView, 'sizeBytes'>): boolean {
	return record.sizeBytes !== null;
}
