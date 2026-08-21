import { pgTable, pgEnum, text, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { UPLOAD_STATUSES } from '../../uploads';

/**
 * The brief lists five statuses; `pending` is a deliberate sixth.
 *
 * The object key contains the upload id, so the row must exist before the
 * browser can be told where to send the bytes - leaving a real state the brief
 * does not name. Without it a row would claim `uploaded` with nothing uploaded,
 * and an abandoned upload would look identical to a successful one.
 *
 * The alternative was letting the browser influence the key so the row could be
 * written afterwards, which the security requirements rule out. Raised in the
 * README under "Questions I would raise".
 */
export const uploadStatus = pgEnum('upload_status', UPLOAD_STATUSES);

/** Hospital A and Hospital B. The tenant boundary the whole app is about. */
export const companies = pgTable('companies', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull()
});

/**
 * Seeded users for the dev switch. No password or session column: the brief
 * allows this instead of a login system, and a half-built one would be worse
 * than an obviously fake one.
 */
export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id)
});

export const uploads = pgTable(
	'uploads',
	{
		id: uuid('id').primaryKey().defaultRandom(),

		sampleId: text('sample_id').notNull(),

		/** As the user sent it, for display. The key uses a sanitised version -
		 *  see safeFilename() in object-key.ts. */
		filename: text('filename').notNull(),

		classification: text('classification').notNull(),

		/** This single column is the entire access rule. */
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id),

		/** Derived server-side; never accepted from the browser. */
		objectKey: text('object_key').notNull(),

		status: uploadStatus('status').notNull().default('pending'),

		/** Filled at confirm time from MinIO's view of the object, not from what
		 *  the browser claimed. Non-null means the bytes are really there. */
		sizeBytes: integer('size_bytes'),
		contentType: text('content_type'),

		failureReason: text('failure_reason'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

		/**
		 * Soft delete. The row and the object are both kept: in a hospital,
		 * retention obligations usually outlive one user's decision to delete.
		 * Nothing in the app can restore it, so the warning the user confirms is
		 * accurate.
		 *
		 * The risk is a query that forgets this column. Contained by there being
		 * two reads of this table - requireAccessibleUpload() and the list query.
		 */
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [
		// Matches the only read pattern: one company, newest first.
		index('uploads_company_id_created_at_idx').on(table.companyId, table.createdAt)
	]
);

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type { UploadStatus } from '../../uploads';
