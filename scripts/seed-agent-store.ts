import db from '@codebuff/internal/db'
import { user, publisher } from '@codebuff/internal/db/schema'
import { getUserCredentials } from '../cli/src/utils/auth'
import { eq } from 'drizzle-orm'

async function main() {
  let userId = 'user-seed-1'
  let email = 'seed@example.com'
  let name = 'Seed User'

  const credentials = getUserCredentials()
  if (credentials && credentials.id) {
    console.log('Found existing credentials:', credentials.id)
    userId = credentials.id
    email = credentials.email
    name = credentials.name
  } else {
    console.log('No credentials found, using default seed user')
  }

  // Upsert user
  const existingUser = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (existingUser.length === 0) {
    console.log('Creating user:', userId)
    await db.insert(user).values({
      id: userId,
      email: email,
      name: name,
      emailVerified: new Date(),
    })
  } else {
    console.log('User already exists:', userId)
  }

  // Upsert publisher 'codebuff'
  const existingPublisher = await db.select().from(publisher).where(eq(publisher.id, 'codebuff')).limit(1)
  if (existingPublisher.length === 0) {
    console.log('Creating publisher: codebuff')
    await db.insert(publisher).values({
      id: 'codebuff',
      name: 'Codebuff',
      user_id: userId,
      created_by: userId,
      verified: true,
    })
  } else {
    console.log('Publisher codebuff already exists')
  }

  // Upsert publisher 'anthropic' (for base-max example if needed, usually codebuff publishes all)
  // Actually base-max uses publisher 'codebuff' in the file I read.

  console.log('Seed complete')
}

main().catch(console.error).finally(() => process.exit(0))
