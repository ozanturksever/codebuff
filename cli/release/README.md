# The most powerful coding agent

Codebuff is a CLI tool that writes code for you.

1. Run `codebuff` from your project directory
2. Tell it what to do
3. It will read and write to files and run commands to produce the code you want

Note: Codebuff will run commands in your terminal as it deems necessary to fulfill your request.

## Installation

To install Codebuff, run:

```bash
npm install -g codebuff
```

(Use `sudo` if you get a permission error.)

## Usage

After installation, you can start Codebuff by running:

```bash
codebuff [project-directory]
```

If no project directory is specified, Codebuff will use the current directory.

Once running, simply chat with Codebuff to say what coding task you want done.

## Features

- Understands your whole codebase
- Creates and edits multiple files based on your request
- Can run your tests or type checker or linter; can install packages
- It's powerful: ask Codebuff to keep working until it reaches a condition and it will.

Our users regularly use Codebuff to implement new features, write unit tests, refactor code,write scripts, or give advice.

## Knowledge Files

To unlock the full benefits of modern LLMs, we recommend storing knowledge alongside your code. Add a `knowledge.md` file anywhere in your project to provide helpful context, guidance, and tips for the LLM as it performs tasks for you.

Codebuff can fluently read and write files, so it will add knowledge as it goes. You don't need to write knowledge manually!

Some have said every change should be paired with a unit test. In 2024, every change should come with a knowledge update!

## Non-Interactive Mode

Run Codebuff without the TUI for scripting and automation:

```bash
# Basic non-interactive usage
codebuff -n "fix the bug in auth.ts"

# Pipe prompt from stdin
echo "explain this code" | codebuff -n

# JSON output for structured parsing
codebuff --json "analyze the codebase"

# Quiet mode (suppress streaming, show final result only)
codebuff -q "run the tests"

# Set a timeout (in seconds)
codebuff -n --timeout 60 "quick task"

# Write output to a file
codebuff -n -o result.txt "generate a report"

# Combine with mode flags
codebuff -n --max "complex refactoring task"
codebuff -n --lite "simple question"
```

**Flags:**
- `-n, --non-interactive` - Run without TUI, stream output to stdout
- `--json` - Output structured JSON (implies `-n`)
- `-q, --quiet` - Suppress streaming, show final result only (implies `-n`)
- `--timeout <seconds>` - Set execution timeout
- `-o, --output <file>` - Write output to file (implies `-n`)
- `--agent <agent-id>` - Run a specific agent
- `--continue [id]` - Continue from a previous conversation
- `--lite` - Use LITE mode (faster, simpler tasks)
- `--max` - Use MAX mode (complex tasks)
- `--plan` - Use PLAN mode (planning tasks)

## Ralph Mode (PRD-Driven Development)

Ralph helps you build features by breaking them into user stories and executing them autonomously.

### Creating a PRD

```bash
# Interactive PRD creation
/ralph new my-feature

# With feature description
/ralph new auth-system Add user authentication with OAuth

# With initial context (skip some questions)
/ralph new auth -- use OAuth2 with Google and GitHub providers

# Create PRD from current chat context
/ralph handoff
```

### Managing PRDs

```bash
# List all PRDs
/ralph
/ralph list

# View detailed status
/ralph status my-feature

# Edit an existing PRD
/ralph edit my-feature

# Delete a PRD
/ralph delete my-feature
```

### Executing Stories

```bash
# Run the next pending story
/ralph run my-feature
```

Ralph will:
1. Execute the story using TDD principles
2. Write tests first, then implement
3. Commit changes with the story ID
4. Mark the story complete in the PRD
5. Suggest continuing to the next story

### Parallel Execution

Run multiple stories simultaneously in separate git worktrees:

```bash
# Create worktrees for specific stories
/ralph parallel my-feature US-001 US-002 US-003

# Create worktrees for all pending stories
/ralph parallel my-feature
```

Then open terminals in each worktree and run `/ralph run my-feature`.

```bash
# Merge completed branches back to main
/ralph merge my-feature

# Clean up worktrees when done
/ralph cleanup my-feature
```

### Orchestra Mode (Fully Autonomous)

Let Ralph handle everything automatically:

```bash
# Run all stories autonomously with default parallelism (2)
/ralph orchestra my-feature

# Specify parallelism level (1-10)
/ralph orchestra my-feature --parallelism 3
/ralph orchestra my-feature -p 4
```

Orchestra mode will:
- Create worktrees for parallel execution
- Execute stories using the SDK
- Merge completed branches automatically
- Resolve merge conflicts using AI
- Continue until all stories pass

### Non-Interactive Ralph

Ralph commands work in non-interactive mode:

```bash
# List PRDs
codebuff -n "/ralph list"

# Run orchestra mode
codebuff -n "/ralph orchestra my-feature --parallelism 3"

# Get status as JSON
codebuff --json "/ralph status my-feature"
```

### PRD File Format

PRDs are stored in `prd/` as JSON files:

```json
{
  "project": "My Feature",
  "branchName": "feature/my-feature",
  "description": "Feature description",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a user, I want...",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Tips

1. Type '/help' or just '/' to see available commands.
2. Create a `knowledge.md` file and collect specific points of advice. The assistant will use this knowledge to improve its responses.
3. Type `undo` or `redo` to revert or reapply file changes from the conversation.
4. Press `Esc` or `Ctrl+C` while Codebuff is generating a response to stop it.
5. Use `/ralph help` to see all Ralph commands.

## Troubleshooting

If you are getting permission errors during installation, try using sudo:

```
sudo npm install -g codebuff
```

If you still have errors, it's a good idea to [reinstall Node](https://nodejs.org/en/download).

## Feedback

We value your input! Please email your feedback to `founders@codebuff.com`. Thank you for using Codebuff!
