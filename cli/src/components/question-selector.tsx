import React, { useState, useCallback } from 'react'
import { useTheme } from '../hooks/use-theme'
import type { ParsedQuestion } from '../utils/plan-questions-parser'
import { BORDER_CHARS } from '../utils/ui-constants'

export interface QuestionAnswer {
  type: 'option' | 'custom'
  value: string | number
}

export interface QuestionAnswers {
  [questionIndex: number]: QuestionAnswer
}

interface QuestionSelectorProps {
  questions: ParsedQuestion[]
  onUpdate: (answers: QuestionAnswers) => void
}

export const QuestionSelector = ({
  questions,
  onUpdate,
}: QuestionSelectorProps) => {
  const theme = useTheme()

  // Initialize selections with current/default options
  const [selections, setSelections] = useState<QuestionAnswers>(() => {
    const initial: QuestionAnswers = {}
    questions.forEach((q, idx) => {
      if (q.currentIndex !== undefined) {
        initial[idx] = { type: 'option', value: q.currentIndex }
      }
    })
    return initial
  })

  const [hoveredButton, setHoveredButton] = useState(false)

  const handleOptionClick = useCallback(
    (questionIndex: number, optionIndex: number) => {
      setSelections((prev) => ({
        ...prev,
        [questionIndex]: { type: 'option', value: optionIndex },
      }))
    },
    [],
  )

  const handleUpdate = useCallback(() => {
    onUpdate(selections)
  }, [selections, onUpdate])

  return (
    <box style={{ flexDirection: 'column', gap: 1, width: '100%' }}>
      {questions.map((question, qIdx) => {
        const selectedAnswer = selections[qIdx]
        const selectedOptionIndex =
          selectedAnswer?.type === 'option' ? selectedAnswer.value : -1

        return (
          <box
            key={qIdx}
            style={{ flexDirection: 'column', gap: 0, width: '100%' }}
          >
            {/* Question text */}
            <text style={{ wrapMode: 'word', fg: theme.foreground }}>
              {`${qIdx + 1}. ${question.text}`}
            </text>

            {/* Options */}
            {question.options.map((option, optIdx) => {
              const isSelected = selectedOptionIndex === optIdx
              const isCurrent = question.currentIndex === optIdx
              const radioChar = isSelected ? '✓' : ' '

              return (
                <text
                  key={optIdx}
                  style={{ wrapMode: 'word', fg: theme.foreground }}
                  onMouseDown={() => handleOptionClick(qIdx, optIdx)}
                >
                  {`    (${radioChar}) ${isCurrent ? '(CURRENT) ' : ''}${option}`}
                </text>
              )
            })}
          </box>
        )
      })}

      {/* Help text and update button */}
      <box
        style={{
          flexDirection: 'column',
          gap: 0,
          marginTop: 1,
        }}
      >
        <text style={{ wrapMode: 'word', fg: theme.muted }}>
          Or type custom refinements in the input bar below
        </text>

        <box
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginTop: 1,
          }}
        >
          <box
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 2,
              paddingRight: 2,
              borderStyle: 'single',
              borderColor: hoveredButton ? theme.foreground : theme.secondary,
              customBorderChars: BORDER_CHARS,
            }}
            onMouseDown={handleUpdate}
            onMouseOver={() => setHoveredButton(true)}
            onMouseOut={() => setHoveredButton(false)}
          >
            <text style={{ wrapMode: 'none', fg: theme.foreground }}>
              Update plan
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}
