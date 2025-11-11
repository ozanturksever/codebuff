import { TextAttributes } from '@opentui/core'
import { describe, expect, test } from 'bun:test'
import React from 'react'

import {
  renderMarkdown,
  renderStreamingMarkdown,
} from '../markdown-renderer'

const flattenNodes = (input: React.ReactNode): React.ReactNode[] => {
  const result: React.ReactNode[] = []

  const visit = (value: React.ReactNode): void => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'boolean'
    ) {
      return
    }

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    if (React.isValidElement(value) && value.type === React.Fragment) {
      visit(value.props.children)
      return
    }

    result.push(value)
  }

  visit(input)
  return result
}

const flattenChildren = (value: React.ReactNode): React.ReactNode[] =>
  flattenNodes(value)

describe('markdown renderer', () => {
  test('renders bold and italic emphasis', () => {
    const output = renderMarkdown('Hello **bold** and *italic*!')
    const nodes = flattenNodes(output)

    expect(nodes[0]).toBe('Hello ')

    const bold = nodes[1] as React.ReactElement
    expect(bold.props.attributes).toBe(TextAttributes.BOLD)
    expect(flattenChildren(bold.props.children)).toEqual(['bold'])

    expect(nodes[2]).toBe(' and ')

    const italic = nodes[3] as React.ReactElement
    expect(italic.props.attributes).toBe(TextAttributes.ITALIC)
    expect(flattenChildren(italic.props.children)).toEqual(['italic'])

    expect(nodes[4]).toBe('!')
  })

  test('renders inline code with palette colors', () => {
    const output = renderMarkdown('Use `ls` to list files.')
    const nodes = flattenNodes(output)

    expect(nodes[0]).toBe('Use ')

    const inlineCode = nodes[1] as React.ReactElement
    expect(inlineCode.props.fg).toBe('#86efac')
    expect(inlineCode.props.bg).toBe('#0d1117')
    expect(flattenChildren(inlineCode.props.children)).toEqual([' ls '])

    expect(nodes[2]).toBe(' to list files.')
  })

  test('renders headings with color and bold attribute', () => {
    const output = renderMarkdown('# Heading One')
    const nodes = flattenNodes(output)

    const heading = nodes[0] as React.ReactElement
    expect(heading.props.attributes).toBe(TextAttributes.BOLD)
    expect(heading.props.fg).toBe('magenta')
    expect(flattenChildren(heading.props.children)).toEqual(['Heading One'])
  })

  test('renders inline emphasis inside headings without extra spacing', () => {
    const output = renderMarkdown(
      '# Other**.github/** - GitHub workflows and config',
    )
    const nodes = flattenNodes(output)

    const heading = nodes[0] as React.ReactElement
    const contents = flattenChildren(heading.props.children)

    expect(contents[0]).toBe('Other')

    const strong = contents[1] as React.ReactElement
    expect(strong.props.attributes).toBe(TextAttributes.BOLD)
    expect(flattenChildren(strong.props.children)).toEqual(['.github/'])

    expect(contents[2]).toBe(' - GitHub workflows and config')
  })

  test('renders blockquotes with prefix', () => {
    const output = renderMarkdown('> note')
    const nodes = flattenNodes(output)

    const prefixSpan = nodes[0] as React.ReactElement
    expect(prefixSpan.props.fg).toBe('gray')
    expect(flattenChildren(prefixSpan.props.children)).toEqual(['> '])

    const textSpan = nodes[1] as React.ReactElement
    expect(textSpan.props.fg).toBe('gray')
    expect(flattenChildren(textSpan.props.children)).toEqual(['note'])
  })

  test('renders lists with bullet markers', () => {
    const output = renderMarkdown('- first\n- second')
    const nodes = flattenNodes(output)

    const bulletSpans = nodes.filter(
      (node): node is React.ReactElement =>
        React.isValidElement(node) &&
        node.type === 'span' &&
        flattenChildren(node.props.children).join('') === '- ',
    )

    expect(bulletSpans).toHaveLength(2)
    bulletSpans.forEach((span) => expect(span.props.fg).toBe('white'))

    const textNodes = nodes
      .filter((node): node is string => typeof node === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
    expect(textNodes).toContain('first')
    expect(textNodes).toContain('second')
  })

  test('renders markdown without closing code fence while streaming', () => {
    const content = '**done**\n```js\nconsole.log('
    const output = renderStreamingMarkdown(content)
    const nodes = flattenNodes(output)

    const boldNode = nodes.find(
      (node): node is React.ReactElement =>
        React.isValidElement(node) &&
        node.props !== undefined &&
        node.props.attributes === TextAttributes.BOLD,
    )

    expect(boldNode).toBeDefined()
    expect(flattenChildren(boldNode!.props.children)).toEqual(['done'])
    expect(nodes[nodes.length - 1]).toBe('```js\nconsole.log(')
  })

  test('renders strikethrough text with GFM', () => {
    const output = renderMarkdown('This is ~~deleted~~ text')
    const nodes = flattenNodes(output)

    expect(nodes[0]).toBe('This is ')

    const strikethrough = nodes[1] as React.ReactElement
    expect(strikethrough.props.attributes).toBe(TextAttributes.DIM)
    expect(flattenChildren(strikethrough.props.children)).toEqual(['deleted'])

    expect(nodes[2]).toBe(' text')
  })

  test('renders task lists with GFM', () => {
    const output = renderMarkdown('- [ ] Todo\n- [x] Done')
    const nodes = flattenNodes(output)

    const checkboxSpans = nodes.filter(
      (node): node is React.ReactElement =>
        React.isValidElement(node) &&
        node.type === 'span' &&
        (flattenChildren(node.props.children).join('') === '[ ] ' ||
          flattenChildren(node.props.children).join('') === '[x] '),
    )

    expect(checkboxSpans).toHaveLength(2)
  })

  test('renders tables with GFM', () => {
    const markdown = `| Name | Age |
| ---- | --- |
| John | 30  |
| Jane | 25  |`
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    // Check that table structure is rendered (pipes and separators)
    const textContent = nodes
      .map((node) => {
        if (typeof node === 'string') return node
        if (React.isValidElement(node)) {
          return flattenChildren(node.props.children).join('')
        }
        return ''
      })
      .join('')

    expect(textContent).toContain('Name')
    expect(textContent).toContain('Age')
    expect(textContent).toContain('John')
    expect(textContent).toContain('Jane')
    expect(textContent).toContain('30')
    expect(textContent).toContain('25')
    expect(textContent).toContain('|')
    expect(textContent).toContain('---')
  })

  test('renders code fence followed by text with quotes correctly', () => {
    const markdown = `\`\`\`bash
# Start using it
codebuff "add a new feature to handle user authentication"
\`\`\``
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    // Get the text content from all nodes
    const textContent = nodes
      .map((node) => {
        if (typeof node === 'string') return node
        if (React.isValidElement(node)) {
          return flattenChildren(node.props.children).join('')
        }
        return ''
      })
      .join('')

    // Should contain the complete command text
    expect(textContent).toContain('# Start using it')
    expect(textContent).toContain('codebuff "add a new feature to handle user authentication"')
    
    // Should NOT have quotes concatenated with backticks
    expect(textContent).not.toContain('it"')
    expect(textContent).not.toContain('```"')
  })

  test('renders inline code followed by quotes correctly', () => {
    const markdown = 'Use `codebuff "fix bug"` to fix bugs.'
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    expect(nodes[0]).toBe('Use ')

    const inlineCode = nodes[1] as React.ReactElement
    expect(inlineCode.props.fg).toBe('#86efac')
    const inlineContent = flattenChildren(inlineCode.props.children).join('')
    expect(inlineContent).toContain('codebuff "fix bug"')

    expect(nodes[2]).toBe(' to fix bugs.')
    
    // Verify quotes are inside the inline code, not concatenated after
    expect(inlineContent).toMatch(/codebuff\s+"fix bug"/)
  })

  test('renders multiple code blocks with text between them', () => {
    const markdown = `First block:

\`\`\`js
console.log("hello")
\`\`\`

Middle text with "quotes"

\`\`\`js
console.log("world")
\`\`\``
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    const textContent = nodes
      .map((node) => {
        if (typeof node === 'string') return node
        if (React.isValidElement(node)) {
          return flattenChildren(node.props.children).join('')
        }
        return ''
      })
      .join('')

    // All content should be present
    expect(textContent).toContain('First block:')
    expect(textContent).toContain('console.log("hello")')
    expect(textContent).toContain('Middle text with "quotes"')
    expect(textContent).toContain('console.log("world")')
    
    // Verify no quote concatenation issues
    expect(textContent).not.toContain('```"')
    expect(textContent).not.toContain('"```')
  })

  test('renders code fence with command and quotes on same line', () => {
    const markdown = `\`\`\`bash
codebuff "implement feature" --verbose
\`\`\``
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    const textContent = nodes
      .map((node) => {
        if (typeof node === 'string') return node
        if (React.isValidElement(node)) {
          return flattenChildren(node.props.children).join('')
        }
        return ''
      })
      .join('')

    // Should preserve the complete command with quotes
    expect(textContent).toContain('codebuff "implement feature" --verbose')
    expect(textContent).not.toContain('```"')
  })

  test('renders inline code with special characters correctly', () => {
    const markdown = 'Run `git commit -m "fix: bug"` to commit.'
    const output = renderMarkdown(markdown)
    const nodes = flattenNodes(output)

    const inlineCode = nodes[1] as React.ReactElement
    const inlineContent = flattenChildren(inlineCode.props.children).join('')

    // Should preserve quotes and special characters within inline code
    expect(inlineContent).toContain('git commit -m "fix: bug"')
    expect(nodes[2]).toBe(' to commit.')
  })

  describe('lettered sub-item indentation', () => {
    test('renders numbered questions with lettered sub-items (real world example)', () => {
      const markdown = `Questions:**
1. What is your preferred storage backend for real-time metrics aggregation?
a) (DEFAULT) PostgreSQL with time-series optimized indexes (leverages existing infrastructure)
b) Dedicated time-series database (InfluxDB/TimescaleDB) for better performance at scale
c) Redis for real-time aggregation with periodic PostgreSQL sync
2. For the metrics dashboard visualization library:
a) (DEFAULT) Recharts (already used in the project, consistent with existing charts)
b) Apache ECharts (more powerful for complex visualizations)
c) D3.js (maximum flexibility, steeper learning curve)
3. Alert webhook delivery priority:
a) (DEFAULT) Implement webhook system first (most flexible for enterprise customers)
b) Focus on email/in-app notifications first (simpler to implement)`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      // Convert all nodes to text to check indentation
      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Lettered items should be indented (3 spaces when under numbered lists)
      expect(textContent).toContain('   a) (DEFAULT) PostgreSQL')
      expect(textContent).toContain('   b) Dedicated time-series')
      expect(textContent).toContain('   c) Redis for real-time')
      expect(textContent).toContain('   a) (DEFAULT) Recharts')
      expect(textContent).toContain('   b) Apache ECharts')
      expect(textContent).toContain('   c) D3.js')
      expect(textContent).toContain('   a) (DEFAULT) Implement webhook')
      expect(textContent).toContain('   b) Focus on email')
    })

    test('renders simple numbered list with lettered sub-items', () => {
      const markdown = `1. First question?
a) First option
b) Second option
c) Third option
2. Second question?
a) Another option
b) One more option`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // All lettered items should have 3 spaces of indentation (under numbered lists)
      expect(textContent).toContain('   a) First option')
      expect(textContent).toContain('   b) Second option')
      expect(textContent).toContain('   c) Third option')
      expect(textContent).toContain('   a) Another option')
      expect(textContent).toContain('   b) One more option')
    })

    test('renders lettered items without numbered parents', () => {
      const markdown = `a) First standalone option
b) Second standalone option
c) Third standalone option`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Should still be indented even without numbered parents
      expect(textContent).toContain('      a) First standalone')
      expect(textContent).toContain('      b) Second standalone')
      expect(textContent).toContain('      c) Third standalone')
    })

    test('renders lettered items with DEFAULT markers', () => {
      const markdown = `1. Choose your option:
a) (DEFAULT) Standard configuration
b) Custom configuration
c) Advanced configuration`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Should preserve DEFAULT markers and apply indentation (3 spaces under list)
      expect(textContent).toContain('   a) (DEFAULT) Standard')
      expect(textContent).toContain('   b) Custom')
      expect(textContent).toContain('   c) Advanced')
    })

    test('renders lettered items with long text', () => {
      const markdown = `1. Which approach do you prefer?
a) This is a very long option that contains lots of detailed information about the approach and its benefits
b) Short option
c) Another very detailed option explaining all the trade-offs and considerations you should think about`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Long text should still be indented (3 spaces under list)
      expect(textContent).toContain('   a) This is a very long option')
      expect(textContent).toContain('   b) Short option')
      expect(textContent).toContain('   c) Another very detailed')
    })

    test('renders extended lettered lists (d, e, f)', () => {
      const markdown = `1. Pick one:
a) Option A
b) Option B
c) Option C
d) Option D
e) Option E
f) Option F`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // All lettered items a-f should be indented (3 spaces under list)
      expect(textContent).toContain('   a) Option A')
      expect(textContent).toContain('   b) Option B')
      expect(textContent).toContain('   c) Option C')
      expect(textContent).toContain('   d) Option D')
      expect(textContent).toContain('   e) Option E')
      expect(textContent).toContain('   f) Option F')
    })

    test('does not indent uppercase lettered items', () => {
      const markdown = `A) This should not be indented
B) Neither should this`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Uppercase should NOT be indented (only lowercase a-z)
      expect(textContent).not.toContain('      A)')
      expect(textContent).not.toContain('      B)')
      expect(textContent).toContain('A) This should not')
      expect(textContent).toContain('B) Neither should')
    })

    test('renders mixed content with paragraphs and lettered items', () => {
      const markdown = `Here's some context before the questions.

1. First question?
a) Option one
b) Option two

And some text in between questions.

2. Second question?
a) Another option
b) Final option

Conclusion text at the end.`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Context and conclusion should not be indented
      expect(textContent).toContain('Here\'s some context')
      expect(textContent).toContain('And some text in between')
      expect(textContent).toContain('Conclusion text at the end')

      // Lettered items should be indented (3 spaces under list)
      expect(textContent).toContain('   a) Option one')
      expect(textContent).toContain('   b) Option two')
      expect(textContent).toContain('   a) Another option')
      expect(textContent).toContain('   b) Final option')
    })

    test('does not indent text that happens to start with letter and parenthesis mid-sentence', () => {
      const markdown = `This is a sentence that mentions a) something in the middle.`

      const output = renderMarkdown(markdown)
      const nodes = flattenNodes(output)

      const textContent = nodes
        .map((node) => {
          if (typeof node === 'string') return node
          if (React.isValidElement(node)) {
            return flattenChildren(node.props.children).join('')
          }
          return ''
        })
        .join('')

      // Should not add indentation for a) in the middle of a sentence
      expect(textContent).not.toContain('      a) something')
      expect(textContent).toContain('a) something in the middle')
    })
  })
})
