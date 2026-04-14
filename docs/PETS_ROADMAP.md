# Pets System Roadmap

## Completed Phases

### Phase 1: Core Pet System ✅
*Released: April 1, 2026*
- Species definitions (shop + exotic)
- Rarity system (common → legendary)
- Growth phases (baby → juvenile → adult → elder)
- Pet shop with rotating stock
- Adoption, naming, feeding, playing, training
- Active pet bonuses (work, rob, vault, property, gambling)
- Kennel system with upgrades
- Pet images with variants
- Shiny pets with holographic overlay

### Phase 2.5: Eggsotics ✅
*Released: April 2026*
- Egg shop (Mystery, Golden, Prismatic)
- Egg warming mechanic
- Hatching with pity protection
- Exotic species from eggs (wolf, dragon, alien, unicorn)
- Egg incubation stage images

---

## Phase 3: Breeding System 🔜

### Overview
Players can breed their Adult/Elder pets to produce offspring. Breeding requires a male and female of the same species.

### Requirements
- Both pets must be **Adult** or **Elder** phase (level 26+)
- Same species required (Cat + Cat, Dragon + Dragon, etc.)
- One male, one female
- Requesting player must have available kennel slot
- Female must not be on breeding cooldown
- Female must not already be gestating

### Gender System
- Gender assigned randomly (50/50) at adoption/hatch
- Stored as `gender` field on pet record

### Breeding Fees
Based on the **higher rarity** of the two parents:

| Rarity | Base Fee | Exotic Fee (3x) |
|--------|----------|-----------------|
| Common | 75,000 | 225,000 |
| Uncommon | 100,000 | 300,000 |
| Rare | 200,000 | 600,000 |
| Epic | 500,000 | 1,500,000 |
| Legendary | 1,000,000 | 3,000,000 |

Fee paid by the player initiating the breeding request.

### Gestation
- Duration: **24 hours** (configurable)
- The **female parent** gestates
- Female is marked as "gestating" and cannot breed again during this time
- Baby details are **unknown** until birth (no rarity/variant/shiny preview)
- Baby consumes a kennel slot for the **requesting player** during gestation
- When timer completes, owner clicks **"Give Birth"** button to reveal baby

### Cooldowns
- **Female only**: 3 days after giving birth (configurable)
- Males have no cooldown

### Variant Inheritance
- If both parents share the same variant → baby inherits that variant
- If parents have different variants → baby gets random variant for that species

### Rarity Inheritance

#### Base Rarity Table

| Parent A | Parent B | Common | Uncommon | Rare | Epic | Legendary |
|----------|----------|--------|----------|------|------|-----------|
| Common | Common | 85% | 14% | 1% | - | - |
| Common | Uncommon | 45% | 50% | 5% | - | - |
| Common | Rare | 25% | 55% | 19% | 1% | - |
| Common | Epic | 15% | 40% | 40% | 5% | - |
| Common | Legendary | 10% | 30% | 40% | 19% | 1% |
| Uncommon | Uncommon | 5% | 80% | 14% | 1% | - |
| Uncommon | Rare | - | 45% | 50% | 5% | - |
| Uncommon | Epic | - | 25% | 55% | 19% | 1% |
| Uncommon | Legendary | - | 15% | 40% | 40% | 5% |
| Rare | Rare | - | 5% | 80% | 14% | 1% |
| Rare | Epic | - | - | 45% | 50% | 5% |
| Rare | Legendary | - | - | 25% | 55% | 20% |
| Epic | Epic | - | - | 5% | 80% | 15% |
| Epic | Legendary | - | - | - | 45% | 55% |
| Legendary | Legendary | - | - | - | 5% | 95% |

#### Elder Bonus
If **either parent is Elder**, the rolled rarity is shifted **+1 tier** (capped at Legendary).
- Bonus applies **once** even if both parents are Elder
- This allows up to +2 tier jumps (base roll can go +1, elder shifts +1 more)
- **Guaranteed Legendary**: Legendary + Legendary with Elder parent

### Shiny Inheritance

| Parent Shiny Status | Baby Shiny Chance |
|---------------------|-------------------|
| Neither parent shiny | 1% |
| One parent shiny | 5% |
| Both parents shiny | 15% |

### Cross-Player Breeding
1. **Player A** initiates breeding request, selecting their pet and targeting Player B's pet
2. **Player B** can set a **Stud Fee** (any amount, free market)
3. **Player A** sees confirmation embed with Accept/Decline buttons
4. If accepted:
   - Player A pays breeding fee + stud fee
   - Player B receives stud fee
   - Player B's female begins gestating (if female) OR Player A's female gestates
   - Baby goes to **Player A** (the requester)

### Baby Stats
Newborn pets start with:
- Level 1 (Baby phase)
- XP: 0
- Hunger: 100 (max)
- Happiness: 100 (max)
- Gender: Random

---

## Phase 3.5: Give/Sell Pets 🔜

### Transfer System
Players can transfer pet ownership to other players, either as a gift or sale.

### Requirements
- Pet must belong to you
- Pet happiness must be **80 or higher**
- Cannot transfer eggs
- Cannot transfer gestating pets

### Transfer Penalty
- Pet loses **50 happiness** upon transfer completion
- This prevents rapid flipping and encourages care

### Sell Flow
1. Owner initiates sale, sets price (or 0 for gift)
2. Target player receives offer embed with Accept/Decline
3. If accepted:
   - Buyer pays price to seller
   - Pet ownership transfers
   - Pet loses 50 happiness
   - Pet moves to buyer's kennel (must have slot)

---

## Admin Settings

All breeding/transfer settings configurable via `/admin-pets`:

| Setting | Default | Description |
|---------|---------|-------------|
| `breeding_enabled` | true | Enable/disable breeding system |
| `breeding_fee_common` | 75000 | Breeding fee for common |
| `breeding_fee_uncommon` | 100000 | Breeding fee for uncommon |
| `breeding_fee_rare` | 200000 | Breeding fee for rare |
| `breeding_fee_epic` | 500000 | Breeding fee for epic |
| `breeding_fee_legendary` | 1000000 | Breeding fee for legendary |
| `breeding_exotic_multiplier` | 3.0 | Fee multiplier for exotic species |
| `breeding_cooldown_hours` | 72 | Female cooldown after birth (hours) |
| `gestation_hours` | 24 | Gestation duration (hours) |
| `shiny_chance_none` | 0.01 | Shiny chance, neither parent shiny |
| `shiny_chance_one` | 0.05 | Shiny chance, one parent shiny |
| `shiny_chance_both` | 0.15 | Shiny chance, both parents shiny |
| `max_stud_fee` | 0 | Max stud fee (0 = unlimited) |
| `transfer_enabled` | true | Enable/disable give/sell |
| `transfer_min_happiness` | 80 | Min happiness to transfer |
| `transfer_happiness_penalty` | 50 | Happiness lost on transfer |

---

## Future Phases (Ideas)

### Phase 4: Pet Abilities
- Unique abilities per species
- Ability unlocks at certain levels
- Active abilities with cooldowns

### Phase 5: Pet Battles
- PvP pet battles
- Battle stats derived from level/rarity
- Rewards for winning

### Phase 6: Pet Achievements
- Collection milestones
- Breeding achievements
- Special titles/badges
