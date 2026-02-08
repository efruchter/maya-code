# Maya Code

A Discord bot that connects channels to Claude Code CLI sessions. Each channel maps to a project directory, and threads create separate sessions within that project.

## Architecture

```
Discord Channel (#feature-api)  →  ./projects/feature-api/
  ├── Main channel              →  Session: feature-api-main
  └── Thread (bug-fix)          →  Session: feature-api-<thread-id>
```

## Setup

### Prerequisites

- Node.js 18+
- Claude Code CLI installed and authenticated
- A Discord bot with the following permissions:
  - Send Messages
  - Read Message History
  - Attach Files
  - Use Slash Commands
- **Message Content Intent** enabled in Discord Developer Portal

### Installation

```bash
git clone git@github.com:efruchter/maya-code.git
cd maya-code
npm install
```

### Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your Discord credentials in `.env`:
   ```
   DISCORD_TOKEN=<your_bot_token>
   DISCORD_CLIENT_ID=<your_client_id>
   DISCORD_GUILD_ID=<your_server_id>
   BASE_DIRECTORY=./projects
   ```

3. Register slash commands with Discord:
   ```bash
   npm run deploy-commands
   ```

### Running

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

## Usage

### Sending Messages

Every message in a channel where the bot is present is automatically sent to Claude. No command prefix needed.

The bot will:
- Show a typing indicator while Claude is processing
- Split long responses across multiple messages
- Attach any images Claude creates
- List any other files Claude creates

### Slash Commands

| Command | Description |
|---------|-------------|
| `/continue [message]` | Continue the last conversation with an optional message |
| `/clear` | Reset the session for this channel/thread |
| `/status` | Show session info (ID, message count, project directory) |

### Threads

Create a Discord thread to start an isolated Claude session that shares the same project directory as the parent channel but has its own conversation history.

## Project Structure

```
maya-code/
├── src/
│   ├── index.ts                  # Entry point
│   ├── config.ts                 # Configuration loader
│   ├── bot/
│   │   ├── client.ts             # Discord client setup
│   │   ├── events/               # Discord event handlers
│   │   └── commands/             # Slash commands
│   ├── claude/
│   │   ├── manager.ts            # Process lifecycle
│   │   ├── process.ts            # CLI wrapper
│   │   └── parser.ts             # Stream-JSON parser
│   ├── discord/
│   │   └── responder.ts          # Message chunking
│   └── storage/
│       ├── directories.ts        # Channel→directory mapping
│       └── sessions.ts           # Session persistence
├── scripts/
│   └── deploy-commands.ts        # Slash command registration
└── projects/                     # Auto-created per channel
```

## How It Works

1. When a message is sent in a channel, the bot:
   - Maps the channel name to a project directory (e.g., `#api-work` → `./projects/api-work/`)
   - Gets or creates a session ID for that channel/thread combination
   - Spawns Claude CLI with `--session-id` and `--dangerously-skip-permissions`
   - Streams the response back to Discord

2. Sessions persist across bot restarts via `state.json`

3. Files created by Claude are tracked and attached to Discord messages when applicable

## License

MIT
