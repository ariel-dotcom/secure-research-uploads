<script lang="ts">
	import {
		CLASSIFICATIONS,
		ALLOWED_CONTENT_TYPES,
		MAX_UPLOAD_BYTES,
		STATUS_TEXT,
		TERMINAL_STATUSES,
		formatBytes,
		type UploadView
	} from '$lib/uploads';
	import {
		uploadFile,
		downloadUpload,
		getViewUrl,
		deleteUpload,
		listUploads,
		UploadError,
		type UploadPhase
	} from '$lib/upload-client';

	let { data } = $props();

	// Fetched from /api/uploads rather than a load function, so the UI and the
	// tests hit the same endpoint and the loading state is a real one.

	let records = $state<UploadView[]>([]);
	let listState = $state<'loading' | 'ready' | 'error'>('loading');
	let listError = $state<string | null>(null);

	async function refresh() {
		try {
			records = await listUploads();
			listState = 'ready';
			listError = null;
		} catch (cause) {
			listState = 'error';
			listError = cause instanceof UploadError ? cause.message : 'Could not load your uploads.';
		}
	}

	// Nothing is filtered in the browser - switching user changes what the
	// server is willing to answer with.
	$effect(() => {
		data.currentUserId;
		listState = 'loading';
		refresh();
	});

	// A timeout scheduled after each refresh rather than an interval, so two
	// requests cannot overlap and polling stops once everything has settled.
	const POLL_MS = 1500;

	$effect(() => {
		// Reads `records` directly, and deliberately not a $derived boolean.
		//
		// This effect has to re-run after every refresh in order to schedule the
		// next one. A $derived memoises on equality, so a "is anything still in
		// flight?" boolean would stay true through pending -> uploaded -> queued
		// -> processing and never notify this effect again: exactly one poll
		// would ever be scheduled, and the row would sit at its first status
		// until the page was reloaded by hand. Assigning a fresh array to
		// `records` always notifies, so the chain keeps going.
		const stillWorking = records.some((record) => !TERMINAL_STATUSES.includes(record.status));
		if (!stillWorking) return;

		const timer = setTimeout(refresh, POLL_MS);
		return () => clearTimeout(timer);
	});

	const inFlightCount = $derived(
		records.filter((record) => !TERMINAL_STATUSES.includes(record.status)).length
	);

	// Both panels stay mounted in state - only the rendering switches - so
	// polling and the tab count keep working while the form is showing.

	let activeTab = $state<'upload' | 'records'>('upload');

	// --- the form -------------------------------------------------------

	let sampleId = $state('');
	let classification = $state<string>('confidential');
	let file = $state<File | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	let phase = $state<UploadPhase>('idle');
	let percentSent = $state(0);
	let formError = $state<string | null>(null);
	let fieldErrors = $state<Record<string, string>>({});

	const busy = $derived(phase === 'creating' || phase === 'sending' || phase === 'confirming');

	async function submit(event: SubmitEvent) {
		event.preventDefault();

		formError = null;
		fieldErrors = {};

		if (!file) {
			fieldErrors = { file: 'Choose a file to upload.' };
			return;
		}

		try {
			await uploadFile(
				{ sampleId, classification, file },
				{
					onPhase: (next) => (phase = next),
					onProgress: (percent) => (percentSent = percent)
				}
			);

			sampleId = '';
			file = null;
			if (fileInput) fileInput.value = '';
			percentSent = 0;
			phase = 'idle';

			await refresh();

			// The next few seconds are worth watching, on the other panel.
			activeTab = 'records';
		} catch (cause) {
			phase = 'error';
			if (cause instanceof UploadError) {
				formError = cause.message;
				fieldErrors = cause.fieldErrors ?? {};
			} else {
				formError = 'Something went wrong. Please try again.';
			}
		}
	}

	function chooseFile(event: Event) {
		file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		delete fieldErrors.file;
	}

	// --- downloads ------------------------------------------------------

	let downloadErrors = $state<Record<string, string>>({});
	let downloading = $state<string | null>(null);

	async function download(uploadId: string) {
		downloading = uploadId;
		delete downloadErrors[uploadId];

		try {
			await downloadUpload(uploadId);
		} catch (cause) {
			downloadErrors[uploadId] =
				cause instanceof UploadError ? cause.message : 'Could not download this file.';
		} finally {
			downloading = null;
		}
	}

	// The URL is fetched on open and dropped on close, since it lives a minute.

	let viewing = $state<UploadView | null>(null);
	let viewUrl = $state<string | null>(null);
	let viewError = $state<string | null>(null);
	let viewerEl = $state<HTMLDialogElement | null>(null);

	async function openViewer(record: UploadView) {
		viewing = record;
		viewUrl = null;
		viewError = null;
		viewerEl?.showModal();

		try {
			viewUrl = await getViewUrl(record.id);
		} catch (cause) {
			viewError = cause instanceof UploadError ? cause.message : 'Could not open this image.';
		}
	}

	function closeViewer() {
		viewerEl?.close();
		viewing = null;
		viewUrl = null;
		viewError = null;
	}

	// --- deleting -------------------------------------------------------

	let pendingDelete = $state<UploadView | null>(null);
	let deleteError = $state<string | null>(null);
	let deleteBusy = $state(false);
	let confirmEl = $state<HTMLDialogElement | null>(null);

	function askToDelete(record: UploadView) {
		pendingDelete = record;
		deleteError = null;
		confirmEl?.showModal();
	}

	function cancelDelete() {
		confirmEl?.close();
		pendingDelete = null;
		deleteError = null;
	}

	async function confirmDelete() {
		if (!pendingDelete) return;

		deleteBusy = true;
		deleteError = null;

		try {
			await deleteUpload(pendingDelete.id);
			confirmEl?.close();
			pendingDelete = null;
			// Re-fetch rather than removing the row here: the list shows what the
			// server says exists, not what we assume.
			await refresh();
		} catch (cause) {
			deleteError = cause instanceof UploadError ? cause.message : 'Could not delete this upload.';
		} finally {
			deleteBusy = false;
		}
	}
