const Database = require('better-sqlite3');
const db = new Database('chatstock.db', { readonly: true });
const targetId = '1323839146263052339';

console.log('=== stock_purchases where stock_user_id =', targetId, '===');
const purchases = db.prepare('SELECT * FROM stock_purchases WHERE stock_user_id = ?').all(targetId);
console.log(JSON.stringify(purchases, null, 2));
console.log('Count:', purchases.length);

console.log('\n=== stock_purchases where owner_id =', targetId, '===');
const bought = db.prepare('SELECT * FROM stock_purchases WHERE owner_id = ?').all(targetId);
console.log(JSON.stringify(bought, null, 2));
console.log('Count:', bought.length);

console.log('\n=== stock_purchases table schema ===');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'stock_purchases'").get();
console.log(schema ? schema.sql : 'Table not found');

console.log('\n=== All stock_purchases (sample) ===');
const all = db.prepare('SELECT * FROM stock_purchases LIMIT 20').all();
console.log(JSON.stringify(all, null, 2));
console.log('Total rows:', db.prepare('SELECT COUNT(*) as c FROM stock_purchases').get().c);

db.close();
