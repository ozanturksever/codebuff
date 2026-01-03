import { TextAttributes } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { defineToolComponent } from './types'
import { useTheme } from '../../hooks/use-theme'
import {
  getLatestFollowupToolCallId,
  useChatStore,
} from '../../state/chat-store'
import { Button } from '../button'

import type { ToolRenderConfig } from './types'
import type { ChatMessage } from '../../types/chat'
import type { SuggestedFollowup } from '../../state/chat-store'
import type { FollowupHookContext, TodoItem, FileChange } from '../../utils/project-hooks'
import { useTerminalDimensions } from '../../hooks/use-terminal-dimensions'

const EMPTY_CLICKED_SET = new Set<number>()

/**
 * Extract todos from the chat messages by finding the most recent write_todos tool result.
 */
function extractTodosFromMessages(messages: ChatMessage[]): TodoItem[] {
  // Look through messages in reverse to find the most recent todos
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg?.blocks) continue

    for (const block of msg.blocks) {
      if (
        block.type === 'tool' &&
        block.toolName === 'write_todos' &&
        block.input?.todos
      ) {
        return block.input.todos as TodoItem[]
      }
    }
  }
  return []
}

/**
 * Extract recent file changes from chat messages by looking at write_file and str_replace tool results.
 */
function extractFileChangesFromMessages(messages: ChatMessage[]): FileChange[] {
  const changes: FileChange[] = []
  const seenPaths = new Set<string>()

  // Look through recent messages (last 20) for file operations
  const recentMessages = messages.slice(-20)

  for (const msg of recentMessages) {
    if (!msg?.blocks) continue

    for (const block of msg.blocks) {
      if (block.type !== 'tool') continue

      // Check for write_file or str_replace tool results
      if (
        block.toolName === 'write_file' ||
        block.toolName === 'str_replace'
      ) {
        const result = block.outputRaw
        if (typeof result === 'object' && result !== null) {
          const resultObj = result as { file?: string; path?: string; message?: string }
          const filePath = resultObj.file || resultObj.path
          if (filePath && !seenPaths.has(filePath)) {
            seenPaths.add(filePath)

            // Determine change type from message
            const message = (resultObj.message ?? '').toLowerCase()
            let type: FileChange['type'] = 'modified'
            if (
              message.includes('created') ||
              message.includes('new file')
            ) {
              type = 'created'
            } else if (message.includes('deleted')) {
              type = 'deleted'
            }

            changes.push({ path: filePath, type })
          }
        }
      }
    }
  }

  return changes
}

/**
 * Extract the last assistant message content as a summary.
 */
function extractLastAssistantMessage(
  messages: ChatMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.variant !== 'ai') continue

    if (!msg.blocks) continue

    for (const block of msg.blocks) {
      if (block.type === 'text' && block.content) {
        // Return first 500 chars as summary
        return block.content.slice(0, 500)
      }
    }
  }
  return undefined
}
const MIN_LABEL_COLUMN_WIDTH = 12
const MAX_LABEL_COLUMN_WIDTH = 60
/** Minimum terminal width to show the prompt description on hover */
const MIN_WIDTH_FOR_DESCRIPTION = 80

interface FollowupLineProps {
  followup: SuggestedFollowup
  index: number
  isClicked: boolean
  isHovered: boolean
  onSendFollowup: (prompt: string, index: number) => void
  onHover: (index: number | null) => void
  disabled?: boolean
  /** Width of the label column (for fixed-width alignment) */
  labelColumnWidth: number
}

