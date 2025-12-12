# Cross-Package E2E Tests

> **See also:** [Root TESTING.md](../TESTING.md) for an overview of testing across the entire monorepo.

## Overview

This directory contains end-to-end tests that span multiple packages, specifically testing the complete login flow:

```
CLI (Terminal) → Web Browser → GitHub OAuth → Callback → CLI (Authenticated)
```

These are the most comprehensive tests in the monorepo, verifying the entire authentication journey a real user would experience.

## Prerequisites

1. **Docker** must be running (for test database)
2. **SDK** must be built:
   ```bash
   cd sdk && bun run build
   ```
3. **Playwright browsers** must be installed:
   ```bash
   cd e2e && bun run install:browsers
   ```
4. **GitHub test account credentials** must be configured (see below)

## GitHub Test Account Setup

These tests require a real GitHub account for OAuth testing. We recommend creating a dedicated test account:

1. Create a new GitHub account for testing (e.g., `codebuff-e2e-test@example.com`)
2. If 2FA is enabled (recommended for security), get the TOTP secret:
   - Go to GitHub Settings → Password and authentication → Two-factor authentication
   - When setting up, click "Can't scan? Enter setup key" instead of scanning QR code
   - Copy the base32 secret key (e.g., `JBSWY3DPEHPK3PXP`)
3. Set the following environment variables:

```bash
export GH_TEST_EMAIL="your-test-account@example.com"
export GH_TEST_PASSWORD="your-test-password"
export GH_TEST_TOTP_SECRET="your-base32-totp-secret"  # Only if 2FA is enabled
```

## Architecture

### File-based IPC for Login URL

The tests use file-based IPC to reliably capture the login URL from the CLI:

1. Test creates a unique coordination file path and passes it to CLI via `CODEBUFF_E2E_URL_FILE`
2. When CLI generates a login URL, it writes `{status: 'ready', loginUrl: '...'}` to the file
3. Test polls the file instead of parsing TUI output (which is unreliable)
4. On error, CLI writes `{status: 'error', error: '...'}` for clear test failures

This approach is more robust than text pattern matching because:
- It's unaffected by TUI rendering, ANSI codes, or terminal buffer management
- Errors are explicit and debuggable
- The file can be inspected after test failures

## Running Tests

```bash
cd e2e

# Run all tests
bun run test

# Run with UI mode (interactive debugging)
bun run test:ui

# Run in headed mode (see the browser)
bun run test:headed

# Debug mode (step through)
bun run test:debug
```

## Test Structure

```
e2e/
├── fixtures/
│   ├── cli-session.ts     # CLI terminal emulation with tuistory
│   ├── infra.ts           # Docker database + web server setup
│   ├── oauth-helpers.ts   # GitHub OAuth automation
│   └── test-context.ts    # Combined test fixtures
├── flows/
│   └── login-flow.spec.ts # Main login flow tests
├── utils/
│   ├── env.ts            # Environment variable management
│   └── totp.ts           # TOTP code generation for 2FA
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── README.md
```

## How It Works

### Infrastructure

- Each test suite spins up an isolated Docker container with PostgreSQL
- A Next.js web server is started pointing to the test database
- Dynamic ports are used to avoid conflicts (DB: 5433+, Web: 3100+)

### CLI Session

- CLI is launched via `tuistory` (terminal emulator)
- `CODEBUFF_E2E_NO_BROWSER=true` makes CLI print login URLs instead of opening browser
- Test captures the URL and uses Playwright to complete OAuth

### OAuth Flow

1. CLI requests login code from `/api/auth/cli/code`
2. CLI prints login URL with `[E2E_LOGIN_URL]` prefix
3. Playwright navigates to the URL
4. Playwright fills GitHub credentials and handles 2FA
5. After OAuth callback, CLI detects the session via polling

## CI/CD

These tests run:
- **Nightly** via scheduled workflow (to avoid OAuth rate limits)
- **On-demand** via `workflow_dispatch`

### Required Secrets
- `GH_TEST_EMAIL` - Email for GitHub test account
- `GH_TEST_PASSWORD` - Password for GitHub test account

### System Dependencies (installed automatically in CI)
- `postgresql-client` - For database seeding (`psql`)
- `lsof` - For port availability checking
- Playwright browser dependencies (installed via `--with-deps` flag)

## Troubleshooting

### Tests timeout waiting for login URL

- Check that `CODEBUFF_E2E_NO_BROWSER` is being respected by CLI
- Verify the CLI is reaching the login prompt

### OAuth fails with "rate limited"

- GitHub rate limits OAuth attempts
- Wait 15-30 minutes and try again
- Consider using a different test account

### 2FA code is rejected

- Ensure system clock is accurate (TOTP is time-sensitive)
- Verify the TOTP secret is correct (base32 encoded)

### Orphaned containers

If tests fail and leave Docker containers running:

```bash
docker ps -aq --filter 'name=manicode-e2e' | xargs -r docker rm -f
```

## Adding New Tests

```typescript
import { test, expect } from '../fixtures/test-context'

test.describe('E2E: My New Flow', () => {
  test('my test', async ({ page, e2eContext }) => {
    const { createCLISession, completeOAuth } = e2eContext
    
    // Launch CLI
    const cli = await createCLISession()
    
    // Complete login if needed
    await cli.waitForText(/login/i, { timeout: 30000 })
    await cli.press('enter')
    const loginUrl = await cli.waitForLoginUrl()
    await completeOAuth(page, loginUrl)
    
    // Test your flow
    await cli.type('/your-command')
    await cli.waitForText(/expected output/i)
    
    expect(await cli.text()).toContain('expected')
  })
})
```
