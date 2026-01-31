import React, { useState } from 'react'

import { Button } from './button'
import { useTheme } from '../hooks/use-theme'
import { BORDER_CHARS } from '../utils/ui-constants'

interface UserErrorBannerProps {
  error: string
  title?: string
  onClose?: () => void
}

/** Displays runtime errors in the UI (not sent to LLM). */
export const UserErrorBanner = React.memo(function UserErrorBanner({
  error,
  title,
  onClose,
}: UserErrorBannerProps) {
  const theme = useTheme()
  const [isCloseHovered, setIsCloseHovered] = useState(false)

  // Handle empty and whitespace-only errors
  const trimmedError = error.trim()
  if (!trimmedError) {
    return null
  }

  return (
    <box
      style={{
        width: '100%',
        borderStyle: 'single',
        borderColor: theme.error,
        customBorderChars: BORDER_CHARS,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        flexDirection: 'column',
        gap: 0,
        marginTop: 1,
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 0,
        }}
      >
        <box
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <text style={{ fg: theme.error, wrapMode: 'word' }}>
            {title ?? 'Error'}
          </text>
          {onClose && (
            <Button
              onClick={onClose}
              onMouseOver={() => setIsCloseHovered(true)}
              onMouseOut={() => setIsCloseHovered(false)}
            >
              <text
                style={{
                  fg: isCloseHovered ? theme.foreground : theme.secondary,
                  wrapMode: 'none',
                }}
              >
                [x]
              </text>
            </Button>
          )}
        </box>
        <text style={{ fg: theme.foreground, wrapMode: 'word' }}>
          {error}
        </text>
      </box>
    </box>
  )
})
