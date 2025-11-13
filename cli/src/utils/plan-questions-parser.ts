/**
 * Types for parsed questions from plan content
 */
export interface ParsedQuestion {
  text: string
  options: string[]
  currentIndex?: number // Index of the option marked as (CURRENT)
}

export interface ParsedPlan {
  planContent: string // Plan content without questions
  questions: ParsedQuestion[]
}

/**
 * Parses plan content to extract questions and options.
 *
 * Expected format:
 * **Optional follow-up questions:**
 *
 * 1. Question text here?
 *    - a) (CURRENT) Option A
 *    - b) Option B
 *    - c) Option C
 *
 * 2. Another question?
 *    - a) (CURRENT) Option X
 *    - b) Option Y
 */
export function parsePlanQuestions(content: string): ParsedPlan {
  const lines = content.split('\n')

  // Find the start of questions section (case-insensitive)
  // Look for markdown headers or text that indicate questions
  let questionsStartIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase()
    // Remove markdown formatting for comparison
    const cleanLine = line.replace(/[*#_]/g, '').trim()

    if (
      cleanLine.includes('optional follow-up questions') ||
      cleanLine.includes('follow-up questions') ||
      cleanLine.includes('suggested refinements') ||
      cleanLine.includes('refinement questions') ||
      cleanLine.includes('questions:') ||
      cleanLine === 'questions'
    ) {
      questionsStartIndex = i
      break
    }
  }

  // If no questions section found, return all content as plan
  if (questionsStartIndex === -1) {
    return {
      planContent: content,
      questions: [],
    }
  }

  // Split content into plan and questions
  const planContent = lines.slice(0, questionsStartIndex).join('\n').trim()
  const questionsContent = lines.slice(questionsStartIndex + 1).join('\n')

  // Parse questions
  const questions = parseQuestions(questionsContent)

  return {
    planContent,
    questions,
  }
}

function parseQuestions(questionsContent: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []
  const lines = questionsContent.split('\n')

  let currentQuestion: ParsedQuestion | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Skip empty lines
    if (!trimmedLine) {
      if (currentQuestion && currentQuestion.options.length > 0) {
        questions.push(currentQuestion)
        currentQuestion = null
      }
      continue
    }

    // Check if this is a numbered question
    // Format: "1. **Title**: Question text?" or "1. Question text?"
    const questionMatch = trimmedLine.match(/^(\d+)\.\s+(.+)/)
    if (questionMatch) {
      // Save previous question if exists
      if (currentQuestion && currentQuestion.options.length > 0) {
        questions.push(currentQuestion)
      }

      // Extract question text, removing markdown bold markers
      let questionText = questionMatch[2]
      // Remove ** markdown markers
      questionText = questionText.replace(/\*\*/g, '')

      // Start new question
      currentQuestion = {
        text: questionText,
        options: [],
      }
      continue
    }

    // If we have a current question, check for options
    if (currentQuestion) {
      // Check for lettered options: "   a) Option text" (with any amount of whitespace)
      const optionMatch = line.match(/^\s+([a-z])\)\s*(.+)/)
      if (optionMatch) {
        const optionText = optionMatch[2]

        // Check if this option is marked as (CURRENT)
        if (optionText.includes('(CURRENT)')) {
          currentQuestion.currentIndex = currentQuestion.options.length
          currentQuestion.options.push(optionText.replace(/\(CURRENT\)\s*/i, '').trim())
        } else {
          currentQuestion.options.push(optionText.trim())
        }
        continue
      }
    }
  }

  // Don't forget the last question
  if (currentQuestion && currentQuestion.options.length > 0) {
    questions.push(currentQuestion)
  }

  return questions
}
