# Mock Database Utilities

Mock database objects for testing. No real database needed.

## DbOperations

`DbOperations` is a minimal interface defined in `@codebuff/common/types/contracts/database`. Both the real `CodebuffPgDatabase` and test mocks satisfy it, enabling dependency injection without `as any` casts.

**Production code** should import from the contracts location:
```ts
import type { DbOperations } from '@codebuff/common/types/contracts/database'
```

**Test code** can import from either location (mock-db re-exports the interface for convenience):
```ts
import { createMockDb, type DbOperations } from '@codebuff/common/testing/mock-db'
```

## Utilities

### `createMockDb(config?)`

API route tests with insert/update/select:

```ts
import { createMockDb } from '@codebuff/common/testing/mock-db'

const mockDb = createMockDb({
  insert: { onValues: async (values) => { /* check values */ } },
  update: { onWhere: async () => {} },
  select: { results: [{ id: 'user-123' }] },
})

await postAgentRuns({ db: mockDb, ... })
```

### `createMockDbWithErrors(config)`

Test error paths:

```ts
import { createMockDbWithErrors } from '@codebuff/common/testing/mock-db'

const mockDb = createMockDbWithErrors({
  insertError: new Error('Connection failed'),
  selectResults: [{ user_id: 'user-123' }],
})
```

### `createSelectOnlyMockDb(results)`

Read-only queries (version-utils, etc.):

```ts
import { createSelectOnlyMockDb } from '@codebuff/common/testing/mock-db'

const mockDb = createSelectOnlyMockDb([{ major: 1, minor: 2, patch: 3 }])

const result = await getLatestAgentVersion({
  agentId: 'test-agent',
  publisherId: 'test-publisher',
  db: mockDb,
})
```

### `createMockDbSelect(config)`

Batch queries (agent dependencies route):

```ts
import { createMockDbSelect, mockDbSchema } from '@codebuff/common/testing/mock-db'

const mockDbSelect = mock(() => ({}))
mock.module('@codebuff/internal/db', () => ({ default: { select: mockDbSelect } }))

mockDbSelect.mockImplementation(createMockDbSelect({
  publishers: [{ id: 'test-publisher' }],
  rootAgent: { id: 'agent', version: '1.0.0', publisher_id: 'test-publisher', data: {} },
  childAgents: [],
}))
```

### `createMockLogger()`

```ts
import { createMockLogger } from '@codebuff/common/testing/mock-db'

const mockLogger = createMockLogger()
// error, warn, info, debug are all mocks
```

## How to use

1. Import from `@codebuff/common/testing/mock-db`
2. Create in `beforeEach()` for fresh state
3. Pass to functions that take `DbOperations`

## Query patterns

| Pattern | Use |
|---------|---------|
| `db.insert(table).values(data)` | `createMockDb` |
| `db.update(table).set(data).where(cond)` | `createMockDb` |
| `db.select().from().where().limit()` | `createMockDb` |
| `db.select().from().where().orderBy().limit()` | `createSelectOnlyMockDb` |
| Batch queries with counting | `createMockDbSelect` |
