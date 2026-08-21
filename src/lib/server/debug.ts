/**
 * Development tracing. Set DEBUG_AUTHZ=true in .env; off by default.
 *
 * Output goes to the server terminal and never into a response. A debug flag
 * that let a refusal explain itself would be the exact leak the 404 rule
 * prevents, one environment variable from production - so responses are
 * byte-identical either way, and only the terminal changes.
 */

const enabled = process.env.DEBUG_AUTHZ === 'true';

/**
 * Drops the filename. A key ends in the user's filename, and in a hospital that
 * can identify a patient; logs outlive their intent. Only the structural part
 * is kept, which is all the decision turned on.
 */
function redactKey(objectKey: string): string {
	const parts = objectKey.split('/');
	if (parts.length < 4) return '<key>';
	return `${parts.slice(0, 3).join('/')}/<filename>`;
}

/** Full UUIDs are unreadable in a live trace; four characters distinguish. */
function short(id: string | null | undefined): string {
	if (!id) return '-';
	return id.slice(-4);
}

/** API calls only - page and asset requests would bury the lines that matter. */
export function traceActor(
	method: string,
	path: string,
	actor: { userId: string; companyId: string; name?: string } | null
): void {
	if (!enabled || !path.startsWith('/api/')) return;

	if (!actor) {
		console.log(`[authz] ${method} ${path}  actor=none`);
		return;
	}

	console.log(
		`[authz] ${method} ${path}  actor=${actor.name ?? short(actor.userId)}  company=${short(actor.companyId)}`
	);
}

/** The access decision, with every input that produced it. */
export function traceAccessDecision(input: {
	uploadId: string;
	actorCompanyId: string;
	recordCompanyId: string | null;
	allowed: boolean;
	deleted: boolean;
	outcome: string;
}): void {
	if (!enabled) return;

	const reason = !input.recordCompanyId
		? 'no such record'
		: !input.allowed
			? 'different company'
			: input.deleted
				? 'record was deleted'
				: 'owner';

	console.log(
		`[authz] upload=${short(input.uploadId)}` +
			`  actor.company=${short(input.actorCompanyId)}` +
			`  record.company=${short(input.recordCompanyId)}` +
			`  canAccess=${input.allowed}` +
			`  deleted=${input.deleted}` +
			`  -> ${input.outcome} (${reason})`
	);
}

/** A presigned URL was issued: what for, over what, for how long. */
export function traceSignedUrl(kind: string, objectKey: string, ttlSeconds: number): void {
	if (!enabled) return;

	console.log(`[sign]  ${kind}  key=${redactKey(objectKey)}  ttl=${ttlSeconds}s`);
}

/** A request was rejected before any record was looked at. */
export function traceValidation(path: string, errors: Record<string, string>): void {
	if (!enabled) return;

	console.log(`[valid] ${path}  rejected: ${Object.keys(errors).join(', ')}`);
}
