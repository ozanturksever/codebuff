#!/usr/bin/env bun
/**
 * Non-interactive Codebuff run - used by codebuff-cloud-noninteractive
 */

import { CodebuffClient } from '@codebuff/sdk'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Read credentials from the prod credentials file
function getApiKey(): string | null {
  const credentialsPath = path.join(os.homedir(), '.config', 'manicode', 'credentials.json')
  
  try {
    if (!fs.existsSync(credentialsPath)) {
      console.error('Error: No credentials found. Please run codebuff-cloud first to authenticate.')
      return null
    }
    
    const content = fs.readFileSync(credentialsPath, 'utf8')
    const credentials = JSON.parse(content)
    return credentials.default?.authToken || null
  } catch (error) {
    console.error('Error reading credentials:', error)
    return null
  }
}

// Parse command line arguments
function parseArgs(): { prompt: string | null; agent: string } {
  const args = process.argv.slice(2)
  let agent = 'codebuff/base@latest'
  let promptParts: string[] = []
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agent = args[i + 1]
      i++ // Skip next arg
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: codebuff-cloud-noninteractive [options] "prompt"

Options:
  --agent <id>    Agent to use (default: codebuff/base@latest)
  --help, -h      Show this help message

Examples:
  codebuff-cloud-noninteractive "Explain this code"
  codebuff-cloud-noninteractive --agent codebuff/base-lite "Fix the bug"
  echo "What does this do?" | codebuff-cloud-noninteractive
`)
      process.exit(0)
    } else {
      promptParts.push(args[i])
    }
  }
  
  return {
    prompt: promptParts.length > 0 ? promptParts.join(' ') : null,
    agent
  }
}

// Read from stdin if data is being piped
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    // If stdin is a TTY (interactive terminal), don't wait for input
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    
    let data = ''
    process.stdin.setEncoding('utf8')
    
    // Set a short timeout to detect if stdin has data
    const timeout = setTimeout(() => {
      resolve('')
    }, 100)
    
    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout)
      data += chunk
    })
    process.stdin.on('end', () => {
      clearTimeout(timeout)
      resolve(data.trim())
    })
    
    // Resume stdin to start receiving data
    process.stdin.resume()
  })
}

async function main() {
  const apiKey = getApiKey()
  if (!apiKey) {
    process.exit(1)
  }
  
  const { prompt: argPrompt, agent } = parseArgs()
  
  // Get prompt from args or stdin
  let prompt = argPrompt
  if (!prompt) {
    prompt = await readStdin()
  }
  
  if (!prompt) {
    // Show help when called without any arguments
    console.log(`
Usage: codebuff-cloud-noninteractive [options] "prompt"

Options:
  --agent <id>    Agent to use (default: codebuff/base@latest)
  --help, -h      Show this help message

Examples:
  codebuff-cloud-noninteractive "Explain this code"
  codebuff-cloud-noninteractive --agent codebuff/base-lite "Fix the bug"
  echo "What does this do?" | codebuff-cloud-noninteractive
`)
    process.exit(0)
  }
  
  const client = new CodebuffClient({
    apiKey,
    cwd: process.cwd(),
  })
  
  let responseText = ''
  
  try {
    const { output } = await client.run({
      agent,
      prompt,
      handleStreamChunk: (chunk) => {
        // Handle streaming text chunks for real-time output
        if (typeof chunk === 'string') {
          responseText += chunk
          process.stdout.write(chunk)
        }
      },
    })
    
    // Ensure we end with a newline
    if (responseText && !responseText.endsWith('\n')) {
      console.log()
    }
    
    if (output.type === 'error') {
      console.error(`\nError: ${output.message}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('Error running prompt:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
