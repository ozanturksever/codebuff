const EXIT_MESSAGE = '\nGoodbye! Exiting...\nexit\n'

let exitStarted = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function flushExitMessage(message: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const handleDrain = () => resolve()
    const flushed = process.stdout.write(message, handleDrain)
    if (!flushed) {
      process.stdout.once('drain', handleDrain)
    }

    // Always resolve eventually in case stdout is interrupted
    setTimeout(resolve, 80)
  })
}

/**
 * Ensure we print a visible exit marker and give stdout a chance to flush
 * before forcing the process to exit.
 */
export async function gracefulExit(options?: {
  message?: string
  code?: number
}): Promise<void> {
  if (exitStarted) return
  exitStarted = true

  const message = options?.message ?? EXIT_MESSAGE
  const code = options?.code ?? 0

  try {
    await flushExitMessage(message)
    // Small delay to let terminal emulators render the exit marker
    await sleep(30)
  } catch {
    // Ignore errors and fall through to exit
  }

  process.exit(code)
}

/**
 * Fire-and-forget exit helper that still flushes stdout before exiting.
 */
export function scheduleGracefulExit(options?: {
  message?: string
  code?: number
}): void {
  void gracefulExit(options)
}
