/**
 * Custom answer input component - MultilineInput wrapper for custom text answers
 */

import React, { memo, useCallback, useMemo } from 'react'

import { useTheme } from '../../../hooks/use-theme'
import { MultilineInput } from '../../multiline-input'
import { createTextPasteHandler } from '../../../utils/strings'

import type { InputValue } from '../../../state/chat-store'

export interface CustomAnswerInputProps {
  value: string
  cursorPosition: number
  focused: boolean
  optionIndent: number
  onChange: (text: string, cursorPosition: number) => void
  onSubmit: () => void
}

export const CustomAnswerInput: React.FC<CustomAnswerInputProps> = memo(
  ({
    value,
    cursorPosition,
    focused,
    optionIndent,
    onChange,
    onSubmit,
  }) => {
    const theme = useTheme()

    const handleInputChange = useCallback(
      (inputValue: InputValue) => {
        onChange(inputValue.text, inputValue.cursorPosition)
      },
      [onChange],
    )

    const handlePaste = useMemo(
      () => createTextPasteHandler(value, cursorPosition, handleInputChange),
      [value, cursorPosition, handleInputChange],
    )

    return (
      <box style={{ flexDirection: 'column', paddingLeft: optionIndent + 2 }}>
        <box
          style={{
            borderStyle: 'single',
            borderColor: theme.muted,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
        <MultilineInput
          value={value}
          cursorPosition={cursorPosition}
          onChange={handleInputChange}
          onSubmit={onSubmit}
          onPaste={handlePaste}
          focused={focused}
          maxHeight={5}
          minHeight={1}
          placeholder="Type your answer..."
          showScrollbar={true}
        />
        </box>
      </box>
    )
  },
)

CustomAnswerInput.displayName = 'CustomAnswerInput'
