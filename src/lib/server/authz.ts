/**
 * The one function that decides who may see what.
 *
 * Pure and framework-free, so it tests with two object literals and no running
 * services. Every route calls it; none reimplement the comparison.
 */

/** Resolved server-side in hooks.server.ts, never from anything the browser sends. */
export interface Actor {
	userId: string;
	companyId: string;
}

export interface OwnedRecord {
	companyId: string;
}

/**
 * Fails closed. A missing record gives the same answer as a cross-company one,
 * which is what lets routes treat "does not exist" and "not yours" alike.
 */
export function canAccess(actor: Actor | null, record: OwnedRecord | null): boolean {
	if (!actor || !record) return false;
	return actor.companyId === record.companyId;
}
