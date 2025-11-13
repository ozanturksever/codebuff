import React from 'react'
import { SegmentedControl, type Segment } from './segmented-control'

interface ModeSelectorProps {
  selectedMode: 'DEFAULT' | 'MAX'
  onModeChange: (mode: 'DEFAULT' | 'MAX') => void
}

/**
 * Mode selector for plan mode using SegmentedControl.
 * Displays a segmented control with DEFAULT and MAX options.
 */
export const ModeSelector = ({
  selectedMode,
  onModeChange,
}: ModeSelectorProps) => {
  const segments: Segment[] = [
    {
      id: 'DEFAULT',
      label: 'DEFAULT',
      isSelected: selectedMode === 'DEFAULT',
      defaultHighlighted: selectedMode === 'DEFAULT',
    },
    {
      id: 'MAX',
      label: 'MAX',
      isSelected: selectedMode === 'MAX',
      defaultHighlighted: selectedMode === 'MAX',
    },
  ]

  const handleSegmentClick = (id: string) => {
    if (id === 'DEFAULT' || id === 'MAX') {
      onModeChange(id)
    }
  }

  return (
    <SegmentedControl
      segments={segments}
      onSegmentClick={handleSegmentClick}
    />
  )
}
