import db from '@codebuff/internal/db'
import { user, publisher } from '@codebuff/internal/db/schema'

async function main() {
  const users = await db.select().from(user)
  console.log('Users:', users)

  const publishers = await db.select().from(publisher)
  console.log('Publishers:', publishers)
}

main().catch(console.error).finally(() => process.exit(0))
