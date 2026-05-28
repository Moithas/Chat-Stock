// One-time migration: import Discord Integration command-channel permissions
// into the local command_channel_allowlist table. After running this, you can
// safely clear the Integration permissions in Server Settings → Integrations,
// and the bot will enforce the same restrictions in code (with the added benefit
// that it can dynamically grant VIP rooms access).
//
// Usage: node seed-command-channels.js <GUILD_ID> [--app APP_ID] [--dry]

require('dotenv').config();
const { REST } = require('discord.js');
const { initDatabase, getDb, saveDatabase } = require('./database');
const { initCommandChannels, setAllowedChannels, listGuildRestrictions } = require('./commandChannels');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const appIdx = args.indexOf('--app');
const APP_ID_OVERRIDE = appIdx !== -1 ? args[appIdx + 1] : null;
const GUILD = args.find(a => /^\d{15,21}$/.test(a));

if (!GUILD) {
  console.error('Usage: node seed-command-channels.js <GUILD_ID> [--app APP_ID] [--dry]');
  process.exit(1);
}

(async () => {
  await initDatabase();
  initCommandChannels(getDb());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  // Discover app id from /users/@me if not supplied
  let appId = APP_ID_OVERRIDE;
  if (!appId) {
    const me = await rest.get('/users/@me');
    appId = me.id;
  }
  console.log('App id:', appId, 'Guild:', GUILD, dry ? '(dry run)' : '');

  // Lookup command id → name
  const cmds = await rest.get(`/applications/${appId}/guilds/${GUILD}/commands`);
  const nameById = Object.fromEntries(cmds.map(c => [c.id, c.name]));

  // Fetch all per-command permission overrides
  const perms = await rest.get(`/applications/${appId}/guilds/${GUILD}/commands/permissions`);
  const ALL_CHANNELS = (BigInt(GUILD) - 1n).toString();
  const TYPE_CHANNEL = 3;

  let imported = 0, skipped = 0;
  for (const p of perms) {
    const cmdName = nameById[p.id];
    if (!cmdName) { // app-level default or unknown command id
      console.log('  - skipping non-command entry id', p.id);
      skipped++;
      continue;
    }
    // Only honor channel overrides; ignore role/user overrides (Integration UI 
    // mostly uses channel overrides for "command in these channels only"). Also
    // only honor `permission=true` channel entries — these are the explicit allow
    // list. A `permission=false [ALL CHANNELS]` is the default-deny that defines
    // the restriction; we don't need to copy it (its presence is implied by any
    // other allowed channels).
    const allowedChannels = [];
    let hasDefaultDeny = false;
    for (const o of (p.permissions || [])) {
      if (o.type !== TYPE_CHANNEL) continue;
      if (o.id === ALL_CHANNELS && o.permission === false) { hasDefaultDeny = true; continue; }
      if (o.permission === true) allowedChannels.push(o.id);
    }
    if (!hasDefaultDeny && allowedChannels.length === 0) {
      console.log(`  - /${cmdName}: no restrictive rules, skipping`);
      skipped++;
      continue;
    }
    if (!hasDefaultDeny) {
      console.log(`  - /${cmdName}: explicit allows without default-deny, skipping`);
      skipped++;
      continue;
    }
    if (allowedChannels.length === 0) {
      console.log(`  ! /${cmdName}: ALL CHANNELS denied with no allow list — this would block the command everywhere; skipping (configure manually)`);
      skipped++;
      continue;
    }
    console.log(`  + /${cmdName}: ${allowedChannels.length} channel(s)`);
    if (!dry) setAllowedChannels(GUILD, cmdName, allowedChannels);
    imported++;
  }

  if (!dry) saveDatabase();

  console.log(`\nImported ${imported} command restriction set(s); skipped ${skipped}.`);
  const summary = listGuildRestrictions(GUILD);
  console.log('Current in-DB restrictions count:', Object.keys(summary).length);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
