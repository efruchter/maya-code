# Heartbeat Feature Plan

## Concept

A per-project periodic timer that reads `heartbeat.md` from the project directory and runs it as a prompt against the existing Claude session. This lets Claude keep working autonomously — e.g., "continue implementing the feature list" or "review TODOs and make progress" — without human intervention.

## How It Works

1. User creates `projects/<channel-name>/heartbeat.md` with a prompt like:
   ```
   Continue working on the project. Check your TODOs and make progress on the next item.
   ```
2. User runs `/heartbeat` in the channel to enable it (optionally setting interval, default 30 min)
3. Every interval, the bot:
   - Reads `heartbeat.md` from the project directory
   - Runs it as a prompt continuing the existing Claude session (same session ID, `continueSession: true`)
   - Posts Claude's response in the channel
4. If `heartbeat.md` doesn't exist when a tick fires, it skips silently
5. If a process is already running in that channel, it skips that tick

## Changes

### 1. `src/storage/sessions.ts` — Add heartbeat config to session
- Add `heartbeat?: { enabled: boolean; intervalMs: number; }` to `SessionData`
- Add `setHeartbeat(channelId, threadId, enabled, intervalMs)` function

### 2. `src/heartbeat/scheduler.ts` — New file, heartbeat scheduler
- `HeartbeatScheduler` class that manages `setInterval` timers per project
- `start(channelId, channelName, intervalMs, sendResponse)` — starts a timer
- `stop(channelId)` — clears the timer
- `stopAll()` — clears all timers (for shutdown)
- On each tick:
  - Read `heartbeat.md` from project directory
  - Skip if file missing, or if a Claude process is already running
  - Call `runClaude()` with the prompt, continuing the session (threadId = null since it's per-project)
  - Send the response to the Discord channel
- Export a singleton instance

### 3. `src/bot/commands/heartbeat.ts` — New `/heartbeat` slash command
- Options: `interval` (integer, optional, minutes, default 30, min 1)
- Toggle behavior: if heartbeat is off, turn it on; if on, turn it off
- On enable: save config to session, start the scheduler, confirm with interval
- On disable: save config, stop the scheduler, confirm

### 4. `src/bot/commands/index.ts` — Register the new command
- Import and add `heartbeat` to `commandModules`

### 5. `src/bot/client.ts` — Pass client to heartbeat for channel access
- After bot is ready, restore any previously-enabled heartbeats from session state
- This way heartbeats survive bot restarts

### 6. `scripts/deploy-commands.ts` — No changes needed
- Already dynamically reads from `commands/index.ts`, just needs re-run after build

## `/heartbeat` Command UX

```
/heartbeat              → Toggle on with 30min default, or toggle off
/heartbeat interval:15  → Toggle on with 15min interval
```

**Enable response:**
> **Heartbeat enabled** — running `heartbeat.md` every 30 minutes. Create/edit `heartbeat.md` in your project directory to set the prompt.

**Disable response:**
> **Heartbeat disabled.**

**No file warning (on tick):**
> Skips silently (no spam). The enable message already tells them to create the file.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/heartbeat/scheduler.ts` | **Create** — scheduler logic |
| `src/bot/commands/heartbeat.ts` | **Create** — slash command |
| `src/bot/commands/index.ts` | **Modify** — register command |
| `src/storage/sessions.ts` | **Modify** — add heartbeat config to SessionData |
| `src/bot/client.ts` | **Modify** — restore heartbeats on startup |
