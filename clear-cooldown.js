const initSqlJs = require('sql.js');
const fs = require('fs');

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('chatstock.db'));
  
  const r = db.exec("SELECT last_hack_time FROM hack_tracker WHERE guild_id = '1417672485964615702' AND user_id = '956360653680037920'");
  console.log('Current cooldown:', JSON.stringify(r));
  
  db.run("DELETE FROM hack_tracker WHERE guild_id = '1417672485964615702' AND user_id = '956360653680037920'");
  
  const r2 = db.exec("SELECT last_hack_time FROM hack_tracker WHERE guild_id = '1417672485964615702' AND user_id = '956360653680037920'");
  console.log('After delete:', JSON.stringify(r2));
  
  fs.writeFileSync('chatstock.db', Buffer.from(db.export()));
  console.log('Done - cooldown cleared for zebritbrat');
});
