import React from 'react'

import { useTheme } from '../hooks/use-theme'

import type { StatusIndicatorState } from '../utils/status-indicator-state'

interface StatusDotProps {
  state: StatusIndicatorState['kind']
}

export const StatusDot = ({ state }: StatusDotProps) => {
  const theme = useTheme()

  const getColor = (): string => {
    switch (state) {
      case 'idle':
        return theme.success // Green - ready for input
      case 'reconnected':
        return theme.success // Green - successfully reconnected
      case 'streaming':
      case 'waiting':
        return theme.error // Red - actively working
      case 'connecting':
      case 'retrying':
        return theme.warning // Yellow/Orange - connection issues
      case 'ctrlC':
        return theme.warning // Yellow - warning state
      case 'clipboard':
        return theme.primary // Primary color for clipboard operations
      default:
        return theme.muted
    }
  }

  return <text><span fg={getColor()}>●</span></text>
}
