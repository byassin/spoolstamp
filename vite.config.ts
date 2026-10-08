import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { localStudioTransfer } from './scripts/local-studio-transfer.ts';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const hostingPath = new URL('./.openai/hosting.json', import.meta.url);
const hostingConfig = existsSync(hostingPath)
  ? (JSON.parse(readFileSync(hostingPath, 'utf8')) as {
      d1?: string | null;
      r2?: string | null;
    })
  : null;
const { d1, r2 } = hostingConfig ?? {};

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  const staticBuild = process.env.SPOOLSTAMP_BUILD_TARGET === 'static';
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const cloudflarePlugins = staticBuild
    ? []
    : [
        (await import('@cloudflare/vite-plugin')).cloudflare({
          viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
          config: localBindingConfig,
        }),
      ];

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      localStudioTransfer(),
      vinext(),
      // Keep Sites packaging support without its unused development sign-in.
      ...(hostingConfig && !staticBuild && command === 'build' ? [sites()] : []),
      ...cloudflarePlugins,
    ],
  };
});
