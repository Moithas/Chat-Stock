/**
 * Scratch Card System
 * Generates visual scratch-off lottery tickets using Canvas
 */

const { createCanvas, registerFont } = require('canvas');
const path = require('path');

// Card configurations
const CARD_CONFIGS = {
  cheese: {
    name: 'Cheese Frenzy',
    emoji: '🧀',
    titleDecor: '◆', // Text-based decorations for title
    grid: { rows: 3, cols: 3 },
    price: 500,
    symbols: ['🧀', '🔆', '🪤', '🐄', '🐐', '🐭', '🥐', '🍕', '🧑‍🍳', '🍴', '🥮', '💎'],
    winSymbol: '🧀',
    jackpotSymbol: '💎',
    colors: {
      background: '#FFF8DC', // Cornsilk
      gradientStart: '#FFD700', // Gold
      gradientEnd: '#FF8C00', // Dark Orange
      headerBg: '#8B4513', // Saddle Brown
      headerText: '#FFFFFF',
      boxBg: '#F5DEB3', // Wheat
      boxBorder: '#D2691E', // Chocolate
      scratchOverlay: '#C0C0C0', // Silver
      accent: '#FFD700'
    },
    prizes: { match3: 10, jackpot: 50 }
  },
  cash: {
    name: 'Cash Grab',
    emoji: '💰',
    titleDecor: '★',
    grid: { rows: 3, cols: 3 },
    price: 1000,
    symbols: ['💵', '💰', '🏦', '🎟', '🪙', '🧧', '💳', '🤑', '🏧', '💸', '🧾', '💎'],
    winSymbol: '🏦',
    jackpotSymbol: '💎',
    colors: {
      background: '#1a472a', // Dark green
      gradientStart: '#228B22', // Forest Green
      gradientEnd: '#006400', // Dark Green
      headerBg: '#FFD700', // Gold
      headerText: '#1a472a',
      footerText: '#FFFFFF', // White footer text
      boxBg: '#90EE90', // Light Green
      boxBorder: '#228B22',
      scratchOverlay: '#C0C0C0',
      accent: '#FFD700'
    },
    prizes: { match3: 15, jackpot: 75 }
  },
  stocks: {
    name: 'Stock Picks',
    emoji: '📈',
    titleDecor: '▲',
    grid: { rows: 3, cols: 4 },
    price: 2500,
    symbols: ['📈', '📉', '🐂', '🐻', '🚀', '📊', '💹', '🏛️', '💼', '📰', '🔔', '💵', '💰', '💻', '🏢', '📋', '✏️', '⚖️', '🧮', '💎'],
    winSymbol: '🚀',
    jackpotSymbol: '💎',
    colors: {
      background: '#0a1628', // Dark blue
      gradientStart: '#1e3a5f', // Navy
      gradientEnd: '#0d2137', // Darker navy
      headerBg: '#00CED1', // Dark Turquoise
      headerText: '#FFFFFF',
      boxBg: '#3a6080', // Lighter navy blue - easier to read icons
      boxBorder: '#00CED1',
      scratchOverlay: '#708090',
      accent: '#00FF7F' // Spring Green
    },
    prizes: { match3: 25, jackpot: 100 }
  },
  lucky7s: {
    name: 'Lucky 7s',
    emoji: '🎰',
    titleDecor: '♦',
    grid: { rows: 4, cols: 4 },
    price: 5000,
    symbols: ['🎰', '🍒', '🍋', '🔔','✈️','🏆','🍸','🏇','⚡', '⭐', '🍀', '🎲', '🃏', '👑', '💣', '♠️', '♦️', '♣️', '♥️', '🧧', '⚜️', '🚨', '💸', '🎁', '💎'],
    winSymbol: '🎰',
    jackpotSymbol: '💎',
    colors: {
      background: '#04aefc', 
      gradientStart: '#13008b', 
      gradientEnd: '#014dff', 
      headerBg: '#FFD700', 
      headerText: '#13008b',
      footerText: '#FFFFFF', 
      boxBg: '#f883f2', 
      boxBorder: '#FFD700',
      scratchOverlay: '#C0C0C0',
      accent: '#FFD700'
    },
    prizes: { match3: 35, match4: 100, jackpot: 250 }
  }
};

