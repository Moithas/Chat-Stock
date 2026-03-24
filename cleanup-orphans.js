// One-time cleanup script for orphaned infamy records
const Database = require('better-sqlite3');
const db = new Database('chatstock.db');

const infamyResult = db.prepare('DELETE FROM infamy_tracker WHERE user_id NOT IN (SELECT user_id FROM users)').run();
console.log('Infamy records cleaned:', infamyResult.changes);

const bountyResult = db.prepare('DELETE FROM bounty_board WHERE target_user_id NOT IN (SELECT user_id FROM users)').run();
console.log('Bounty records cleaned:', bountyResult.changes);

const snapshotResult = db.prepare('DELETE FROM insider_trading_snapshots WHERE user_id NOT IN (SELECT user_id FROM users)').run();
console.log('Insider trading snapshots cleaned:', snapshotResult.changes);

db.close();
console.log('Done!');
