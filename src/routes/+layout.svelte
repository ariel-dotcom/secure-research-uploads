<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { invalidateAll } from '$app/navigation';

	let { children, data } = $props();

	let switching = $state(false);
	let switchError = $state<string | null>(null);

	/**
	 * invalidateAll() re-runs the layout load, and the page reloads its list.
	 * Nothing is filtered in the browser - switching changes what the server
	 * will answer with, which is the whole demonstration.
	 */
	async function switchUser(userId: string) {
		switching = true;
		switchError = null;

		try {
			const response = await fetch('/api/dev-user', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ userId })
			});

			if (!response.ok) throw new Error('Could not switch user.');

			await invalidateAll();
		} catch {
			switchError = 'Could not switch user. Is the database running?';
		} finally {
			switching = false;
		}
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-6 py-4">
			<div class="mr-auto">
				<h1 class="text-lg font-semibold">Research image uploads</h1>
				<p class="text-sm text-slate-500">Private storage, scoped to your hospital.</p>
			</div>

			<div class="flex items-center gap-2">
				<span class="text-sm text-slate-500">Signed in as</span>
				{#each data.users as user (user.id)}
					<button
						type="button"
						onclick={() => switchUser(user.id)}
						disabled={switching || user.id === data.currentUserId}
						aria-pressed={user.id === data.currentUserId}
						class="rounded border px-3 py-1.5 text-sm font-medium transition
							{user.id === data.currentUserId
							? 'border-slate-900 bg-slate-900 text-white'
							: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}
							disabled:cursor-default"
					>
						{user.name}
					</button>
				{/each}
			</div>
		</div>

		{#if switchError}
			<p class="mx-auto max-w-3xl px-6 pb-3 text-sm text-red-700">{switchError}</p>
		{/if}
	</header>

	<main class="mx-auto max-w-3xl px-6 py-8">
		{@render children()}
	</main>
</div>
