# Codex Support Plan

## Overview

Add support for OpenAI Codex CLI as an alternative backend to Claude CLI. The model is the single source of truth — picking a Codex model switches the backend automatically. One global model setting (not per-channel).

## User Experience

### Setting the model

**In `.env`:**
```
MODEL=claude-opus-4-6
```
This is the bot-wide default. Every session uses this model unless overridden via `/model`.

**Via `/model` command:**
```
# Claude models
/model opus          → claude-opus-4-6
/model sonnet        → claude-sonnet-4-5-20250929
/model haiku         → claude-haiku-4-5-20251001

# Codex models
/model codex         → gpt-5.3-codex (latest)
/model 5.3           → gpt-5.3-codex
/model 5.2           → gpt-5.2-codex
/model 5.1           → gpt-5.1-codex
/model 5.1-mini      → gpt-5.1-codex-mini
/model 5.1-max       → gpt-5.1-codex-max
/model gpt5          → gpt-5-codex
/model gpt5-mini     → gpt-5-codex-mini

# Exact model IDs also work
/model gpt-5.2-codex → exact match

# Reset
/model default       → resets to .env MODEL value
```

**`/model` with no args** shows the current model and available aliases.

### Fuzzy matching

The alias map is defined once. `/model` does:
1. Exact alias match (e.g. `opus` → `claude-opus-4-6`)
2. Substring/prefix match on all known model IDs (e.g. `5.3` matches `gpt-5.3-codex`)
3. If no match, use the raw string as-is (user knows the model ID)

### Backend detection

Simple rule: if the resolved model ID starts with `gpt-` or contains `codex`, use Codex CLI. Otherwise, use Claude CLI. No separate "backend" concept for the user — the model *is* the backend.

## Architecture Changes

### 1. Config (`src/config.ts`)

Add `model` to config, read from `MODEL` env var:
```typescript
export const config = {
  // ...existing...
  model: process.env.MODEL || 'claude-opus-4-6',
};
```

### 2. Model registry (NEW: `src/models.ts`)

Central place for aliases, fuzzy matching, and backend detection.

**Full model table:**

| Alias | Model ID | Backend | Notes |
|---|---|---|---|
| `opus` | `claude-opus-4-6` | claude | Most capable Claude |
| `sonnet` | `claude-sonnet-4-5-20250929` | claude | Fast + capable |
| `haiku` | `claude-haiku-4-5-20251001` | claude | Fastest / cheapest Claude |
| `codex` | `gpt-5.3-codex` | codex | Latest Codex model |
| `5.3` | `gpt-5.3-codex` | codex | Alias for latest |
| `5.2` | `gpt-5.2-codex` | codex | Previous gen |
| `5.1` | `gpt-5.1-codex` | codex | |
| `5.1-mini` | `gpt-5.1-codex-mini` | codex | Smaller / cheaper |
| `5.1-max` | `gpt-5.1-codex-max` | codex | Extended capabilities |
| `gpt5` | `gpt-5-codex` | codex | Earlier gen |
| `gpt5-mini` | `gpt-5-codex-mini` | codex | Earlier gen small |

```typescript
interface ModelEntry {
  alias: string;
  modelId: string;
  backend: 'claude' | 'codex';
}

const MODELS: ModelEntry[] = [
  // Claude
  { alias: 'opus',     modelId: 'claude-opus-4-6',              backend: 'claude' },
  { alias: 'sonnet',   modelId: 'claude-sonnet-4-5-20250929',   backend: 'claude' },
  { alias: 'haiku',    modelId: 'claude-haiku-4-5-20251001',    backend: 'claude' },
  // Codex
  { alias: 'codex',    modelId: 'gpt-5.3-codex',               backend: 'codex' },
  { alias: '5.3',      modelId: 'gpt-5.3-codex',               backend: 'codex' },
  { alias: '5.2',      modelId: 'gpt-5.2-codex',               backend: 'codex' },
  { alias: '5.1',      modelId: 'gpt-5.1-codex',               backend: 'codex' },
  { alias: '5.1-mini', modelId: 'gpt-5.1-codex-mini',          backend: 'codex' },
  { alias: '5.1-max',  modelId: 'gpt-5.1-codex-max',           backend: 'codex' },
  { alias: 'gpt5',     modelId: 'gpt-5-codex',                 backend: 'codex' },
  { alias: 'gpt5-mini',modelId: 'gpt-5-codex-mini',            backend: 'codex' },
];

type Backend = 'claude' | 'codex';

function detectBackend(modelId: string): Backend;
function resolveModel(input: string): { modelId: string; backend: Backend };
function getAvailableModels(): ModelEntry[];
```

