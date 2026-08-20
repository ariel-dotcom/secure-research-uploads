import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

/**
 * Data for the dev user switch. Only ids and names leave the server; the
 * browser never gets to assert a company anyway.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const seededUsers = await db
		.select({ id: users.id, name: users.name })
		.from(users)
		.orderBy(users.name);

	return {
		currentUserId: locals.actor?.userId ?? null,
		currentUserName: locals.actor?.name ?? null,
		users: seededUsers
	};
};
