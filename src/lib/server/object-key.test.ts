import { describe, it, expect } from 'vitest';
import { safeFilename, buildObjectKey } from './object-key';

const companyId = '00000000-0000-4000-8000-00000000000a';
const otherCompanyId = '00000000-0000-4000-8000-00000000000b';
const uploadId = '11111111-1111-4111-8111-111111111111';
const prefix = `uploads/${companyId}/${uploadId}/`;

describe('safeFilename', () => {
	it('leaves an ordinary filename alone', () => {
		expect(safeFilename('sample-12_scan.png')).toBe('sample-12_scan.png');
	});

	it('keeps only the last path segment', () => {
		expect(safeFilename('C:\\scans\\2026\\sample.png')).toBe('sample.png');
		expect(safeFilename('/var/data/sample.png')).toBe('sample.png');
	});

	it('replaces characters outside the allowlist', () => {
		expect(safeFilename('scan 12 (final).png')).toBe('scan_12_final_.png');
	});

	it('falls back to a placeholder when nothing usable is left', () => {
		expect(safeFilename('..')).toBe('file');
		expect(safeFilename('../')).toBe('file');
		expect(safeFilename('///')).toBe('file');
	});

	it('caps the length but keeps the extension', () => {
		const result = safeFilename(`${'a'.repeat(300)}.png`);
		expect(result.length).toBeLessThanOrEqual(100);
		expect(result.endsWith('.png')).toBe(true);
	});
});

describe('buildObjectKey', () => {
	it('scopes the key by company and upload', () => {
		expect(buildObjectKey(companyId, uploadId, 'sample.png')).toBe(`${prefix}sample.png`);
	});

	// This is the case the whole file exists for: a filename is the only part
	// of the key that comes from the user, so it is the only way to try to
	// escape the prefix.
	it('cannot be made to escape the prefix with path traversal', () => {
		const attacks = [
			'../../../../etc/passwd',
			'..\\..\\windows\\system32\\config\\sam',
			`../../${otherCompanyId}/secret.png`,
			'....//....//escape.png',
			'/absolute/path.png',
			'.'
		];

		for (const attack of attacks) {
			const key = buildObjectKey(companyId, uploadId, attack);

			expect(key.startsWith(prefix), `"${attack}" escaped the prefix`).toBe(true);
			expect(key.includes('..'), `"${attack}" left a traversal segment`).toBe(false);
			// Exactly four segments: uploads / company / upload / filename.
			expect(key.split('/')).toHaveLength(4);
		}
	});
});
