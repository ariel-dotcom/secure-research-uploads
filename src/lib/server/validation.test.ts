import { describe, it, expect } from 'vitest';
import { validateUploadInput } from './validation';
import { MAX_UPLOAD_BYTES } from '../uploads';

const valid = {
	sampleId: 'SAMPLE-12',
	filename: 'scan.png',
	classification: 'confidential',
	contentType: 'image/png',
	sizeBytes: 2048
};

describe('validateUploadInput', () => {
	it('accepts a complete, well-formed body', () => {
		const result = validateUploadInput(valid);
		expect(result.ok).toBe(true);
	});

	it('trims whitespace off the values it accepts', () => {
		const result = validateUploadInput({ ...valid, sampleId: '  SAMPLE-12  ' });
		expect(result.ok && result.value.sampleId).toBe('SAMPLE-12');
	});

	it('rejects a body that is not an object', () => {
		expect(validateUploadInput('nope').ok).toBe(false);
		expect(validateUploadInput(null).ok).toBe(false);
		expect(validateUploadInput([valid]).ok).toBe(false);
	});

	it('reports every missing field at once rather than stopping at the first', () => {
		const result = validateUploadInput({});
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(Object.keys(result.errors).sort()).toEqual([
			'classification',
			'contentType',
			'filename',
			'sampleId',
			'sizeBytes'
		]);
	});

	it('rejects a classification that is not one of the known values', () => {
		const result = validateUploadInput({ ...valid, classification: 'top-secret' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.classification).toBeDefined();
	});

	it('rejects a content type outside the allowlist', () => {
		const result = validateUploadInput({ ...valid, contentType: 'application/x-msdownload' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.contentType).toBeDefined();
	});

	it('rejects a sample id with characters a lab system would never produce', () => {
		const result = validateUploadInput({ ...valid, sampleId: 'DROP TABLE uploads;' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.sampleId).toBeDefined();
	});

	it('rejects a file larger than the limit', () => {
		const result = validateUploadInput({ ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.sizeBytes).toBeDefined();
	});

	it('rejects an empty file', () => {
		const result = validateUploadInput({ ...valid, sizeBytes: 0 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.sizeBytes).toBeDefined();
	});
});
