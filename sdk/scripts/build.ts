// Build script for @codebuff/sdk using Bun's bundler with dual package support
// Creates ESM + CJS bundles with TypeScript declarations

import { mkdir, cp, readFile, writeFile, rm } from 'fs/promises'
import Module from 'module'
import { delimiter, join } from 'path'

import { generateDtsBundle } from 'dts-bundle-generator'

const workspaceNodeModules = join(import.meta.dir, '..', 'node_modules')
const existingNodePath = process.env.NODE_PATH ?? ''
const nodePathEntries = existingNodePath
  ? new Set(existingNodePath.split(delimiter))
  : new Set<string>()

if (!nodePathEntries.has(workspaceNodeModules)) {
  nodePathEntries.add(workspaceNodeModules)
  process.env.NODE_PATH = Array.from(nodePathEntries).join(delimiter)
  const moduleWithInit = Module as unknown as { _initPaths?: () => void }
  moduleWithInit._initPaths?.()
}

async function build() {
  console.log('🧹 Cleaning dist directory...')
  await rm('dist', { recursive: true, force: true })

  await mkdir('./dist', { recursive: true })

  // Read external dependencies from package.json
  const pkgText = await Bun.file('./package.json').text()
  const pkg = JSON.parse(pkgText)
  const external = [
    // Only exclude actual npm dependencies, not workspace packages
    ...Object.keys(pkg.dependencies || {}).filter(
      (dep) => !dep.startsWith('@codebuff/'),
    ),
    // Add Node.js built-ins
    'fs',
    'path',
    'child_process',
    'os',
    'crypto',
    'stream',
    'util',
    'ws',
    'bufferutil',
    'utf-8-validate',
    'http',
    'https',
    'net',
    'tls',
    'url',
    'events',
  ]

  console.log('📦 Building ESM format...')
  await Bun.build({
    entrypoints: ['src/index.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'esm',
    minify: false,
    sourcemap: 'linked',
    external,
    naming: '[dir]/index.mjs',
    env: 'NEXT_PUBLIC_*',
    loader: {
      '.scm': 'text',
    },
    plugins: [],
  })

  console.log('📦 Building CJS format...')
  await Bun.build({
    entrypoints: ['src/index.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'cjs',
    minify: false,
    sourcemap: 'linked',
    external,
    naming: '[dir]/index.cjs',
    define: {
      'import.meta.url': 'undefined',
      'import.meta': 'undefined',
    },
    env: 'NEXT_PUBLIC_*',
    loader: {
      '.scm': 'text',
    },
    plugins: [],
  })

  // Convex bundle has additional externals to avoid tree-sitter/WASM dependencies
  const convexExternal = [
    ...external,
    '@codebuff/code-map',
    '@codebuff/code-map/parse',
    'web-tree-sitter',
    '@vscode/tree-sitter-wasm',
  ]

  // Disable source maps for Convex builds to prevent Convex bundler from
  // following source map paths to monorepo packages like @codebuff/code-map
  console.log('📦 Building Convex ESM format...')
  await Bun.build({
    entrypoints: ['src/convex.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    external: convexExternal,
    naming: '[dir]/convex.mjs',
    env: 'NEXT_PUBLIC_*',
    loader: {
      '.scm': 'text',
    },
    plugins: [],
  })

  console.log('📦 Building Convex CJS format...')
  await Bun.build({
    entrypoints: ['src/convex.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'cjs',
    minify: false,
    sourcemap: 'none',
    external: convexExternal,
    naming: '[dir]/convex.cjs',
    define: {
      'import.meta.url': 'undefined',
      'import.meta': 'undefined',
    },
    env: 'NEXT_PUBLIC_*',
    loader: {
      '.scm': 'text',
    },
    plugins: [],
  })

  console.log('📝 Generating and bundling TypeScript declarations...')
  try {
    const bundles = generateDtsBundle(
      [
        {
          filePath: 'src/index.ts',
          output: {
            exportReferencedTypes: false,
          },
          libraries: {
            // Treat all @codebuff/* workspace packages as external imports
            // so dts-bundle-generator doesn't fail on their internal relative imports
            importedLibraries: [
              '@codebuff/common',
              '@codebuff/agent-runtime',
              '@codebuff/code-map',
            ],
          },
        },
        {
          filePath: 'src/convex.ts',
          output: {
            exportReferencedTypes: false,
          },
          libraries: {
            importedLibraries: [
              '@codebuff/common',
              '@codebuff/agent-runtime',
              '@codebuff/code-map',
            ],
          },
        },
      ],
      {
        preferredConfigPath: join(import.meta.dir, '..', 'tsconfig.json'),
      },
    )

    await writeFile('dist/index.d.ts', bundles[0])
    await writeFile('dist/convex.d.ts', bundles[1])
    await fixDuplicateImports()
    await fixConvexDuplicateImports()
    console.log('  ✓ Created bundled type definitions')
  } catch (error) {
    console.warn('⚠ TypeScript declaration bundling failed:', error.message)
  }

  console.log('📂 Copying WASM files for tree-sitter...')
  await copyWasmFiles()

  console.log('📂 Copying vendored ripgrep binaries...')
  await copyRipgrepVendor()

  console.log('✅ Build complete!')
  console.log('  📄 dist/index.mjs (ESM)')
  console.log('  📄 dist/index.cjs (CJS)')
  console.log('  📄 dist/index.d.ts (Types)')
  console.log('  📄 dist/convex.mjs (Convex ESM)')
  console.log('  📄 dist/convex.cjs (Convex CJS)')
  console.log('  📄 dist/convex.d.ts (Convex Types)')
}

/**
 * Fix duplicate imports in the generated index.d.ts file
 */
async function fixDuplicateImports() {
  try {
    let content = await readFile('dist/index.d.ts', 'utf-8')

    // Remove any duplicate zod default imports (handle various whitespace)
    const zodDefaultImportRegex = /import\s+z\s+from\s+['"]zod\/v4['"];?\n?/g
    const zodNamedImportRegex =
      /import\s+\{\s*z\s*\}\s+from\s+['"]zod\/v4['"];?/

    // If we have both imports, remove all default imports and keep only the named one
    if (
      content.match(zodNamedImportRegex) &&
      content.match(zodDefaultImportRegex)
    ) {
      content = content.replace(zodDefaultImportRegex, '')
    }

    await writeFile('dist/index.d.ts', content)
    console.log('  ✓ Fixed duplicate imports in bundled types')
  } catch (error) {
    console.warn(
      '  ⚠ Warning: Could not fix duplicate imports:',
      error.message,
    )
  }
}

/**
 * Fix duplicate imports in the generated convex.d.ts file
 */
async function fixConvexDuplicateImports() {
  try {
    let content = await readFile('dist/convex.d.ts', 'utf-8')

    // Remove any duplicate zod default imports (handle various whitespace)
    const zodDefaultImportRegex = /import\s+z\s+from\s+['"]zod\/v4['"];?\n?/g
    const zodNamedImportRegex =
      /import\s+\{\s*z\s*\}\s+from\s+['"]zod\/v4['"];?/

    // If we have both imports, remove all default imports and keep only the named one
    if (
      content.match(zodNamedImportRegex) &&
      content.match(zodDefaultImportRegex)
    ) {
      content = content.replace(zodDefaultImportRegex, '')
    }

    await writeFile('dist/convex.d.ts', content)
    console.log('  ✓ Fixed duplicate imports in convex bundled types')
  } catch (error) {
    console.warn(
      '  ⚠ Warning: Could not fix convex duplicate imports:',
      error.message,
    )
  }
}

/**
 * Copy WASM files from @vscode/tree-sitter-wasm to shared dist/wasm directory
 */
async function copyWasmFiles() {
  const wasmSourceDir = '../node_modules/@vscode/tree-sitter-wasm/wasm'
  const wasmFiles = [
    'tree-sitter.wasm', // Main tree-sitter WASM file
    'tree-sitter-c-sharp.wasm',
    'tree-sitter-cpp.wasm',
    'tree-sitter-go.wasm',
    'tree-sitter-java.wasm',
    'tree-sitter-javascript.wasm',
    'tree-sitter-python.wasm',
    'tree-sitter-ruby.wasm',
    'tree-sitter-rust.wasm',
    'tree-sitter-tsx.wasm',
    'tree-sitter-typescript.wasm',
  ]

  // Create shared wasm directory
  await mkdir('dist/wasm', { recursive: true })

  // Copy each WASM file to shared directory only
  for (const wasmFile of wasmFiles) {
    try {
      await cp(`${wasmSourceDir}/${wasmFile}`, `dist/wasm/${wasmFile}`)
      console.log(`  ✓ Copied ${wasmFile}`)
    } catch (error) {
      console.warn(`  ⚠ Warning: Could not copy ${wasmFile}:`, error.message)
    }
  }
}

async function copyRipgrepVendor() {
  const vendorSrc = 'vendor/ripgrep'
  const vendorDest = 'dist/vendor/ripgrep'
  try {
    await mkdir(vendorDest, { recursive: true })
    await cp(vendorSrc, vendorDest, { recursive: true })
    console.log('  ✓ Copied vendored ripgrep binaries')
  } catch (e) {
    console.warn(
      '  ⚠ No vendored ripgrep found; skipping (use fetch-ripgrep.ts first)',
    )
  }
}

if (import.meta.main) {
  build().catch(console.error)
}
