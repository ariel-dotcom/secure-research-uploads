import type { Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { DEFAULT_USER_ID } from '$lib/server/db/seed';
import { DEV_USER_COOKIE, isUuid } from '$lib/server/dev-user';

/**
 * Resolves who is making each request, before any route runs.
 *
 * The cookie names a user; the server looks up their company. So the browser
 * never gets to assert its own company - the part that would still matter with
 * real sessions. Routes read `locals.actor`, never the cookie.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const requestedUserId = event.cookies.get(DEV_USER_COOKIE) ?? DEFAULT_USER_ID;

	event.locals.actor = isUuid(requestedUserId) ? await loadActor(requestedUserId) : null;

	return resolve(event);
};

async function loadActor(userId: string) {
	const [user] = await db
		.select({ userId: users.id, companyId: users.companyId, name: users.name })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	return user ?? null;
}
