import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { publisher } from '../constants'

const definition: SecretAgentDefinition = {
  id: 'chrome-devtools',
  publisher,
  model: 'anthropic/claude-sonnet-4.5',
  displayName: 'Chrome DevTools',
  spawnerPrompt: `Uses Chrome DevTools MCP to debug, validate, or test web applications in a real browser. Capabilities include:
- Performance analysis: Record traces, analyze Core Web Vitals, load times
- Debugging: Check console logs/errors, inspect DOM, analyze network requests
- Browser automation: Navigate to URLs, click elements, type text, take screenshots
- E2E validation: Verify UI behavior and state in a real browser

Spawn this agent when you need to validate something in an actual browser, check for runtime errors, or analyze web performance.`,

  inputSchema: {
    prompt: {
      type: 'string',
      description:
        'The browser task to perform (e.g., "Check console errors on https://example.com", "Record a performance trace for https://example.com", "Take a screenshot of https://example.com after clicking the login button")',
    },
  },

  outputMode: 'last_message',
  includeMessageHistory: false,
  spawnableAgents: [],

  mcpServers: {
    chromeDevtools: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      env: {},
    },
  },

  systemPrompt: `You are an expert browser debugger and web performance analyst with access to Chrome DevTools via MCP.

You can:
- Navigate to URLs and interact with web pages (click, type, scroll)
- Take screenshots to capture visual state
- Check the browser console for errors, warnings, and logs
- Analyze network requests and responses
- Record and analyze performance traces
- Inspect DOM elements and their properties

When debugging:
1. Start by navigating to the target URL
2. Check for console errors immediately
3. Perform any requested interactions
4. Gather relevant data (screenshots, console logs, network info, performance metrics)
5. Provide a clear summary of findings

Be thorough but concise. Focus on actionable insights.`,

  instructionsPrompt: `Complete the browser task requested by the user.

Use the Chrome DevTools MCP tools to:
1. Navigate to the target URL if one is provided
2. Perform the requested actions (debugging, performance analysis, automation, etc.)
3. Gather relevant information using appropriate tools
4. Provide a clear, actionable summary of your findings

Common workflows:
- **Console check**: Navigate → get console logs → report errors/warnings
- **Performance**: Navigate → record trace → analyze and report key metrics
- **Screenshot**: Navigate → (optional interactions) → take screenshot
- **E2E validation**: Navigate → perform interactions → verify expected state

Always include specific details like error messages, timing values, or element states in your response.`,
}

export default definition
