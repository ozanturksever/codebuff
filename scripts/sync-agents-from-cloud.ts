#!/usr/bin/env bun
/**
 * Sync agents from codebuff.com cloud to self-hosted database.
 *
 * This script:
 * 1. Prompts for your codebuff.com API key
 * 2. Fetches the list of all published agents from codebuff.com
 * 3. Downloads each agent's configuration
 * 4. Inserts/updates them in the local database
 *
 * Usage:
 *   bun run scripts/sync-agents-from-cloud.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   CLOUD_URL - Override cloud URL (default: https://codebuff.com)
 */

// Set default DATABASE_URL for self-hosted setup if not provided
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://manicode_user_local:secretpassword_local@localhost:5433/manicode_db_local'
}

import db from '@codebuff/internal/db'
import { publisher, agentConfig } from '@codebuff/internal/db/schema'
import { eq, and } from 'drizzle-orm'
import * as readline from 'readline'

const CLOUD_URL = process.env.CLOUD_URL || 'https://www.codebuff.com'

async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    console.log('\nGet your API key from: https://codebuff.com/settings\n')
    rl.question('Enter your codebuff.com API key: ', (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

let API_KEY: string

interface AgentListItem {
  id: string
  publisher: { id: string }
  version: string
  displayName?: string
  version_stats?: Record<string, unknown>
}

interface AgentVersion {
  id: string
  publisherId: string
  version: string
}

interface AgentDetail {
  id: string
  version: string
  publisherId: string
  data: Record<string, unknown>
}

async function fetchAgentList(): Promise<AgentVersion[]> {
  console.log(`Fetching agent list from ${CLOUD_URL}/api/agents...`)

  const response = await fetch(`${CLOUD_URL}/api/agents`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch agent list: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  
  // The API returns { agents: [...] } or just an array
  const agents: AgentListItem[] = Array.isArray(data) ? data : data.agents || []
  
  // Extract all versions from version_stats for each agent
  const allVersions: AgentVersion[] = []
  for (const agent of agents) {
    const publisherId = agent.publisher.id
    const versions = agent.version_stats ? Object.keys(agent.version_stats) : [agent.version]
    
    for (const version of versions) {
      allVersions.push({
        id: agent.id,
        publisherId,
        version,
      })
    }
  }
  
  console.log(`✓ Found ${agents.length} agents with ${allVersions.length} total versions in cloud`)
  
  return allVersions
}

async function fetchAgentDetail(publisherId: string, agentId: string, version: string): Promise<AgentDetail | null> {
  const url = `${CLOUD_URL}/api/v1/agents/${publisherId}/${agentId}/${version}`
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    console.warn(`  ⚠ Failed to fetch ${publisherId}/${agentId}@${version}: ${response.status}`)
    return null
  }

  return response.json()
}

async function ensurePublisher(publisherId: string): Promise<void> {
  const existing = await db
    .select()
    .from(publisher)
    .where(eq(publisher.id, publisherId))
    .limit(1)

  if (existing.length > 0) {
    return
  }

  // Create publisher with a placeholder user
  // First check if seed user exists
  console.log(`  Creating publisher: ${publisherId}`)
  await db.insert(publisher).values({
    id: publisherId,
    name: publisherId,
    user_id: 'user-seed-docker',
    created_by: 'user-seed-docker',
    verified: true,
  })
}

async function syncAgent(agent: AgentVersion): Promise<{ synced: boolean; skipped: boolean }> {
  const { publisherId, id: agentId, version } = agent

  // Check if this exact version already exists
  const existing = await db
    .select()
    .from(agentConfig)
    .where(
      and(
        eq(agentConfig.publisher_id, publisherId),
        eq(agentConfig.id, agentId),
        eq(agentConfig.version, version),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return { synced: false, skipped: true }
  }

  // Fetch full agent details
  const detail = await fetchAgentDetail(publisherId, agentId, version)
  if (!detail) {
    return { synced: false, skipped: false }
  }

  // Ensure publisher exists
  await ensurePublisher(publisherId)

  // Insert agent
  try {
    await db.insert(agentConfig).values({
      id: agentId,
      version,
      publisher_id: publisherId,
      data: detail.data,
    })
    console.log(`  ✓ ${publisherId}/${agentId}@${version}`)
    return { synced: true, skipped: false }
  } catch (error: any) {
    console.error(`  ✗ ${publisherId}/${agentId}@${version}: ${error.message}`)
    return { synced: false, skipped: false }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Syncing Agents from Codebuff Cloud')
  console.log('═══════════════════════════════════════════════════════════')

  // Prompt for API key
  API_KEY = await promptForApiKey()
  
  if (!API_KEY) {
    console.error('Error: API key is required')
    process.exit(1)
  }

  try {
    // Fetch list of all agents
    const agents = await fetchAgentList()

    if (agents.length === 0) {
      console.log('No agents found in cloud')
      return
    }

    console.log(`\nSyncing ${agents.length} agents...`)

    let synced = 0
    let skipped = 0
    let failed = 0

    for (const agent of agents) {
      const result = await syncAgent(agent)
      if (result.synced) synced++
      else if (result.skipped) skipped++
      else failed++
    }

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log(`  ✓ Sync complete!`)
    console.log(`    - Synced: ${synced}`)
    console.log(`    - Skipped (already exists): ${skipped}`)
    if (failed > 0) console.log(`    - Failed: ${failed}`)
    console.log('═══════════════════════════════════════════════════════════\n')
  } catch (error) {
    console.error('\n✗ Sync failed:', error)
    process.exit(1)
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
