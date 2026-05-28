require('dotenv').config();
const { REST } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const APP_ID = '1444808482355413063';
const GUILD = '1417672485964615702';
const GUEST = '846585320006221864';
const ROLES = ['1418380912902803526','1418758182033166376','1447284277950681098','1429171544671785103','1417691642659471472','1486840971533746227','1417699409977671771','1417701961293369535'];
const UAC = 1n << 31n;
(async () => {
  // Integration permissions (Server Settings → Integrations → Black Ledger)
  try {
    const perms = await rest.get(`/guilds/${GUILD}/applications/${APP_ID}/commands/permissions`);
    console.log('Integration command perms:', perms.length, 'entries');
    for (const p of perms) {
      console.log(' command_or_app:', p.id, '(application_id:', p.application_id + ')');
      for (const o of p.permissions || []) console.log('  ', JSON.stringify(o));
    }
  } catch (e) {
    console.log('Integration perms fetch:', e.code, e.message, '— (404 = no overrides configured, which is good)');
  }
  // Guest roles UAC bits
  const roles = await rest.get(`/guilds/${GUILD}/roles`);
  console.log('\nGuest role UAC analysis:');
  for (const rid of ROLES) {
    const r = roles.find(x => x.id === rid);
    if (!r) continue;
    const p = BigInt(r.permissions);
    console.log(' ', rid, r.name, 'perms=' + r.permissions, 'UAC=' + ((p & UAC) !== 0n));
  }
  const everyone = roles.find(r => r.id === GUILD);
  if (everyone) {
    const p = BigInt(everyone.permissions);
    console.log('  @everyone perms=' + everyone.permissions, 'UAC=' + ((p & UAC) !== 0n));
  }
})().catch(e => { console.error(e); process.exit(1); });