const FollowupLine = ({
  followup,
  index,
  isClicked,
  isHovered,
  onSendFollowup,
  onHover,
  disabled,
  labelColumnWidth,
}: FollowupLineProps) => {
  const theme = useTheme()
  const { terminalWidth } = useTerminalDimensions()

  const handleClick = useCallback(() => {
    if (disabled) return
    onSendFollowup(followup.prompt, index)
  }, [followup.prompt, index, onSendFollowup, disabled])

  const handleMouseOver = useCallback(() => onHover(index), [onHover, index])
  const handleMouseOut = useCallback(() => onHover(null), [onHover])

  // Compute effective hover state declaratively
  // Show hover effects if actually hovered AND not disabled AND not already clicked
  const showHoverState = isHovered && !disabled && !isClicked

  const hasLabel = Boolean(followup.label)
  const displayText = hasLabel ? followup.label : followup.prompt

  // Show description when hovered, has a label, and terminal is wide enough
  const showDescription =
    showHoverState && hasLabel && terminalWidth >= MIN_WIDTH_FOR_DESCRIPTION

  // Calculate truncated prompt with ellipsis only when needed
  const truncatedPrompt = showDescription
    ? (() => {
        const availableWidth = Math.max(0, terminalWidth - labelColumnWidth - 4)
        return followup.prompt.length > availableWidth
          ? followup.prompt.slice(0, availableWidth - 1) + '…'
          : followup.prompt
      })()
    : ''

  // Determine colors based on state
  // When hovered, use primary color (acid green) for both arrow and title
  const iconColor = isClicked
    ? theme.success
    : showHoverState
      ? theme.primary
      : theme.muted
  const labelColor = isClicked
    ? theme.muted
    : showHoverState
      ? theme.primary
      : theme.foreground

  return (
    <Button
      onClick={handleClick}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      style={{
        flexDirection: 'column',
        backgroundColor: showHoverState ? theme.surface : undefined,
      }}
    >
      {/* Row layout: fixed-width label column + flexible description */}
      <box style={{ flexDirection: 'row', width: '100%' }}>
        {/* Fixed-width label column */}
        <box
          style={{
            width: hasLabel ? labelColumnWidth : undefined,
            flexShrink: hasLabel ? 0 : 1,
            flexGrow: hasLabel ? 0 : 1,
          }}
        >
          <text style={{ wrapMode: hasLabel ? 'none' : 'word' }}>
            <span fg={iconColor}>{isClicked ? '✓' : '→'}</span>
            <span
              fg={labelColor}
              attributes={showHoverState ? TextAttributes.BOLD : undefined}
            >
              {' '}
              {displayText}
            </span>
          </text>
        </box>
        {/* Flexible description column - truncated with ellipsis */}
        {showDescription && hasLabel && (
          <box style={{ flexGrow: 1 }}>
            <text style={{ wrapMode: 'none' }}>
              <span fg={theme.foreground} attributes={TextAttributes.ITALIC}>
                {truncatedPrompt}
              </span>
            </text>
          </box>
        )}
      </box>
    </Button>
  )
}

interface SuggestFollowupsItemProps {
  toolCallId: string
  followups: SuggestedFollowup[]
  onSendFollowup: (prompt: string, index: number) => void
}

interface PastFollowupItemProps {
  followup: SuggestedFollowup
  isClicked: boolean
}

const PastFollowupItem = ({ followup, isClicked }: PastFollowupItemProps) => {
  const theme = useTheme()
  const displayLabel = followup.label || followup.prompt
  const showFullPrompt = followup.label && followup.label !== followup.prompt

  return (
    <box style={{ flexDirection: 'column', marginLeft: 2 }}>
      <text>
        <span fg={isClicked ? theme.success : theme.muted}>
          {isClicked ? '✓' : '→'}
        </span>
        <span fg={isClicked ? theme.muted : theme.foreground}>
          {' '}
          {displayLabel}
        </span>
      </text>
      {showFullPrompt && (
        <text style={{ marginLeft: 2 }}>
          <span fg={theme.muted} attributes={TextAttributes.ITALIC}>
            {followup.prompt}
          </span>
        </text>
      )}
    </box>
  )
}

interface PastFollowupsToggleProps {
  toolCallId: string
  followups: SuggestedFollowup[]
}

const PastFollowupsToggle = ({
  toolCallId,
  followups,
}: PastFollowupsToggleProps) => {
  const theme = useTheme()
  const [isExpanded, setIsExpanded] = useState(false)
  const clickedIndices = useChatStore(
    (state) => state.clickedFollowupsMap.get(toolCallId) ?? EMPTY_CLICKED_SET,
  )

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const toggleIndicator = isExpanded ? '▾' : '▸'

  return (
    <box style={{ flexDirection: 'column' }}>
      <Button onClick={handleToggle}>
        <text>
          <span fg={theme.muted}>{toggleIndicator}</span>
          <span fg={theme.muted} attributes={TextAttributes.ITALIC}>
            {' '}
            Previously suggested followups
          </span>
        </text>
      </Button>
      {isExpanded && (
        <box style={{ flexDirection: 'column', marginTop: 0 }}>
          {followups.map((followup, index) => (
            <PastFollowupItem
              key={`past-followup-${index}`}
              followup={followup}
              isClicked={clickedIndices.has(index)}
            />
          ))}
        </box>
      )}
    </box>
  )
}

