#!/usr/bin/env bun
/**
 * Seed default agents for self-hosted Docker Compose deployments.
 *
 * This script:
 * 1. Creates a seed user (or uses existing credentials if available)
 * 2. Creates the 'codebuff' publisher
 * 3. Loads all agent definitions from .agents/ directory
 * 4. Publishes them to the agent_config table
 *
 * Usage:
 *   bun run scripts/seed-default-agents.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 */

import path from 'path'
import db from '@codebuff/internal/db'
import { user, publisher, agentConfig } from '@codebuff/internal/db/schema'
import { validateAgents } from '@codebuff/common/templates/agent-validation'
import { loadLocalAgents } from '@codebuff/sdk'
import { eq, and } from 'drizzle-orm'

import type { Logger } from '@codebuff/common/types/contracts/logger'

const PUBLISHER_ID = 'codebuff'
const SEED_USER_ID = 'user-seed-docker'
const SEED_USER_EMAIL = 'seed@localhost'
const SEED_USER_NAME = 'Docker Seed User'

const logger: Logger = {
  debug: (obj, msg) => console.log(`[DEBUG] ${msg ?? ''}`, obj),
  info: (obj, msg) => console.log(`[INFO] ${msg ?? ''}`, obj),
  warn: (obj, msg) => console.warn(`[WARN] ${msg ?? ''}`, obj),
  error: (obj, msg) => console.error(`[ERROR] ${msg ?? ''}`, obj),
}

async function ensureUser(): Promise<string> {
  const existingUser = await db
    .select()
    .from(user)
    .where(eq(user.id, SEED_USER_ID))
    .limit(1)

  if (existingUser.length > 0) {
    console.log(`✓ User already exists: ${SEED_USER_ID}`)
    return SEED_USER_ID
  }

  console.log(`Creating seed user: ${SEED_USER_ID}`)
  await db.insert(user).values({
    id: SEED_USER_ID,
    email: SEED_USER_EMAIL,
    name: SEED_USER_NAME,
    emailVerified: new Date(),
  })

  console.log(`✓ Created user: ${SEED_USER_ID}`)
  return SEED_USER_ID
}

async function ensurePublisher(userId: string): Promise<void> {
  const existingPublisher = await db
    .select()
    .from(publisher)
    .where(eq(publisher.id, PUBLISHER_ID))
    .limit(1)

  if (existingPublisher.length > 0) {
    console.log(`✓ Publisher already exists: ${PUBLISHER_ID}`)
    return
  }

  console.log(`Creating publisher: ${PUBLISHER_ID}`)
  await db.insert(publisher).values({
    id: PUBLISHER_ID,
    name: 'Codebuff',
    user_id: userId,
    created_by: userId,
    verified: true,
  })

  console.log(`✓ Created publisher: ${PUBLISHER_ID}`)
}

async function loadAgentDefinitions(): Promise<Record<string, any>> {
  const agentsPath = path.resolve(__dirname, '../.agents')
  console.log(`Loading agents from: ${agentsPath}`)

  try {
    const agents = await loadLocalAgents({ agentsPath })
    console.log(`✓ Loaded ${Object.keys(agents).length} agent definitions`)
    return agents
  } catch (error) {
    console.error('Failed to load agents:', error)
    throw error
  }
}

async function publishAgents(agents: Record<string, any>): Promise<void> {
  const agentList = Object.values(agents)
  console.log(`\nPublishing ${agentList.length} agents...`)

  // Prepare agents with publisher field and convert handleSteps to string
  const preparedAgents = agentList.map((agent: any) => {
    const prepared = {
      ...agent,
      publisher: PUBLISHER_ID,
      version: agent.version || '0.0.1',
    }

    // Convert handleSteps function to string if present
    if (typeof prepared.handleSteps === 'function') {
      prepared.handleSteps = prepared.handleSteps.toString()
    }

    return prepared
  })

  // Create agent map for validation
  const agentMap = preparedAgents.reduce(
    (acc: Record<string, any>, agent: any) => {
      acc[agent.id] = agent
      return acc
    },
    {} as Record<string, any>,
  )

  // Validate agents (skip spawnable agent DB check for seeding - all agents are being seeded together)
  const { validationErrors, dynamicTemplates } = validateAgents({
    agentTemplates: agentMap,
    logger,
  })

  if (validationErrors.length > 0) {
    console.warn(
      `\n⚠ ${validationErrors.length} agents failed validation:`,
    )
    for (const err of validationErrors) {
      console.warn(`  - ${err.message}`)
    }
  }

  const validAgents = Object.values(dynamicTemplates)
  console.log(`\n${validAgents.length} agents passed validation`)

  // Insert agents into database
  let inserted = 0
  let skipped = 0

  for (const agent of validAgents) {
    const agentId = (agent as any).id
    const version = (agent as any).version || '0.0.1'

    // Check if this agent+version already exists
    const existing = await db
      .select()
      .from(agentConfig)
      .where(
        and(
          eq(agentConfig.publisher_id, PUBLISHER_ID),
          eq(agentConfig.id, agentId),
          eq(agentConfig.version, version),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      skipped++
      continue
    }

    try {
      await db.insert(agentConfig).values({
        id: agentId,
        version,
        publisher_id: PUBLISHER_ID,
        data: agent,
      })
      inserted++
      console.log(`  ✓ ${agentId}@${version}`)
    } catch (error: any) {
      console.error(`  ✗ ${agentId}@${version}: ${error.message}`)
    }
  }

  console.log(`\n✓ Published ${inserted} new agents`)
  if (skipped > 0) {
    console.log(`  (${skipped} agents already existed)`)
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Seeding Default Agents for Self-Hosted Codebuff')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    // Step 1: Ensure seed user exists
    const userId = await ensureUser()

    // Step 2: Ensure publisher exists
    await ensurePublisher(userId)

    // Step 3: Load agent definitions
    const agents = await loadAgentDefinitions()

    // Step 4: Publish agents
    await publishAgents(agents)

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('  ✓ Seed complete!')
    console.log('═══════════════════════════════════════════════════════════\n')
  } catch (error) {
    console.error('\n✗ Seed failed:', error)
    process.exit(1)
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
