# Plan: Fully Offline BYOK Mode for Codebuff CLI

## Overview

Add a fully offline mode to Codebuff CLI where all LLM calls go directly from the client to OpenRouter or Anthropic, bypassing the Codebuff backend entirely. No login required, no usage tracking, fully self-contained operation.

## Requirements

### Core Direct Mode
- Add a new "direct mode" that bypasses the Codebuff backend for all LLM calls
- Support two LLM providers:
  - **OpenRouter** - for access to all models via single API key
  - **Anthropic** - for direct Claude API access
- Activate via environment variable (e.g., `CODEBUFF_DIRECT_MODE=true`)
- No Codebuff login/authentication required in this mode

### API Key Configuration
- Environment variables only:
  - `CODEBUFF_OPENROUTER_KEY` - OpenRouter API key
  - `CODEBUFF_ANTHROPIC_KEY` - Direct Anthropic API key
  - `CODEBUFF_LINKUP_KEY` - Linkup API key for web search/docs
- CLI validates required keys are present before starting in direct mode

### Client-Side Tool Implementations
- Implement direct Linkup API calls for:
  - `web_search` tool - client-side Linkup web search
  - `read_docs` tool - client-side Linkup docs search
- All other tools already work locally (file ops, terminal, code search, etc.)

### Bundled Agents
- Bundle popular/essential agents directly in the CLI distribution:
  - `codebuff/base2` and `codebuff/base2-lite` (main orchestrators)
  - `codebuff/file-picker`, `codebuff/code-searcher`, `codebuff/commander`
  - `codebuff/thinker`, `codebuff/editor`, `codebuff/code-reviewer`
  - Other commonly used agents
- No network fetch to agent store in direct mode
- Local `.agents/` directory still works for custom agents

### Model Provider Changes
- Modify `sdk/src/impl/model-provider.ts` to add a `createDirectOpenRouterModel()` function
- Modify `sdk/src/impl/model-provider.ts` to add a `createDirectAnthropicModel()` function
- Update `getModelForRequest()` to check for direct mode and route accordingly
- Direct mode skips the Codebuff backend URL entirely

## Notes

- This is a significant architectural change affecting the SDK, CLI, and agent-runtime
- Consider feature-flagging this behind an experimental flag initially
- Token counting in direct mode will need to call Anthropic's token count API directly (already have `CODEBUFF_ANTHROPIC_KEY`)
- Cost tracking won't work in direct mode (user pays their provider directly)

## Relevant Files

- `common/src/constants/byok.ts` - BYOK constants (extend for new keys)
- `sdk/src/env.ts` - Environment variable getters
- `sdk/src/impl/model-provider.ts` - Model provider routing (main changes)
- `sdk/src/impl/llm.ts` - LLM prompt functions
- `packages/agent-runtime/src/llm-api/linkup-api.ts` - Linkup API implementation (move to SDK)
- `packages/agent-runtime/src/llm-api/codebuff-web-api.ts` - Backend API calls (replace in direct mode)
- `cli/src/agents/bundled-agents.generated.ts` - Already has bundled agents
- `packages/internal/src/openrouter-ai-sdk/` - OpenRouter AI SDK provider
