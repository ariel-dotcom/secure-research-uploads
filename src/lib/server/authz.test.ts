import { describe, it, expect } from 'vitest';
import { canAccess, type Actor, type OwnedRecord } from './authz';

const hospitalA = '00000000-0000-4000-8000-00000000000a';
const hospitalB = '00000000-0000-4000-8000-00000000000b';

const dana: Actor = { userId: 'user-a', companyId: hospitalA };
const ben: Actor = { userId: 'user-b', companyId: hospitalB };
const hospitalARecord: OwnedRecord = { companyId: hospitalA };

describe('canAccess', () => {
	it('allows a user to reach a record owned by their own company', () => {
		expect(canAccess(dana, hospitalARecord)).toBe(true);
	});

	it('denies a user from another company', () => {
		expect(canAccess(ben, hospitalARecord)).toBe(false);
	});

	it('denies when there is no actor', () => {
		expect(canAccess(null, hospitalARecord)).toBe(false);
	});

	it('denies when there is no record, so a missing row and a forbidden row look identical', () => {
		expect(canAccess(dana, null)).toBe(false);
	});
});