const SuggestFollowupsItem = ({
  toolCallId,
  followups,
  onSendFollowup,
}: SuggestFollowupsItemProps) => {
  const theme = useTheme()
  const inputFocused = useChatStore((state) => state.inputFocused)
  const setSuggestedFollowups = useChatStore(
    (state) => state.setSuggestedFollowups,
  )
  const latestFollowupToolCallId = useChatStore((state) =>
    getLatestFollowupToolCallId(state.messages),
  )
  const clickedIndices = useChatStore(
    (state) => state.clickedFollowupsMap.get(toolCallId) ?? EMPTY_CLICKED_SET,
  )
  const currentSuggestedFollowups = useChatStore(
    (state) => state.suggestedFollowups,
  )

  const isActive = latestFollowupToolCallId === toolCallId

  const processFollowupsWithHooks = useChatStore(
    (state) => state.processFollowupsWithHooks,
  )
  const followupHooks = useChatStore((state) => state.followupHooks)
  const messages = useChatStore((state) => state.messages)

  // Extract context from messages
  const context: FollowupHookContext = useMemo(
    () => ({
      todos: extractTodosFromMessages(messages),
      recentFileChanges: extractFileChangesFromMessages(messages),
      lastAssistantMessage: extractLastAssistantMessage(messages),
    }),
    [messages],
  )

  useEffect(() => {
    if (!isActive) return

    const hasSameTool = currentSuggestedFollowups?.toolCallId === toolCallId
    const hasSameFollowups =
      hasSameTool &&
      currentSuggestedFollowups?.followups.length === followups.length &&
      currentSuggestedFollowups.followups.every((f, idx) => {
        const next = followups[idx]
        return f?.prompt === next?.prompt && f?.label === next?.label
      })
    const hasSameClicks =
      hasSameTool &&
      currentSuggestedFollowups?.clickedIndices.size === clickedIndices.size &&
      Array.from(currentSuggestedFollowups.clickedIndices).every((idx) =>
        clickedIndices.has(idx),
      )

    if (hasSameFollowups && hasSameClicks) return

    // If there are hooks registered, process through them
    if (followupHooks.length > 0) {
      void processFollowupsWithHooks(followups, toolCallId, context)
    } else {
      // No hooks, set directly
      setSuggestedFollowups({
        toolCallId,
        followups,
        clickedIndices: new Set(clickedIndices),
      })
    }
  }, [
    clickedIndices,
    context,
    currentSuggestedFollowups,
    followups,
    followupHooks.length,
    isActive,
    processFollowupsWithHooks,
    setSuggestedFollowups,
    toolCallId,
  ])

  // Track which item is hovered (for passing to children)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // For past messages, show collapsed toggle view
  if (!isActive) {
    return <PastFollowupsToggle toolCallId={toolCallId} followups={followups} />
  }

  // Calculate label column width for alignment across all followups
  // Width = "→ " (2 chars) + max label/prompt length + "  " spacing (2 chars)
  const maxDisplayLength = Math.max(
    0,
    ...followups.map((f) => (f.label ?? f.prompt).length),
  )
  const labelColumnWidth = Math.min(
    MAX_LABEL_COLUMN_WIDTH,
    Math.max(MIN_LABEL_COLUMN_WIDTH, 2 + maxDisplayLength + 2),
  ) // "→ " + label/prompt + "  "

  return (
    <box style={{ flexDirection: 'column' }}>
      <text style={{ fg: theme.muted }}>Suggested followups:</text>
      <box style={{ flexDirection: 'column' }}>
        {followups.map((followup, index) => (
          <FollowupLine
            key={`followup-${index}`}
            followup={followup}
            index={index}
            isClicked={clickedIndices.has(index)}
            isHovered={hoveredIndex === index}
            onSendFollowup={onSendFollowup}
            onHover={setHoveredIndex}
            disabled={!inputFocused}
            labelColumnWidth={labelColumnWidth}
          />
        ))}
      </box>
    </box>
  )
}

/**
 * UI component for suggest_followups tool.
 * Displays clickable cards that send the followup prompt as a user message when clicked.
 */
export const SuggestFollowupsComponent = defineToolComponent({
  toolName: 'suggest_followups',

  render(toolBlock, _theme, options): ToolRenderConfig {
    const { input, toolCallId } = toolBlock

    // Extract followups from input
    let followups: SuggestedFollowup[] = []

    if (Array.isArray(input?.followups)) {
      followups = input.followups.filter(
        (f: unknown): f is SuggestedFollowup =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as SuggestedFollowup).prompt === 'string',
      )
    }

    if (followups.length === 0) {
      return { content: null }
    }

    // The actual click handling is done in chat.tsx via the global handler
    // Here we just pass a placeholder that will be replaced
    const handleSendFollowup = (prompt: string, index: number) => {
      // This gets called from the FollowupCard component
      // The actual logic is handled via the global followup handler
      const event = new CustomEvent('codebuff:send-followup', {
        detail: { prompt, index, toolCallId },
      })
      globalThis.dispatchEvent(event)
    }

    return {
      content: (
        <SuggestFollowupsItem
          toolCallId={toolCallId}
          followups={followups}
          onSendFollowup={handleSendFollowup}
        />
      ),
    }
  },
})
