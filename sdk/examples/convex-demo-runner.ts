/**
 * Runnable Convex Demo
 *
 * This file demonstrates the ConvexCodebuffClient by actually running it
 * with sample code. Run with: bun run examples/convex-demo-runner.ts
 *
 * Make sure you have a CODEBUFF_API_KEY environment variable set.
 */

import { ConvexCodebuffClient } from '../src/convex'

import type { AgentDefinition } from '../src/convex'

// Sample code to analyze
const sampleCode = `
/**
 * A simple utility to calculate the Fibonacci sequence
 */
export function fibonacci(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 1

  let prev = 0
  let curr = 1

  for (let i = 2; i <= n; i++) {
    const next = prev + curr
    prev = curr
    curr = next
  }

  return curr
}

/**
 * Memoized version for better performance with repeated calls
 */
const memo = new Map<number, number>()

export function fibonacciMemoized(n: number): number {
  if (memo.has(n)) return memo.get(n)!

  const result = n <= 1 ? n : fibonacciMemoized(n - 1) + fibonacciMemoized(n - 2)
  memo.set(n, result)
  return result
}

// Example usage
console.log('Fibonacci(10):', fibonacci(10))
console.log('Fibonacci(20):', fibonacci(20))
`

async function main() {
  const apiKey = process.env.CODEBUFF_API_KEY
  if (!apiKey) {
    console.error('❌ CODEBUFF_API_KEY environment variable is required')
    console.error('   Set it with: export CODEBUFF_API_KEY=your-api-key')
    process.exit(1)
  }

  console.log('🚀 Starting Convex Demo...\n')
  console.log('📄 Sample code to analyze:')
  console.log('─'.repeat(60))
  console.log(sampleCode)
  console.log('─'.repeat(60))
  console.log('\n⏳ Sending to Codebuff agent for analysis...\n')

  const client = new ConvexCodebuffClient({
    apiKey,
    // Provide the sample code as a project file
    projectFiles: {
      'fibonacci.ts': sampleCode,
    },
    // Stream chunks as they arrive
    handleStreamChunk: (chunk) => {
      if (typeof chunk === 'string') {
        process.stdout.write(chunk)
      }
    },
    // Log events
    handleEvent: (event) => {
      if (event.type === 'error') {
        console.error('\n❌ Error:', event.message)
      }
    },
  })

  try {
    // Check connection first
    const isConnected = await client.checkConnection()
    if (!isConnected) {
      console.error('❌ Could not connect to Codebuff backend')
      process.exit(1)
    }
    console.log('✅ Connected to Codebuff backend\n')

    // Define an inline agent for analysis (no need for a published agent)
    const analyzerAgent: AgentDefinition = {
      id: 'code-analyzer',
      name: 'Code Analyzer',
      displayName: 'Code Analyzer',
      description: 'Analyzes code and provides insights',
      version: '1.0.0',
      model: 'anthropic/claude-haiku-4.5',
      systemPrompt: `You are a helpful code analyzer. You have access to the read_files tool to read files from the project.

When asked to analyze code:
1. First, use read_files to read the file(s) mentioned
2. Explain what the code does in plain English
3. Identify any potential bugs or issues
4. Suggest improvements for readability, performance, or best practices

Be concise but thorough. Format your response with clear sections.`,
      tools: ['read_files'], // Only needs to read files
    }

    // Run the analysis with the inline agent
    const result = await client.run({
      agent: analyzerAgent,
      prompt:
        'Please analyze the code in fibonacci.ts and explain what it does. Point out any potential improvements or issues.',
    })

    console.log('\n\n' + '─'.repeat(60))
    console.log('📊 Result:')
    console.log('─'.repeat(60))

    if (result.output.type === 'error') {
      console.error('❌ Agent error:', result.output.message)
      process.exit(1)
    }

    console.log('✅ Analysis complete!')
    console.log('Output type:', result.output.type)

    if ('text' in result.output && result.output.text) {
      console.log('\nFinal response:')
      console.log(result.output.text)
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

main()
