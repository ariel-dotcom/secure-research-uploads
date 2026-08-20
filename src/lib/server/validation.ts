import { ALLOWED_CONTENT_TYPES, CLASSIFICATIONS, MAX_UPLOAD_BYTES } from '../uploads';

/**
 * Hand-written rather than zod: one shape to validate, and each rule's reason
 * is worth more here than the lines it would save.
 *
 * Returns every field error at once, so the form shows all problems in one go.
 */

export interface ValidUploadInput {
	sampleId: string;
	filename: string;
	classification: string;
	contentType: string;
	sizeBytes: number;
}

export type ValidationResult =
	{ ok: true; value: ValidUploadInput } | { ok: false; errors: Record<string, string> };

/** Sample identifiers come from lab systems: letters, digits, dash, underscore. */
const SAMPLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SAMPLE_ID_LENGTH = 64;
const MAX_FILENAME_LENGTH = 255;

export function validateUploadInput(body: unknown): ValidationResult {
	const errors: Record<string, string> = {};

	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return { ok: false, errors: { body: 'Expected a JSON object.' } };
	}

	const raw = body as Record<string, unknown>;

	const sampleId = typeof raw.sampleId === 'string' ? raw.sampleId.trim() : '';
	if (sampleId === '') {
		errors.sampleId = 'Sample ID is required.';
	} else if (sampleId.length > MAX_SAMPLE_ID_LENGTH) {
		errors.sampleId = `Sample ID must be ${MAX_SAMPLE_ID_LENGTH} characters or fewer.`;
	} else if (!SAMPLE_ID_PATTERN.test(sampleId)) {
		errors.sampleId = 'Sample ID may contain only letters, digits, dots, dashes and underscores.';
	}

	const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
	if (filename === '') {
		errors.filename = 'Filename is required.';
	} else if (filename.length > MAX_FILENAME_LENGTH) {
		errors.filename = `Filename must be ${MAX_FILENAME_LENGTH} characters or fewer.`;
	}

	const classification = typeof raw.classification === 'string' ? raw.classification.trim() : '';
	if (classification === '') {
		errors.classification = 'Classification is required.';
	} else if (!(CLASSIFICATIONS as readonly string[]).includes(classification)) {
		errors.classification = `Classification must be one of: ${CLASSIFICATIONS.join(', ')}.`;
	}

	const contentType = typeof raw.contentType === 'string' ? raw.contentType.trim() : '';
	if (contentType === '') {
		errors.contentType = 'Content type is required.';
	} else if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
		errors.contentType = `File type must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}.`;
	}

	// Rejects an oversized file before anything is signed, for a clear error.
	// Not the enforcement point - the same limit is signed into the policy, so
	// MinIO refuses an oversized body even if this number was a lie.
	const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : NaN;
	if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
		errors.sizeBytes = 'File size is required.';
	} else if (sizeBytes > MAX_UPLOAD_BYTES) {
		errors.sizeBytes = `File must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`;
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return { ok: true, value: { sampleId, filename, classification, contentType, sizeBytes } };
}