/**
 * Generate random symbols for a card
 * @param {string} cardType - The card type
 * @param {object} customSettings - Optional custom odds { jackpotOdds, winOdds } as percentages (0-100)
 */
function generateCardSymbols(cardType, customSettings = null) {
  const config = CARD_CONFIGS[cardType];
  const totalBoxes = config.grid.rows * config.grid.cols;
  const symbols = [];
  
  // Use custom settings or defaults - settings are in percentages (0-100), convert to decimal
  const jackpotChance = customSettings?.jackpotOdds != null ? customSettings.jackpotOdds / 100 : 0.01;
  const winChance = customSettings?.winOdds != null ? customSettings.winOdds / 100 : 0.14;
  
  for (let i = 0; i < totalBoxes; i++) {
    const rand = Math.random();
    let symbol;
    
    // Weighted random selection
    if (rand < jackpotChance) {
      symbol = config.jackpotSymbol;
    } else if (rand < jackpotChance + winChance) {
      symbol = config.winSymbol;
    } else {
      const otherSymbols = config.symbols.filter(s => s !== config.winSymbol && s !== config.jackpotSymbol);
      symbol = otherSymbols[Math.floor(Math.random() * otherSymbols.length)];
    }
    
    symbols.push(symbol);
  }
  
  return symbols;
}

/**
 * Draw rounded rectangle helper
 */
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw a metallic/shiny effect
 */
function drawMetallicGradient(ctx, x, y, width, height) {
  const gradient = ctx.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.1)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
  return gradient;
}

/**
 * Draw scratch overlay texture
 */
function drawScratchTexture(ctx, x, y, width, height, color) {
  // Base color
  ctx.fillStyle = color;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  
  // Add metallic sheen
  ctx.fillStyle = drawMetallicGradient(ctx, x, y, width, height);
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  
  // Add subtle noise/texture pattern
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  for (let i = 0; i < 20; i++) {
    const px = x + Math.random() * width;
    const py = y + Math.random() * height;
    ctx.fillRect(px, py, 2, 2);
  }
  
  // Question mark
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x + width/2, y + height/2);
}

/**
 * Draw decorative border
 */
