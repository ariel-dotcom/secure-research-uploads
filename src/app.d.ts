import type { Actor } from '$lib/server/authz';

declare global {
	namespace App {
		interface Locals {
			/**
			 * Who is making this request, resolved from the database in
			 * hooks.server.ts. Null when the dev user cookie names nobody.
			 * Routes read this and never read the cookie themselves.
			 */
			actor: (Actor & { name: string }) | null;
		}
	}
}

export {};
