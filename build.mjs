// Custom esbuild-based build script for Cloudflare Pages
// Replaces Vite/Rollup SSR build which OOMs on low-memory environments
import * as esbuild from 'esbuild'
import { cpSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// 0. Compile Tailwind CSS (scans src/** via @source in tailwind.input.css)
try {
  execSync('npx @tailwindcss/cli -i ./tailwind.input.css -o ./public/static/tailwind.css --minify', { stdio: 'inherit' })
} catch (e) {
  console.warn('⚠️  Tailwind build failed — using existing public/static/tailwind.css')
}

const DIST = 'dist'
const PUBLIC = 'public'

// 1. Clean and create dist directory
mkdirSync(DIST, { recursive: true })

// 2. Create a thin entry wrapper that Cloudflare Pages expects
const entryWrapper = `
import app from './src/index.tsx'
export default { fetch: app.fetch }
`
writeFileSync('_cf_entry.ts', entryWrapper)

// 3. Build with esbuild (much faster & lower memory than Rollup)
await esbuild.build({
  entryPoints: ['_cf_entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: join(DIST, '_worker.js'),
  minify: false,
  sourcemap: false,
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', '__STATIC_CONTENT_MANIFEST'],
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
})

// 4. Copy public/ assets to dist/
if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true })
}

// 5. Generate _routes.json for Cloudflare Pages (static vs dynamic routing)
function getStaticPaths(dir, prefix = '') {
  const paths = []
  if (!existsSync(dir)) return paths
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      paths.push(`${prefix}/${entry.name}/*`)
    } else if (entry.name !== '_worker.js' && entry.name !== '_routes.json') {
      paths.push(`${prefix}/${entry.name}`)
    }
  }
  return paths
}

const staticPaths = getStaticPaths(PUBLIC).filter(p => !p.includes('google') || !p.endsWith('.html'))
const routesJson = {
  version: 1,
  include: ['/*'],
  exclude: staticPaths
}
writeFileSync(join(DIST, '_routes.json'), JSON.stringify(routesJson, null, 2))

// 6. Cleanup temp file  
import { unlinkSync } from 'node:fs'
try { unlinkSync('_cf_entry.ts') } catch {}

console.log('✅ Build complete! Output in dist/')
