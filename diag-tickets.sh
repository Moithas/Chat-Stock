#!/bin/bash
cd /home/Chat-Stock
DB=chatstock.db
echo "===lottery_tickets pool (should have entries if redeemed)==="
sqlite3 "$DB" "SELECT COUNT(*)||' tickets, '||COUNT(DISTINCT user_id)||' users' FROM lottery_tickets;"
echo
echo "===unredeemed FREE-TICKET items held in inventories==="
sqlite3 -header -column "$DB" "SELECT si.id item_id, si.name, si.effect_type, COUNT(DISTINCT ui.user_id) holders, SUM(ui.quantity) total_qty FROM user_inventory ui JOIN shop_items si ON ui.item_id = si.id WHERE si.effect_type='lottery_free_ticket' AND ui.quantity>0 GROUP BY si.id;"
echo
echo "===all lottery_free_ticket shop items (any guild)==="
sqlite3 -header -column "$DB" "SELECT id, guild_id, name, effect_type, enabled FROM shop_items WHERE effect_type='lottery_free_ticket';"
echo
echo "===sample holders (up to 10)==="
sqlite3 -header -column "$DB" "SELECT ui.user_id, si.name, ui.quantity FROM user_inventory ui JOIN shop_items si ON ui.item_id=si.id WHERE si.effect_type='lottery_free_ticket' AND ui.quantity>0 ORDER BY ui.quantity DESC LIMIT 10;"
echo "===END==="
