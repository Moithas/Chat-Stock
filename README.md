# Black Ledger

**Black Ledger** is a full-featured Discord economy bot. Every member of your
server is a tradeable "stock" whose value rises with activity — buy low, sell
high, and build wealth through a deep economy of jobs, gambling, PvP, property,
pets, and more. Everything is per-server, works out of the box with sensible
defaults, and is configurable by admins.

> All currency, stocks, items, and rewards are **entirely virtual** and have no
> real-world monetary value. See the [Terms of Service](./TERMS_OF_SERVICE.txt)
> and [Privacy Policy](./PRIVACY_POLICY.txt).

---

## Features

- 📈 **Stock market** — Members are tradeable stocks priced by chat activity, supply/demand, and market events.
- 💹 **Dividends & splits** — Passive income for shareholders, with automatic stock splits.
- 💼 **Economy** — `/work`, `/crime`, banking, loans, bonds, wealth tax, and prestige.
- 🎰 **Gambling** — Blackjack, video poker, three-card poker, in-between, let-it-ride, scratchcards, lottery, and more.
- ⚔️ **PvP** — Rob, hack, fight, and investigate other players, with infamy and bounties.
- 🏠 **Property & items** — Own property, collect cards, trade items, and run VIP rooms.
- 🐾 **Pets** — Hatch, raise, and battle collectible pets.
- 🗺️ **Dungeons & hunts** — PvE runs with loot.
- 🛠️ **Admin panel** — 20+ configurable modules via `/admin`, plus health and usage monitoring.

Run `/help` in Discord for the full, always-up-to-date command catalog.

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A Discord application + bot token ([Developer Portal](https://discord.com/developers/applications))

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

At minimum set `DISCORD_TOKEN`. See [.env.example](./.env.example) for all options.

> **Upgrading an existing database?** The stock market is isolated per server. If
> your `chatstock.db` predates this, set `LEGACY_GUILD_ID` in `.env` to the server
> ID that owns the existing market data before the first start — the bot performs a
> one-time migration that stamps all existing market data with that server, and
> refuses to start (to avoid orphaning data) if the variable is missing. A backup is
> written to `backups/` before any schema change. Fresh installs can leave it unset.

### 3. Enable required intents

In the Developer Portal → your app → **Bot**, enable:

- **Server Members Intent**
- **Message Content Intent**

### 4. Invite the bot

Use the OAuth2 URL Generator with scopes `bot` and `applications.commands`, and
grant the permissions the bot needs (Send Messages, Embed Links, Attach Files,
Use Application Commands, Manage Channels for VIP rooms, and Manage Roles for
role-granting items).

### 5. Run

```bash
npm start
```

Slash commands register automatically whenever their definitions change.

---

## Running in production

A [PM2](https://pm2.keymetrics.io/) config is included:

```bash
pm2 start ecosystem.config.js
```

It handles auto-restart, a memory ceiling, graceful shutdown, and a nightly
restart to keep the gateway session fresh.

A health endpoint is exposed on `127.0.0.1:${HEALTH_PORT}/health` (default port
`8080`) returning status, uptime, guild count, ping, and memory usage.

---

## Data & privacy

Black Ledger stores only the data needed to run its features (Discord IDs,
usernames, and in-game state) in a local SQLite database. It does **not** store
message content. Players can remove their data with `/deletedata`. Full details
are in the [Privacy Policy](./PRIVACY_POLICY.txt).

### Backups

The bot writes automatic SQLite backups to [backups/](./backups) on startup and
every 6 hours, keeping the most recent copies. These live on the same host, so
for production set `BACKUP_SYNC_CMD` in your `.env` to ship each backup to
off-host storage (e.g. `rclone` or `aws s3 sync`) — otherwise a disk failure
would lose both the database and its backups. See [.env.example](./.env.example).

---

## Support

Questions, bug reports, or data requests: join the support server at
<https://discord.gg/3PnT5BknaP>.

## License

MIT — see [package.json](./package.json).
