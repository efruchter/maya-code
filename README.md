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
- Claude Code CLI installed and authenticated (`claude` available on your PATH)
- A Discord server where you have admin/manage permissions

### Step 1: Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in.

2. Click **"New Application"** in the top right. Give it a name (e.g. "Maya Code") and click **Create**.

3. **Copy your Client ID:**
   - On the **General Information** page (the default page), find **Application ID**.
   - Copy it — this is your `DISCORD_CLIENT_ID`.

4. **Create the bot and get its token:**
   - Go to the **Bot** tab in the left sidebar.
   - Click **"Reset Token"** (or **"Add Bot"** if this is a fresh application).
   - Copy the token — this is your `DISCORD_TOKEN`. You won't be able to see it again, so save it now.

5. **Enable Message Content Intent:**
   - Still on the **Bot** tab, scroll down to **Privileged Gateway Intents**.
   - Toggle **Message Content Intent** to ON.
   - Click **Save Changes**.

   > This is required for the bot to read message content in channels. Without it, messages will appear empty to the bot.

6. **Invite the bot to your server:**
   - Go to the **OAuth2** tab in the left sidebar.
   - Under **OAuth2 URL Generator**, check the **`bot`** and **`applications.commands`** scopes.
   - Under **Bot Permissions**, check:
     - Send Messages
     - Read Message History
     - Attach Files
     - Use Slash Commands
   - Copy the generated URL at the bottom and open it in your browser.
   - Select your server and click **Authorize**.

7. **Get your Guild (Server) ID:**
   - In Discord, go to **Settings > Advanced** and enable **Developer Mode**.
   - Right-click your server name in the sidebar and click **"Copy Server ID"**.
   - This is your `DISCORD_GUILD_ID`.

### Step 2: Install Maya Code

```bash
git clone git@github.com:efruchter/maya-code.git
cd maya-code
npm install
```

### Step 3: Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in the values you collected above:
   ```
   DISCORD_TOKEN=<bot token from step 1.4>
   DISCORD_CLIENT_ID=<application id from step 1.3>
   DISCORD_GUILD_ID=<server id from step 1.7>
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