function drawDecorativeBorder(ctx, width, height, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  
  // Outer border
  roundRect(ctx, 8, 8, width - 16, height - 16, 15);
  ctx.stroke();
  
  // Inner decorative line
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  roundRect(ctx, 15, 15, width - 30, height - 30, 12);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw sparkle/star effect
 */
function drawSparkle(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI / 2);
    const innerRadius = size * 0.3;
    const outerRadius = size;
    
    ctx.lineTo(
      x + Math.cos(angle) * outerRadius,
      y + Math.sin(angle) * outerRadius
    );
    ctx.lineTo(
      x + Math.cos(angle + Math.PI/4) * innerRadius,
      y + Math.sin(angle + Math.PI/4) * innerRadius
    );
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Generate a scratch card image
 * @param {string} cardType - 'cheese', 'cash', 'stocks', or 'lucky7s'
 * @param {Array} symbols - Array of symbols for each box (or null to generate)
 * @param {Array} scratched - Array of booleans indicating which boxes are scratched
 * @param {number} ticketNumber - Ticket ID number
 * @returns {Buffer} PNG image buffer
 */
function generateScratchCard(cardType, symbols = null, scratched = null, ticketNumber = 1) {
  const config = CARD_CONFIGS[cardType];
  if (!config) throw new Error(`Unknown card type: ${cardType}`);
  
  const { grid, colors, name, emoji, price } = config;
  const totalBoxes = grid.rows * grid.cols;
  
  // Generate symbols if not provided
  if (!symbols) {
    symbols = generateCardSymbols(cardType);
  }
  
  // Default all unscratched if not provided
  if (!scratched) {
    scratched = new Array(totalBoxes).fill(false);
  }
  
  // Calculate dimensions
  const boxSize = 65;
  const boxPadding = 12;
  const headerHeight = 80;
  const footerHeight = 70;
  const sidePadding = 30;
  
  const gridWidth = grid.cols * boxSize + (grid.cols - 1) * boxPadding;
  const gridHeight = grid.rows * boxSize + (grid.rows - 1) * boxPadding;
  
  const canvasWidth = gridWidth + sidePadding * 2;
  const canvasHeight = headerHeight + gridHeight + footerHeight + 40;
  
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  
  // Background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  bgGradient.addColorStop(0, colors.gradientStart);
  bgGradient.addColorStop(1, colors.gradientEnd);
  ctx.fillStyle = bgGradient;
  roundRect(ctx, 0, 0, canvasWidth, canvasHeight, 20);
  ctx.fill();
  
  // Decorative border
  drawDecorativeBorder(ctx, canvasWidth, canvasHeight, colors.accent);
  
  // Add corner sparkles
  drawSparkle(ctx, 25, 25, 8, colors.accent);
  drawSparkle(ctx, canvasWidth - 25, 25, 8, colors.accent);
  drawSparkle(ctx, 25, canvasHeight - 25, 8, colors.accent);
  drawSparkle(ctx, canvasWidth - 25, canvasHeight - 25, 8, colors.accent);
  
  // Header background with more padding
  const headerY = 25;
  const headerPadding = 25;
  ctx.fillStyle = colors.headerBg;
  roundRect(ctx, headerPadding, headerY, canvasWidth - (headerPadding * 2), headerHeight - 15, 10);
  ctx.fill();
  
  // Add subtle header shine
  const headerShine = ctx.createLinearGradient(headerPadding, headerY, headerPadding, headerY + 20);
  headerShine.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  headerShine.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = headerShine;
  roundRect(ctx, headerPadding, headerY, canvasWidth - (headerPadding * 2), 20, 10);
  ctx.fill();
  
  // Title decoration and text
  const titleDecor = config.titleDecor || '★';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw decorative elements on sides first
  const titleY = headerY + 22;
  ctx.fillStyle = colors.accent;
  ctx.font = 'bold 16px Arial';
  ctx.fillText(titleDecor, headerPadding + 22, titleY);
  ctx.fillText(titleDecor, canvasWidth - headerPadding - 22, titleY);
  
  // Main title text (smaller to fit between decorations)
  ctx.fillStyle = colors.headerText;
  ctx.font = 'bold 18px Arial';
  ctx.fillText(name.toUpperCase(), canvasWidth / 2, titleY);
  
  // Subtitle
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = colors.headerText;
  ctx.globalAlpha = 0.9;
  ctx.fillText('~ SCRATCH TO WIN! ~', canvasWidth / 2, headerY + 48);
  ctx.globalAlpha = 1;
  
  // Grid area background
  const gridStartX = sidePadding;
  const gridStartY = headerHeight + 15;
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  roundRect(ctx, gridStartX - 10, gridStartY - 10, gridWidth + 20, gridHeight + 20, 12);
  ctx.fill();
  
  // Draw boxes
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const index = row * grid.cols + col;
      const x = gridStartX + col * (boxSize + boxPadding);
      const y = gridStartY + row * (boxSize + boxPadding);
      
      // Box background
      ctx.fillStyle = colors.boxBg;
      roundRect(ctx, x, y, boxSize, boxSize, 8);
      ctx.fill();
      
      // Box border
      ctx.strokeStyle = colors.boxBorder;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, boxSize, boxSize, 8);
      ctx.stroke();
      
      if (scratched[index]) {
        // Show symbol - draw emoji larger and centered
        ctx.fillStyle = '#000000';
        ctx.font = '38px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbols[index], x + boxSize/2, y + boxSize/2 + 2);
      } else {
        // Draw scratch overlay
        drawScratchTexture(ctx, x + 3, y + 3, boxSize - 6, boxSize - 6, colors.scratchOverlay);
      }
    }
  }
  
  // Footer - cheese card needs extra offset due to smaller grid
  const footerOffset = (cardType === 'cheese') ? 5 : 0;
  const footerY = gridStartY + gridHeight + 10 + footerOffset;
  
  // Match info - use footerText color if available, otherwise headerText
  ctx.fillStyle = colors.footerText || colors.headerText;
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  
  // Line 1: Show which symbol wins cash
  let winLine = `Match 3 ${config.winSymbol} = WIN!`;
  if (cardType === 'lucky7s' || cardType === 'stocks') {
    winLine = `Match 3 ${config.winSymbol} = WIN! | Match 4 = MEGA WIN!`;
  }
  ctx.fillText(winLine, canvasWidth / 2, footerY + 5);
  
  // Line 2: Jackpot info
  ctx.font = '10px Arial';
  ctx.fillText(`Match 3 ${config.jackpotSymbol} = JACKPOT!`, canvasWidth / 2, footerY + 18);
  
  // Line 3: Free ticket info
  ctx.globalAlpha = 0.9;
  ctx.fillText(`Other 3 matches = Free Ticket`, canvasWidth / 2, footerY + 31);
  ctx.globalAlpha = 1;
  
  // Line 4: Ticket info
  ctx.globalAlpha = 0.7;
  ctx.fillText(`Ticket #${ticketNumber}`, canvasWidth / 2, footerY + 44);
  ctx.globalAlpha = 1;
  
  return canvas.toBuffer('image/png');
}

