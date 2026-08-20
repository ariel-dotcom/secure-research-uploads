/**
 * Object keys are built here and nowhere else. The brief specifies the shape
 * but not what makes a filename safe, so this file defines it. Pure string
 * work, so the traversal cases test directly.
 */

/** Stays well inside S3's 1024-byte key limit once the prefix is added. */
const MAX_FILENAME_LENGTH = 100;

/** Anything longer is not really an extension. */
const MAX_EXTENSION_LENGTH = 10;

/**
 * Reduces a user-supplied filename to something safe for a key. The original is
 * still stored and displayed; only the key component is sanitised.
 */
export function safeFilename(original: string): string {
	// So two spellings of one name cannot become two keys, and lookalike
	// characters fold to plain ones before the allowlist runs.
	let name = original.normalize('NFKC');

	// Last path segment only. Both separators, because Windows browsers send
	// backslash paths.
	name = name.split(/[/\\]/).pop() ?? '';

	// Allowlist, not blocklist - removes control characters, quotes, spaces and
	// every other separator in one step.
	name = name.replace(/[^A-Za-z0-9._-]/g, '_');

	// So a name of entirely illegal characters is not a wall of underscores.
	name = name.replace(/_{2,}/g, '_');

	// Leading dots are what traversal reduces to above; a leading dash reads as
	// a flag to tooling; trailing dots are invalid on Windows.
	name = name.replace(/^[._-]+/, '').replace(/\.+$/, '');

	// A name of only separators and dots is now empty.
	if (name === '') return 'file';

	return capLength(name);
}

function capLength(name: string): string {
	if (name.length <= MAX_FILENAME_LENGTH) return name;

	const lastDot = name.lastIndexOf('.');
	const hasUsableExtension = lastDot > 0 && name.length - lastDot <= MAX_EXTENSION_LENGTH;

	if (hasUsableExtension) {
		// Keep it, so the stored object is still recognisable.
		const extension = name.slice(lastDot);
		return name.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
	}

	return name.slice(0, MAX_FILENAME_LENGTH);
}

/**
 * Company first so every key carries its tenant, upload id second so two
 * uploads of the same filename cannot collide. Both are UUIDs, so the filename
 * is the only untrusted part.
 *
 * The prefix is a naming convention, not the security boundary - access is
 * decided by canAccess() before any URL is signed.
 */
export function buildObjectKey(companyId: string, uploadId: string, filename: string): string {
	return `uploads/${companyId}/${uploadId}/${safeFilename(filename)}`;
}
