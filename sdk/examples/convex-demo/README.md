# Convex Codebuff Demo

This demo shows how to use the `ConvexCodebuffClient` in a **real Convex backend**.

## Prerequisites

1. **Convex CLI**: Install with `npm install -g convex`
2. **Convex Account**: Create one at [convex.dev](https://convex.dev) (free tier available)
3. **Codebuff API Key**: Get one from [codebuff.com](https://codebuff.com)

## Quick Start

### 1. Install dependencies

```bash
cd sdk/examples/convex-demo
npm install
```

### 2. Set up Convex project

```bash
npx convex dev
```

This will:
- Prompt you to log in to Convex
- Create a new Convex project
- Generate the `_generated` files

### 3. Add your Codebuff API key

1. Go to [dashboard.convex.dev](https://dashboard.convex.dev)
2. Select your project
3. Go to **Settings > Environment Variables**
4. Add `CODEBUFF_API_KEY` with your API key

### 4. Deploy and test

```bash
npx tsx run-demo.ts
```

Or manually:

```bash
# Deploy to Convex
npx convex deploy

# Check connection
npx convex run actions:checkCodebuffConnection

# Run the code analysis action
npx convex run actions:analyzeCode '{"code": "function hello() { return 42; }", "filename": "test.ts"}'
```

## What This Demo Does

The demo deploys a Convex action that:

1. Creates a `ConvexCodebuffClient` with your API key
2. Provides sample code as `projectFiles`
3. Runs an inline AI agent to analyze the code
4. Returns the analysis results

This proves the SDK works in Convex's sandboxed Node.js environment without file system or child_process access.

## Files

- `convex/actions.ts` - Convex actions using ConvexCodebuffClient
- `run-demo.ts` - Script to deploy and test the demo
- `package.json` - Dependencies (just `convex`)

## Troubleshooting

**"CODEBUFF_API_KEY not configured"**
- Make sure you added the environment variable in the Convex dashboard

**"Could not connect to Codebuff backend"**
- Check your API key is valid
- Ensure you have an active Codebuff subscription

**Deployment fails**
- Run `npx convex login` to authenticate
- Make sure you have a Convex project set up (`npx convex dev`)
