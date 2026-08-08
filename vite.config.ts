import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Actions sets GITHUB_SHA on every build; local builds fall back to a
// timestamp. Either way, this uniquely fingerprints "what code is actually
// running" so a stale tab can tell it's stale (see writeVersionFile below
// and src/utility/useVersionCheck.ts) instead of silently serving an old
// build indefinitely -- e.g. a coach who logs on Monday and still has the
// tab open Friday, past several deploys.
const buildId = process.env.GITHUB_SHA ?? String(Date.now())

// public/ files get shipped verbatim with no cache-busting hash in the
// filename (unlike JS/CSS), which is exactly what a version-check endpoint
// needs: a stable URL a running tab can re-fetch after a new deploy and get
// fresh content back, without needing to know the new build's asset names.
const writeVersionFile = () => ({
  name: 'write-version-file',
  writeBundle(options: { dir?: string }) {
    if (!options.dir) return
    writeFileSync(join(options.dir, 'version.json'), JSON.stringify({ buildId }))
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: '/next-step-timesheets/',
  plugins: [react(), writeVersionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
})
