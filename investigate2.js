const Database = require('better-sqlite3');
const db = new Database('chatstock.db', { readonly: true });
const targetId = '1323839146263052339';
const ownerId = '1368419365107535973';

console.log('=== stocks table for owner', ownerId, '===');
const stocks = db.prepare('SELECT * FROM stocks WHERE owner_id = ?').all(ownerId);
console.log(JSON.stringify(stocks, null, 2));

console.log('\n=== transactions involving this pair ===');
const txns = db.prepare('SELECT * FROM transactions WHERE (buyer_id = ? AND stock_user_id = ?) OR (buyer_id = ? AND stock_user_id = ?) ORDER BY timestamp DESC LIMIT 20').all(ownerId, targetId, targetId, ownerId);
console.log(JSON.stringify(txns, null, 2));

console.log('\n=== stock_purchases for this pair ===');
const purchases = db.prepare('SELECT * FROM stock_purchases WHERE owner_id = ? AND stock_user_id = ?').all(ownerId, targetId);
console.log(JSON.stringify(purchases, null, 2));

console.log('\n=== wealth_tax_history for owner ===');
try {
  const taxes = db.prepare('SELECT * FROM wealth_tax_history WHERE user_id = ? ORDER BY collection_time DESC LIMIT 10').all(ownerId);
  console.log(JSON.stringify(taxes, null, 2));
} catch(e) { console.log(e.message); }

console.log('\n=== All SELL transactions for owner ===');
const sells = db.prepare("SELECT * FROM transactions WHERE buyer_id = ? AND transaction_type = 'SELL' ORDER BY timestamp DESC LIMIT 10").all(ownerId);
console.log(JSON.stringify(sells, null, 2));

console.log('\n=== All stocks with 0 shares ===');
const zeroShares = db.prepare('SELECT * FROM stocks WHERE shares <= 0').all();
console.log(JSON.stringify(zeroShares, null, 2));
console.log('Count:', zeroShares.length);

db.close();
