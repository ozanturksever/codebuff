import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { publisher } from '../constants'

/**
 * Chrome DevTools agent variant that connects to an existing Chrome instance
 * with remote debugging enabled.
 *
 * To use this agent, start Chrome with remote debugging:
 *
 * macOS:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
 *
 * Linux:
 *   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
 *
 * Windows:
 *   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug"
 */
const definition: SecretAgentDefinition = {
  id: 'chrome-devtools-remote',
  publisher,
  model: 'anthropic/claude-sonnet-4.5',
  displayName: 'Chrome DevTools (Remote)',
  spawnerPrompt: `Connects to an existing Chrome instance with remote debugging enabled (port 9222) to debug, validate, or test web applications. Use this variant when:
- You want to debug a Chrome session you're already using
- You need to inspect a specific browser profile or state
- The default chrome-devtools agent can't launch Chrome (e.g., sandboxing issues)

Capabilities include:
- Performance analysis: Record traces, analyze Core Web Vitals, load times
- Debugging: Check console logs/errors, inspect DOM, analyze network requests
- Browser automation: Navigate to URLs, click elements, type text, take screenshots
- E2E validation: Verify UI behavior and state in a real browser

IMPORTANT: User must start Chrome with --remote-debugging-port=9222 before using this agent.`,

  inputSchema: {
    prompt: {
      type: 'string',
      description:
        'The browser task to perform (e.g., "Check console errors on https://example.com", "Record a performance trace for https://example.com", "Take a screenshot of the current page")',
    },
  },

  outputMode: 'last_message',
  includeMessageHistory: false,
  spawnableAgents: [],

  mcpServers: {
    chromeDevtools: {
      type: 'stdio',
      command: 'npx',
      args: [
        '-y',
        'chrome-devtools-mcp@latest',
        '--browser-url=http://127.0.0.1:9222',
      ],
      env: {},
    },
  },

  systemPrompt: `You are an expert browser debugger and web performance analyst with access to Chrome DevTools via MCP.

You are connected to an EXISTING Chrome instance that the user started with remote debugging enabled on port 9222. This means:
- The browser may already have tabs open with state you can inspect
- You can work with the user's actual browser session and profile
- The user can see the browser actions in real-time

You can:
- Navigate to URLs and interact with web pages (click, type, scroll)
- Take screenshots to capture visual state
- Check the browser console for errors, warnings, and logs
- Analyze network requests and responses
- Record and analyze performance traces
- Inspect DOM elements and their properties

When debugging:
1. Check what tabs/pages are already open if relevant
2. Navigate to the target URL or work with existing page
3. Check for console errors immediately
4. Perform any requested interactions
5. Gather relevant data (screenshots, console logs, network info, performance metrics)
6. Provide a clear summary of findings

Be thorough but concise. Focus on actionable insights.`,

  instructionsPrompt: `Complete the browser task requested by the user.

This agent is connected to an existing Chrome instance with remote debugging enabled on port 9222. The user has already started Chrome with the --remote-debugging-port=9222 flag.

Use the Chrome DevTools MCP tools to:
1. Navigate to the target URL if one is provided (or work with the current page)
2. Perform the requested actions (debugging, performance analysis, automation, etc.)
3. Gather relevant information using appropriate tools
4. Provide a clear, actionable summary of your findings

Common workflows:
- **Console check**: Navigate → get console logs → report errors/warnings
- **Performance**: Navigate → record trace → analyze and report key metrics
- **Screenshot**: Navigate → (optional interactions) → take screenshot
- **E2E validation**: Navigate → perform interactions → verify expected state
- **Inspect current state**: Check what's currently loaded, inspect existing page

Always include specific details like error messages, timing values, or element states in your response.

If the connection fails, remind the user to start Chrome with:
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug`,
}

export default definition
