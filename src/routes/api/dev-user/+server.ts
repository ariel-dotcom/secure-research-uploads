import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { DEV_USER_COOKIE, isUuid } from '$lib/server/dev-user';
import type { RequestHandler } from './$types';

/**
 * Switches which seeded user the browser acts as. Refuses unknown ids - a
 * cookie naming nobody would look like a bug on every later request.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const userId = (body as { userId?: unknown } | null)?.userId;

	if (typeof userId !== 'string' || !isUuid(userId)) {
		error(400, 'A valid userId is required.');
	}

	const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
	if (!user) {
		error(400, 'Unknown user.');
	}

	cookies.set(DEV_USER_COOKIE, user.id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// The app runs over plain http locally.
		secure: false,
		maxAge: 60 * 60 * 24
	});

	return json({ user: { id: user.id, name: user.name } });
};