/**
 * Generate a fully scratched/revealed card
 */
function generateRevealedCard(cardType, symbols, ticketNumber = 1) {
  const config = CARD_CONFIGS[cardType];
  const totalBoxes = config.grid.rows * config.grid.cols;
  const allScratched = new Array(totalBoxes).fill(true);
  return generateScratchCard(cardType, symbols, allScratched, ticketNumber);
}

/**
 * Check for winning combinations (uses default config values)
 */
function checkWinnings(cardType, symbols) {
  const config = CARD_CONFIGS[cardType];
  return checkWinningsWithSettings(cardType, symbols, {
    price: config.price,
    match3: config.prizes.match3,
    match4: config.prizes.match4,
    jackpot: config.prizes.jackpot
  });
}

/**
 * Check for winning combinations with custom settings
 * @param {string} cardType - The card type
 * @param {Array} symbols - The symbols on the card
 * @param {object} settings - Custom settings { price, match3, match4, jackpot }
 */
function checkWinningsWithSettings(cardType, symbols, settings) {
  const config = CARD_CONFIGS[cardType];
  const { winSymbol, jackpotSymbol } = config;
  const { price, match3, match4, jackpot } = settings;
  
  // Count symbols
  const counts = {};
  symbols.forEach(s => {
    counts[s] = (counts[s] || 0) + 1;
  });
  
  let winnings = 0;
  let winType = null;
  
  // Check for jackpot (3+ jackpot symbols)
  if (counts[jackpotSymbol] >= 3) {
    if (counts[jackpotSymbol] >= 4 && match4) {
      winnings = price * jackpot * 2;
      winType = 'MEGA JACKPOT';
    } else {
      winnings = price * jackpot;
      winType = 'JACKPOT';
    }
  }
  // Check for match 4 of WIN SYMBOL ONLY (stocks/lucky7s)
  else if (match4 && counts[winSymbol] >= 4) {
    winnings = price * match4;
    winType = 'MEGA WIN';
  }
  // Check for match 3 of WIN SYMBOL ONLY
  else if (counts[winSymbol] >= 3) {
    winnings = price * match3;
    winType = 'WIN';
  }
  // Check for match 3+ of any OTHER symbol = FREE TICKET
  else {
    for (const [symbol, count] of Object.entries(counts)) {
      if (count >= 3 && symbol !== winSymbol && symbol !== jackpotSymbol) {
        winnings = 0; // Free ticket, no cash
        winType = 'FREE_TICKET';
        break;
      }
    }
  }
  
  return { winnings, winType, counts };
}

/**
 * Get card configuration
 */
function getCardConfig(cardType) {
  return CARD_CONFIGS[cardType];
}

/**
 * Get all card types
 */
function getCardTypes() {
  return Object.keys(CARD_CONFIGS);
}

module.exports = {
  generateScratchCard,
  generateRevealedCard,
  generateCardSymbols,
  checkWinnings,
  checkWinningsWithSettings,
  getCardConfig,
  getCardTypes,
  CARD_CONFIGS
};
