// Quick database query tool
const Database = require('better-sqlite3');
const db = new Database('chatstock.db', { readonly: true });
const sql = process.argv[2];
if (!sql) { console.log('Usage: node query-db.js "SELECT ..."'); process.exit(1); }
try {
  const rows = db.prepare(sql).all();
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error(e.message);
}
db.close();