**Fuzzy matching logic:**
1. Exact alias match (`opus` → `claude-opus-4-6`)
2. Exact model ID match (`gpt-5.2-codex` → itself)
3. Substring match on model IDs (`5.2` → `gpt-5.2-codex`)
4. No match → use raw string as-is, detect backend from model ID string

### 3. Session storage changes (`src/storage/sessions.ts`)

- Remove per-session `model` field from `SessionData`
- Model is now global, stored in a separate top-level field in state.json OR just read from config + runtime override

Actually, keep it simple: **one global mutable model at runtime**.

```typescript
// In a new src/state/model.ts or in config
let currentModel: string = config.model; // from .env

export function setCurrentModel(modelId: string): void;
export function getCurrentModel(): string;
export function getCurrentBackend(): Backend;
```

This means `/model codex` switches the ENTIRE bot (all channels) to Codex. Persisted in state.json under a top-level `model` key so it survives restarts.

### 4. Backend abstraction (`src/backends/`)

Rename `src/claude/` to `src/backends/` and split:

```
src/backends/
  types.ts          # Shared interfaces
  claude/
    process.ts      # Claude CLI spawning (mostly existing code from src/claude/process.ts)
    parser.ts       # Claude stream-json parser (existing src/claude/parser.ts)
  codex/
    process.ts      # Codex CLI spawning
    parser.ts       # Codex JSONL parser
  manager.ts        # Orchestration — picks backend based on getCurrentBackend()
```

**Shared interface** (`types.ts`):
```typescript
export interface BackendProcessOptions {
  sessionId: string;
  workingDirectory: string;
  prompt: string;
  continueSession?: boolean;
  appendSystemPrompt?: string;
  model?: string;
  planMode?: boolean;
}

export interface BackendProcessResult {
  text: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
  sessionId: string;
  createdFiles: string[];
  imageFiles: string[];
  uploadFiles: string[];
  callbacks: ScheduledCallback[];
}
```

Both `ClaudeProcess` and `CodexProcess` implement the same EventEmitter pattern with `run() → Promise<BackendProcessResult>`.

### 5. Codex process (`src/backends/codex/process.ts`)

**CLI invocation:**
```bash
codex exec --json --yolo --cd <workingDir> -m <model> "<prompt>"
```

Key mappings:
| Concept | Claude CLI flag | Codex CLI flag |
|---|---|---|
| Non-interactive | `-p` | `exec` subcommand |
| JSON streaming | `--output-format stream-json --verbose` | `--json` |
| Skip permissions | `--dangerously-skip-permissions` | `--yolo` |
| Plan mode | `--permission-mode plan` | Not directly available in exec mode — omit `--yolo`, use `--full-auto` |
| Model | `--model X` | `-m X` |
| Working dir | `cwd` on spawn | `--cd PATH` |
| Session resume | `--resume ID` | `exec resume ID "prompt"` |
| New session | `--session-id UUID` | `--ephemeral` for throwaway |
| System prompt | `--append-system-prompt "text"` | Write temp AGENTS.md or `--config model_instructions_file=<path>` |

