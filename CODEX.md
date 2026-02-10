# Planned Features

## 1. Message Chunking Improvements

### Current State
Three duplicate `splitMessage()` functions exist:
- `src/discord/responder.ts` (lines 41-84) — smart 3-tier splitting (code blocks → newlines → spaces)
- `src/bot/events/messageCreate.ts` (lines 21-64) — same logic, copy-pasted
- `src/heartbeat/scheduler.ts` (lines 285-312) — simplified 2-tier (newlines → spaces)

All respect the 2000 char limit. But none handle **code block continuation** — if a split happens mid-code-block, the second chunk starts without opening backticks.

### Plan

**A. Consolidate into one shared function:**
- Move `splitMessage()` to `src/utils/discord.ts`
- Delete the three duplicate copies
- All callers import from the shared util

**B. Add code block continuation:**
When splitting inside an open code block, the function should:
1. Close the code block at the end of the current chunk (`` ```  ``)
2. Reopen it at the start of the next chunk with the same language tag (`` ```ts ``)
3. Track open/close state by counting triple-backtick occurrences

**C. Fix `fixCodeBlocks()` in responder.ts:**
The existing function just appends closing backticks if count is odd. With proper splitting, this becomes unnecessary — remove it.

### Files Changed
- NEW: `src/utils/discord.ts` — shared `splitMessage()` with code block continuation
- EDIT: `src/discord/responder.ts` — import shared function, remove local copy + `fixCodeBlocks()`
- EDIT: `src/bot/events/messageCreate.ts` — import shared function, remove local copy
- EDIT: `src/heartbeat/scheduler.ts` — import shared function, remove local copy

---

## 2. Session Cleanup on Thread Deletion

### Current State
- No `threadDelete` event listener exists
- Sessions for deleted threads remain in `state.json` forever as orphans
- Cleanup only happens manually via `/clear` or `/reset`

### Plan

**A. Add `threadDelete` event listener:**
- Create `src/bot/events/threadDelete.ts`
- Listen for `Events.ThreadDelete`
- When a thread is deleted:
  1. Kill any running process for that thread
  2. Call `clearSession(channelId, threadId)`
  3. Log the cleanup

**B. Wire up the event:**
- Import and call `setupThreadDeleteEvent(client)` in `src/bot/client.ts`
- May need `Partials.Thread` for uncached thread events

### Files Changed
- NEW: `src/bot/events/threadDelete.ts` — thread deletion handler
- EDIT: `src/bot/client.ts` — register new event, possibly add `Partials.Thread`

---

## 3. Image Input for Codex

### Current State
- Discord attachments are already downloaded to `uploads/` in `messageCreate.ts`
- Downloaded file paths are included in the prompt text for Claude to read
- Codex CLI has `-i <path>` flag for native image input (repeatable, comma-separated)
- Claude reads images via tool use (no special flag)

### Plan

**A. Add image paths to process options:**
- Add `imageInputs?: string[]` to `BackendProcessOptions` in `types.ts`
- In `manager.ts`, pass downloaded attachment paths as `imageInputs`

**B. Wire into Codex CLI args:**
- In `src/backends/codex/process.ts`, add `-i` flags for each image:
  ```
  codex exec --json --yolo -i image1.png -i image2.png -m gpt-5.3-codex "prompt"
  ```

**C. Keep text fallback for Claude:**
- Claude backend ignores `imageInputs` (paths stay in prompt text as-is)
- Codex gets both: `-i` for actual vision + paths in text for context

### Files Changed
- EDIT: `src/backends/types.ts` — add `imageInputs` to options
- EDIT: `src/backends/codex/process.ts` — add `-i` flag
- EDIT: `src/backends/manager.ts` — pass image paths
- EDIT: `src/bot/events/messageCreate.ts` — pass downloaded paths through

---

## 4. Configurable System Prompt (Markdown Files)

### Current State
Two large string literals hardcoded in `src/backends/manager.ts`:
- `DISCORD_SYSTEM_PROMPT` (~1800 chars) — sent to every session
- `HEARTBEAT_ADDITION` (~2000 chars) — appended for heartbeat ticks

Editing requires modifying TypeScript, recompiling, and restarting.

### Plan

**A. Create prompt files:**
```
prompts/
  system.md        ← main system prompt (session behavior, slash commands, callbacks, etc.)
  heartbeat.md     ← autonomous loop instructions (appended for heartbeat ticks)
```

**B. Load prompts at startup:**
- Read files once when the manager first runs (lazy load + cache)
- If a file doesn't exist, fall back to the current hardcoded defaults
- Users who deploy this can edit the .md files directly — no recompile needed, just restart

**C. Keep it simple — no templating:**
Plain markdown files, no `{{variable}}` substitution. The deployer edits the files to match their setup. If they add/remove commands, they update the prompt file too. KISS.

### Files Changed
- NEW: `prompts/system.md` — extracted from `DISCORD_SYSTEM_PROMPT`
- NEW: `prompts/heartbeat.md` — extracted from `HEARTBEAT_ADDITION`
- EDIT: `src/backends/manager.ts` — load from files with hardcoded fallback
- EDIT: `src/config.ts` — add `promptsDirectory` path

---

## Implementation Order

1. **Configurable system prompt** — low risk, just extracting strings to files
2. **Message chunking** — pure refactor + code block continuation fix
3. **Thread deletion cleanup** — small new event listener
4. **Image input for Codex** — needs Codex CLI installed to test
