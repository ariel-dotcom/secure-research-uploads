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
	const hasWorkInFlight = $derived(
		records.some((record) => !TERMINAL_STATUSES.includes(record.status))
	);

	$effect(() => {
		if (!hasWorkInFlight) return;
		const timer = setTimeout(refresh, POLL_MS);
		return () => clearTimeout(timer);
	});

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
</script>

{#if !data.currentUserId}
	<p class="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
		No seeded users found. Run <code class="font-mono">npm run db:setup</code> to create the two hospitals
		and their users.
	</p>
{/if}

<section class="rounded-lg border border-slate-200 bg-white p-6">
	<h2 class="text-base font-semibold">Upload an image</h2>
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

<section class="mt-8">
	<h2 class="text-base font-semibold">Your uploads</h2>

	{#if listState === 'loading'}
		<p class="mt-4 text-sm text-slate-500">Loading your uploads...</p>
	{:else if listState === 'error'}
		<p class="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
			{listError}
		</p>
	{:else if records.length === 0}
		<div class="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
			<p class="text-sm font-medium text-slate-700">No uploads yet</p>
			<p class="mt-1 text-sm text-slate-500">
				Use the form above to add the first image for a sample. Only your hospital will be able to
				see it.
			</p>
		</div>
	{:else}
		<ul class="mt-4 grid gap-3">
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