**System prompt handling:**
Since Codex has no `--append-system-prompt` flag, write a temp file:
```typescript
const tmpPromptFile = path.join(os.tmpdir(), `maya-codex-${uuidv4()}.md`);
await fs.writeFile(tmpPromptFile, systemPrompt);
args.push('--config', `model_instructions_file=${tmpPromptFile}`);
// Clean up tmpPromptFile in finally block
```

**Session handling:**
- For heartbeats: use `--ephemeral`
- For normal messages: let Codex manage sessions naturally. Store the Codex `thread_id` from the `thread.started` event as the sessionId.
- For resume: `codex exec resume <thread_id> "prompt"`

### 6. Codex parser (`src/backends/codex/parser.ts`)

Parse JSONL events. Key event types:
- `thread.started` → extract `thread_id`
- `item.completed` with `type: "agent_message"` → extract text
- `item.completed` with file modification items → track created/modified files
- `turn.completed` → extract `usage.input_tokens` / `output_tokens` for cost approximation
- `error` / `turn.failed` → handle errors

Cost: Codex gives token counts, not USD. Either:
- Maintain a simple pricing table (tokens → USD)
- Just show `$0.00` and add a note that cost tracking isn't available for Codex
- Store token counts separately

### 7. `/model` command changes (`src/bot/commands/model.ts`)

Rewrite to:
- Remove per-session model setting
- Use global `resolveModel()` from models.ts
- Show current global model + backend
- List all aliases grouped by backend
- Fuzzy match input

```
/model            → "Current model: claude-opus-4-6 (Claude)
                     Aliases: opus, sonnet, haiku, codex, ..."

/model codex      → "Model switched to gpt-5.3-codex (Codex backend)"

/model opus       → "Model switched to claude-opus-4-6 (Claude backend)"
```

### 8. Manager changes (`src/backends/manager.ts`)

The `runClaudeImmediate` function (rename to `runBackendImmediate`) checks `getCurrentBackend()` and instantiates either `ClaudeProcess` or `CodexProcess`.

Everything else stays the same — the queue, the session tracking, the system prompt building, the heartbeat session logic.

### 9. What stays unchanged

- All Discord layer code (messageCreate, commands, etc.) — they call `runClaude()` which becomes `runBackend()`
- Heartbeat scheduler — calls the same function
- Git integration
- Response tag parsing (`[CALLBACK:]`, `[UPLOAD:]`, markdown images) — these are in the LLM output text, backend-agnostic
- File sharing / attachment downloads
- State persistence (except model moves to global)

## Migration Steps (implementation order)

1. **Add `src/models.ts`** — alias map, resolveModel(), detectBackend()
2. **Add `MODEL` to `.env` and `config.ts`**
3. **Add global model state** — getCurrentModel/setCurrentModel, persist in state.json
4. **Rewrite `/model` command** — global model, fuzzy match, show backend
5. **Create `src/backends/types.ts`** — shared interfaces
6. **Move `src/claude/` → `src/backends/claude/`** — preserve existing code
7. **Update `src/backends/manager.ts`** — backend selection based on model
8. **Create `src/backends/codex/process.ts`** — Codex CLI spawning
9. **Create `src/backends/codex/parser.ts`** — Codex JSONL parsing
10. **Update all imports** across the codebase
11. **Test with Claude** — make sure nothing broke
12. **Test with Codex** — install codex CLI, switch model, verify streaming

## Open Questions

- **Plan mode for Codex**: In non-interactive `exec` mode, Codex doesn't have a clean equivalent to Claude's `--permission-mode plan`. Options: (a) use `--full-auto` which is close but not the same, (b) just ignore plan mode for Codex with a warning, (c) use `--ask-for-approval untrusted` but that might block in non-interactive mode.
- **Cost tracking**: Codex gives tokens not USD. Do we want a pricing table, or just skip cost tracking for Codex?
- **Session resume for Codex**: Need to verify that `codex exec resume <id> "prompt"` works well in practice. May need testing.
