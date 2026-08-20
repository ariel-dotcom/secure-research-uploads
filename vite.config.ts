import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// This app runs locally under Node, next to its own Postgres and
			// MinIO containers. adapter-auto is for detecting a cloud host,
			// which there is not one of here.
			adapter: adapter(),

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts', '../scripts/**/*.ts');
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					// Points config.ts at the test database and bucket before any
					// module reads them. See src/test-setup.ts.
					setupFiles: ['./src/test-setup.ts'],
					// The integration tests share one Postgres database and one
					// MinIO bucket, and truncate between cases, so they cannot run
					// in parallel with each other.
					fileParallelism: false,
					// Simulated processing is a chain of timers, so a few cases
					// wait on real elapsed time.
					testTimeout: 20000
				}
			}
		]
	}
});