</script>

{#if !data.currentUserId}
	<p class="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
		No seeded users found. Run <code class="font-mono">npm run db:setup</code> to create the two hospitals
		and their users.
	</p>
{/if}

<div class="mb-6 flex gap-1 border-b border-slate-200" role="tablist">
	<button
		type="button"
		role="tab"
		aria-selected={activeTab === 'upload'}
		onclick={() => (activeTab = 'upload')}
		class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition
			{activeTab === 'upload'
			? 'border-slate-900 text-slate-900'
			: 'border-transparent text-slate-500 hover:text-slate-800'}"
	>
		Upload an image
	</button>
	<button
		type="button"
		role="tab"
		aria-selected={activeTab === 'records'}
		onclick={() => (activeTab = 'records')}
		class="-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition
			{activeTab === 'records'
			? 'border-slate-900 text-slate-900'
			: 'border-transparent text-slate-500 hover:text-slate-800'}"
	>
		Your uploads
		{#if listState === 'ready'}
			<span class="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
				{records.length}
			</span>
		{/if}
		<!-- Something is still moving on the panel they cannot see. -->
		{#if inFlightCount > 0}
			<span
				class="h-2 w-2 animate-pulse rounded-full bg-amber-500"
				title="{inFlightCount} still processing"
			></span>
		{/if}
	</button>
</div>

<section class="rounded-lg border border-slate-200 bg-white p-6" hidden={activeTab !== 'upload'}>
	<h2 class="sr-only">Upload an image</h2>
	<p class="mt-1 text-sm text-slate-500">
		Up to {formatBytes(MAX_UPLOAD_BYTES)}. PNG, JPEG or TIFF.
	</p>

	<form class="mt-4 grid gap-4" onsubmit={submit}>
		<div class="grid gap-1">
			<label class="text-sm font-medium" for="sampleId">Sample ID</label>
			<input
				id="sampleId"
				bind:value={sampleId}
				disabled={busy}
				placeholder="SAMPLE-0142"
				class="rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
			/>
			{#if fieldErrors.sampleId}
				<p class="text-sm text-red-700">{fieldErrors.sampleId}</p>
			{/if}
		</div>

		<div class="grid gap-1">
			<label class="text-sm font-medium" for="classification">Classification</label>
			<select
				id="classification"
				bind:value={classification}
				disabled={busy}
				class="rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
			>
				{#each CLASSIFICATIONS as value (value)}
					<option {value}>{value}</option>
				{/each}
			</select>
			{#if fieldErrors.classification}
				<p class="text-sm text-red-700">{fieldErrors.classification}</p>
			{/if}
		</div>

		<div class="grid gap-1">
			<label class="text-sm font-medium" for="file">Image file</label>
			<input
				id="file"
				type="file"
				bind:this={fileInput}
				onchange={chooseFile}
				disabled={busy}
				accept={ALLOWED_CONTENT_TYPES.join(',')}
				class="rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
			/>
			{#if fieldErrors.file || fieldErrors.filename || fieldErrors.contentType || fieldErrors.sizeBytes}
				<p class="text-sm text-red-700">
					{fieldErrors.file ??
						fieldErrors.filename ??
						fieldErrors.contentType ??
						fieldErrors.sizeBytes}
				</p>
			{/if}
		</div>

		<div>
			<button
				type="submit"
				disabled={busy}
				class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
			>
				{busy ? 'Uploading...' : 'Upload'}
			</button>
		</div>

		<!--
			Three busy states, because they are three different things. Sending
			shows real bytes; the other two are single round trips with nothing to
			measure, so they say what they are waiting for instead of inventing a
			percentage.
		-->
		{#if phase === 'creating'}
			<div>
				<p class="text-sm text-slate-600">Preparing a secure upload link...</p>
				<div class="mt-1 h-2 animate-pulse rounded bg-slate-300"></div>
			</div>
		{:else if phase === 'sending'}
			<div>
				<p class="text-sm text-slate-600">Sending file to storage - {percentSent}%</p>
				<div class="mt-1 h-2 overflow-hidden rounded bg-slate-200">
					<div class="h-full bg-slate-900 transition-all" style="width: {percentSent}%"></div>
				</div>
			</div>
		{:else if phase === 'confirming'}
			<div>
				<p class="text-sm text-slate-600">Verifying the file arrived...</p>
				<div class="mt-1 h-2 animate-pulse rounded bg-slate-300"></div>
			</div>
		{/if}

		{#if formError}
			<p class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{formError}</p>
		{/if}
	</form>
</section>

<section hidden={activeTab !== 'records'}>
	<h2 class="sr-only">Your uploads</h2>

	{#if listState === 'loading'}
		<p class="text-sm text-slate-500">Loading your uploads...</p>
	{:else if listState === 'error'}
		<p class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
			{listError}
		</p>
	{:else if records.length === 0}
		<div class="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
			<p class="text-sm font-medium text-slate-700">No uploads yet</p>
			<p class="mt-1 text-sm text-slate-500">
				Use the upload tab to add the first image for a sample. Only your hospital will be able to
				see it.
			</p>
		</div>
	{:else}
		<!-- Scrolls inside a fixed height rather than growing the page. Not
		     pagination, which the brief rules out. -->
		<ul class="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">
			{#each records as record (record.id)}
				<li class="rounded-lg border border-slate-200 bg-white p-4">
					<div class="flex flex-wrap items-start gap-3">
						<div class="mr-auto">
							<p class="font-medium">{record.filename}</p>
							<p class="text-sm text-slate-500">
								Sample {record.sampleId} &middot; {record.classification}
								{#if record.sizeBytes}&middot; {formatBytes(record.sizeBytes)}{/if}
							</p>
						</div>

						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								onclick={() => openViewer(record)}
								disabled={record.status === 'pending'}
								class="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium
									hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400
									disabled:hover:bg-white"
							>
								View
							</button>

							<button
								type="button"
								onclick={() => download(record.id)}
								disabled={record.status === 'pending' || downloading === record.id}
								class="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium
									hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400
									disabled:hover:bg-white"
							>
								{downloading === record.id ? 'Preparing...' : 'Download'}
							</button>

							<button
								type="button"
								onclick={() => askToDelete(record)}
								class="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
									hover:bg-red-50"
							>
								Delete
							</button>
						</div>
					</div>

					<p class="mt-2 text-sm text-slate-600">{STATUS_TEXT[record.status]}</p>

					{#if record.failureReason}
						<p class="mt-1 text-sm text-red-700">{record.failureReason}</p>
					{/if}

					{#if downloadErrors[record.id]}
						<p class="mt-1 text-sm text-red-700">{downloadErrors[record.id]}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!--
	The browser's own <dialog> rather than a hand-built overlay: focus trapping,
	Escape, and the backdrop come for free. m-auto is needed because Tailwind's
	reset clears the margin: auto that centres a modal dialog.
-->

<dialog
	bind:this={confirmEl}
	onclose={cancelDelete}
	class="max-w-md rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40"
>
	{#if pendingDelete}
		<div class="flex flex-col gap-4 p-6">
			<h2 class="text-base font-semibold">Delete this upload?</h2>

			<p class="text-sm text-slate-600">
				Are you sure you want to delete <span class="font-medium text-slate-900"
					>{pendingDelete.filename}</span
				>? You will not be able to restore it.
			</p>

			{#if deleteError}
				<p class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
					{deleteError}
				</p>
			{/if}

			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={cancelDelete}
					disabled={deleteBusy}
					class="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={confirmDelete}
					disabled={deleteBusy}
					class="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800
						disabled:bg-red-300"
				>
					{deleteBusy ? 'Deleting...' : 'Delete'}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<dialog
	bind:this={viewerEl}
	onclose={closeViewer}
	class="max-h-[90vh] max-w-[90vw] rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/70"
>
	{#if viewing}
		<div class="flex flex-col gap-3 p-4">
			<div class="flex items-start gap-4">
				<div class="mr-auto">
					<p class="font-medium">{viewing.filename}</p>
					<p class="text-sm text-slate-500">
						Sample {viewing.sampleId} &middot; {viewing.classification}
					</p>
				</div>
				<button
					type="button"
					onclick={closeViewer}
					class="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
				>
					Close
				</button>
			</div>

			{#if viewError}
				<p class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
					{viewError}
				</p>
			{:else if viewUrl}
				<!-- Straight from MinIO, on a link that dies in a minute. -->
				<img
					src={viewUrl}
					alt={viewing.filename}
					class="max-h-[70vh] max-w-full rounded object-contain"
				/>
			{:else}
				<p class="p-8 text-center text-sm text-slate-500">Opening image...</p>
			{/if}
		</div>
	{/if}
</dialog>
