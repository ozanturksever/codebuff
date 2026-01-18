#!/usr/bin/env npx tsx
/**
 * Convex Demo Runner
 *
 * This script:
 * 1. Deploys the Convex functions to a real Convex backend
 * 2. Runs the analyzeCode action with sample code
 * 3. Displays the results
 *
 * Prerequisites:
 * - Logged into Convex CLI (npx convex login)
 * - CODEBUFF_API_KEY set in Convex environment variables
 *
 * Usage: npx tsx run-demo.ts
 */

import { execSync, spawn } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

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

function runCommand(cmd: string, options?: { cwd?: string }): string {
  console.log(`\n> ${cmd}`)
  try {
    const result = execSync(cmd, {
      cwd: options?.cwd ?? process.cwd(),
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"],
    })
    return result
  } catch (error: any) {
    if (error.stdout) console.log(error.stdout)
    if (error.stderr) console.error(error.stderr)
    throw error
  }
}

async function main() {
  const demoDir = import.meta.dirname ?? process.cwd()

  console.log("🚀 Convex Codebuff Demo")
  console.log("=" .repeat(60))

  // Check if we're in the right directory
  if (!existsSync(join(demoDir, "convex", "actions.ts"))) {
    console.error("❌ Please run this script from the convex-demo directory")
    process.exit(1)
  }

  // Step 1: Install dependencies if needed
  if (!existsSync(join(demoDir, "node_modules"))) {
    console.log("\n📦 Installing dependencies...")
    runCommand("npm install", { cwd: demoDir })
  }

  // Step 2: Check if Convex is configured
  console.log("\n🔍 Checking Convex configuration...")
  const convexJsonPath = join(demoDir, "convex.json")
  let deploymentUrl: string | undefined

  if (!existsSync(convexJsonPath)) {
    console.log("\n⚠️  No Convex project configured. Running 'npx convex dev' to set up...")
    console.log("   This will prompt you to create a new Convex project.\n")
    console.log("   After setup, make sure to:")
    console.log("   1. Go to your Convex dashboard")
    console.log("   2. Add CODEBUFF_API_KEY to Environment Variables")
    console.log("   3. Re-run this script\n")

    // Run convex dev interactively
    const convexDev = spawn("npx", ["convex", "dev"], {
      cwd: demoDir,
      stdio: "inherit",
    })

    convexDev.on("close", (code) => {
      if (code === 0) {
        console.log("\n✅ Convex project set up! Now run this script again.")
      }
      process.exit(code ?? 0)
    })
    return
  }

  // Read deployment URL from convex.json
  try {
    const convexConfig = JSON.parse(readFileSync(convexJsonPath, "utf-8"))
    deploymentUrl = convexConfig.prodUrl || convexConfig.url
    console.log(`✅ Convex project configured: ${deploymentUrl ?? "dev"}`)
  } catch {
    console.log("✅ Convex project configured")
  }

  // Step 3: Deploy to Convex
  console.log("\n🚀 Deploying to Convex backend...")
  try {
    const deployOutput = runCommand("npx convex deploy --yes", { cwd: demoDir })
    console.log(deployOutput)
    console.log("✅ Deployment successful!")
  } catch (error) {
    console.error("❌ Deployment failed. Make sure you're logged in with 'npx convex login'")
    process.exit(1)
  }

  // Step 4: Check Codebuff connection
  console.log("\n🔗 Checking Codebuff connection...")
  try {
    const connectionResult = runCommand(
      'npx convex run actions:checkCodebuffConnection',
      { cwd: demoDir }
    )
    console.log(connectionResult)

    const parsed = JSON.parse(connectionResult.trim())
    if (!parsed.connected) {
      console.error("\n❌ Codebuff connection failed!")
      console.error("   Make sure CODEBUFF_API_KEY is set in your Convex dashboard:")
      console.error("   1. Go to https://dashboard.convex.dev")
      console.error("   2. Select your project")
      console.error("   3. Go to Settings > Environment Variables")
      console.error("   4. Add CODEBUFF_API_KEY with your API key")
      process.exit(1)
    }
    console.log("✅ Codebuff connection verified!")
  } catch (error) {
    console.error("❌ Failed to check Codebuff connection")
    process.exit(1)
  }

  // Step 5: Run the analyzeCode action
  console.log("\n📊 Running analyzeCode action...")
  console.log("─".repeat(60))
  console.log("Sample code being analyzed:")
  console.log("─".repeat(60))
  console.log(sampleCode.slice(0, 500) + "...")
  console.log("─".repeat(60))

  try {
    // Escape the code for JSON
    const escapedCode = JSON.stringify(sampleCode)
    const actionArgs = `{"code": ${escapedCode}, "filename": "fibonacci.ts"}`

    console.log("\n⏳ Calling Convex action (this may take a moment)...\n")

    const result = runCommand(
      `npx convex run actions:analyzeCode '${actionArgs}'`,
      { cwd: demoDir }
    )

    console.log("\n" + "=".repeat(60))
    console.log("📋 RESULT FROM CONVEX BACKEND:")
    console.log("=".repeat(60))
    console.log(result)
    console.log("=".repeat(60))
    console.log("\n✅ Demo completed successfully!")
    console.log("\n🎉 The ConvexCodebuffClient successfully ran in a real Convex backend!")
  } catch (error) {
    console.error("\n❌ Action failed:", error)
    process.exit(1)
  }
}

main().catch(console.error)
