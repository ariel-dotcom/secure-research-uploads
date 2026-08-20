/**
 * The development user switch, in place of a login system. Kept in one file so
 * the thing to replace with real sessions is obvious.
 */
export const DEV_USER_COOKIE = 'dev_user_id';

/** Postgres raises on a malformed uuid, so anything compared against a uuid
 *  column is checked first - otherwise a junk cookie becomes a 500. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}
