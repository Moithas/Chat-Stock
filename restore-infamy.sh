#!/bin/bash
set -e
cd /home/Chat-Stock

echo "=== Stopping bot (needed because sql.js holds DB in memory) ==="
pm2 stop black-ledger

echo ""
echo "=== Pre-restore row ==="
sqlite3 -header -line chatstock.db "SELECT user_id, infamy_points, total_earned, peak_infamy FROM infamy_tracker WHERE guild_id='1417672485964615702' AND user_id='1368419365107535973';"

echo ""
echo "=== Restoring infamy_points=105441, total_earned=106949, peak_infamy=105442 (from backup 2026-06-10T18-43-16-908Z) ==="
sqlite3 chatstock.db "UPDATE infamy_tracker SET infamy_points=105441, total_earned=106949, peak_infamy=105442, last_updated=$(date +%s%3N) WHERE guild_id='1417672485964615702' AND user_id='1368419365107535973';"

echo ""
echo "=== Post-restore row ==="
sqlite3 -header -line chatstock.db "SELECT user_id, infamy_points, total_earned, peak_infamy, total_decayed, total_reduced FROM infamy_tracker WHERE guild_id='1417672485964615702' AND user_id='1368419365107535973';"

echo ""
echo "=== Restarting bot ==="
pm2 start black-ledger
sleep 2
pm2 list
