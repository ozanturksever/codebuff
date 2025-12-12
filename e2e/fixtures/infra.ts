/**
 * Infrastructure fixture for e2e tests
 * Reuses CLI e2e utilities for Docker database and web server management
 */

import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface E2EDatabase {
  containerId: string
  containerName: string
  port: number
  databaseUrl: string
}

export interface E2EServer {
  process: import('child_process').ChildProcess
  port: number
  url: string
  backendUrl: string
}

export interface E2EInfrastructure {
  db: E2EDatabase
  server: E2EServer
  cleanup: () => Promise<void>
}

/**
 * Create e2e infrastructure with isolated database and server
 */
export async function createE2EInfrastructure(testId: string): Promise<E2EInfrastructure> {
  // Import CLI e2e utilities dynamically
  // Note: These imports work because bun handles __dirname in the imported module's context
  const testDbUtils = await import('../../cli/src/__tests__/e2e/test-db-utils')
  const testServerUtils = await import('../../cli/src/__tests__/e2e/test-server-utils')

  console.log(`[E2E Infra] Creating infrastructure for test: ${testId}`)

  // Create database
  const db = await testDbUtils.createE2EDatabase(testId)
  console.log(`[E2E Infra] Database ready on port ${db.port}`)

  // Start server - let bun's env hierarchy handle port selection from .env.development.local
  // Don't specify a port to allow the test-server-utils to use environment defaults
  const server = await testServerUtils.startE2EServer(db.databaseUrl)
  console.log(`[E2E Infra] Server ready at ${server.url}`)

  const cleanup = async () => {
    console.log(`[E2E Infra] Cleaning up infrastructure for test: ${testId}`)
    await testServerUtils.stopE2EServer(server)
    await testDbUtils.destroyE2EDatabase(db)
    console.log(`[E2E Infra] Cleanup complete`)
  }

  return { db, server, cleanup }
}

/**
 * Check if Docker is available
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if SDK is built
 */
export function isSDKBuilt(): boolean {
  try {
    const sdkDistDir = path.join(__dirname, '../../sdk/dist')
    const possibleArtifacts = ['index.js', 'index.mjs', 'index.cjs']
    return possibleArtifacts.some((file) =>
      fs.existsSync(path.join(sdkDistDir, file)),
    )
  } catch {
    return false
  }
}

/**
 * Clean up any orphaned e2e containers
 */
export function cleanupOrphanedInfrastructure(): void {
  console.log('[E2E Infra] Cleaning up orphaned infrastructure...')
  
  // Clean containers
  try {
    const containers = execSync(
      'docker ps -aq --filter "name=manicode-e2e-"',
      { encoding: 'utf8' }
    ).trim()

    if (containers) {
      execSync(`docker rm -f ${containers.split('\n').join(' ')}`, { stdio: 'pipe' })
      console.log('[E2E Infra] Cleaned up orphaned containers')
    }
  } catch {
    // Ignore errors
  }

  // Clean up ports 3100-3199
  for (let port = 3100; port < 3200; port++) {
    try {
      const pid = execSync(`lsof -t -i:${port}`, { encoding: 'utf8' }).trim()
      if (pid) {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' })
      }
    } catch {
      // Port not in use
    }
  }
}
