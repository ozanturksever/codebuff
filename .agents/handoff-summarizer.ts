import { publisher } from './constants'

import type { AgentDefinition } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'handoff-summarizer',
  publisher,
  displayName: 'Handoff Summarizer',
  model: 'google/gemini-3-flash-preview',

  spawnerPrompt:
    'Summarizes a conversation into a concise handoff prompt for continuing work.',

  inputSchema: {
    prompt: {
      type: 'string',
      description: 'The conversation history to summarize',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'A concise continuation prompt summarizing the task, progress, and key decisions',
      },
    },
    required: ['summary'],
  },

  instructionsPrompt: `You are a conversation summarizer. Your task is to create a concise "handoff" summary that captures the essential context needed to continue working on a task.

Analyze the conversation and create a summary that includes:
1. The main task or goal being worked on
2. Key decisions that were made
3. Current progress/state (what's done, what remains)
4. Any important constraints or requirements mentioned

Format the summary as a continuation prompt that someone could use to resume work. Keep it under 500 characters.

Example output format:
"Continue implementing the user authentication feature. Progress: Created login form and validation. Decisions: Using JWT tokens, storing in httpOnly cookies. Remaining: Add password reset flow and rate limiting."

Be concise but include all critical context. Do not include greetings or meta-commentary.`,
}

export default definition
