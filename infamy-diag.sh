#!/bin/bash
cd /home/Chat-Stock
BACKUP=$(ls -1t backups/chatstock-*.db | head -1)
echo "=== Using backup: $BACKUP ==="
echo ""
echo "=== Player row in backup ==="
sqlite3 -header -line "$BACKUP" "SELECT user_id, infamy_points, total_earned, peak_infamy, total_decayed, total_reduced, bounties_posted, bounties_claimed_on, probation_until, probation_tier, datetime(last_updated/1000,'unixepoch','localtime') as last_updated_local FROM infamy_tracker WHERE guild_id='1417672485964615702' AND user_id='1368419365107535973';"
echo ""
echo "=== Current row in production (for diff) ==="
sqlite3 -header -line chatstock.db "SELECT user_id, infamy_points, total_earned, peak_infamy, total_decayed, total_reduced, bounties_posted, bounties_claimed_on, probation_until, probation_tier, datetime(last_updated/1000,'unixepoch','localtime') as last_updated_local FROM infamy_tracker WHERE guild_id='1417672485964615702' AND user_id='1368419365107535973';"
