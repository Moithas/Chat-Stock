#!/bin/bash
cd /home/Chat-Stock
USER=1368419365107535973

echo "=== last 10 actual BUY transactions for this user ==="
sqlite3 -header -column chatstock.db "SELECT id, buyer_id, stock_user_id, shares, price, transaction_type, datetime(timestamp/1000,'unixepoch','localtime') as ts FROM transactions WHERE buyer_id='$USER' AND transaction_type='BUY' ORDER BY id DESC LIMIT 10;"
echo ""
echo "=== last 10 SELL transactions for this user ==="
sqlite3 -header -column chatstock.db "SELECT id, buyer_id, stock_user_id, shares, price, transaction_type, datetime(timestamp/1000,'unixepoch','localtime') as ts FROM transactions WHERE buyer_id='$USER' AND transaction_type='SELL' ORDER BY id DESC LIMIT 10;"
echo ""
echo "=== distinct transaction_types for this user ==="
sqlite3 -header -column chatstock.db "SELECT transaction_type, COUNT(*) as n, datetime(MAX(timestamp)/1000,'unixepoch','localtime') as latest FROM transactions WHERE buyer_id='$USER' GROUP BY transaction_type ORDER BY n DESC;"
echo ""
echo "=== last 20 error_log entries (any user) ==="
sqlite3 -header -column chatstock.db "SELECT id, user_id, command, error_message, datetime(occurred_at/1000,'unixepoch','localtime') as ts FROM error_log ORDER BY id DESC LIMIT 20;"
