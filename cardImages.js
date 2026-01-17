// Card image generator for blackjack
// Creates composite card images similar to UnbelievaBoat style

const { createCanvas, loadImage } = require('canvas');
const path = require('path');

// Card dimensions (larger for better mobile visibility)
const CARD_WIDTH = 140; // Increased significantly from 113
const CARD_HEIGHT = 195; // Increased significantly from 158
const CARD_SPACING = 18; // Increased proportionally
const PADDING = 15;

// Cache for loaded card images
const imageCache = new Map();

// Sanitize display names - convert fancy Unicode to ASCII and remove emojis
function sanitizeDisplayName(name) {
  if (!name) return 'Unknown';
  
  // First, use NFKD normalization to decompose fancy characters
  let result = name.normalize('NFKD');
  
  // Remove combining diacritical marks (accents etc)
  result = result.replace(/[\u0300-\u036f]/g, '');
  
  // Remove emojis and other pictographic characters
  result = result.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
  result = result.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
  result = result.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
  result = result.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags
  result = result.replace(/[\u{2600}-\u{26FF}]/gu, '');   // Misc symbols
  result = result.replace(/[\u{2700}-\u{27BF}]/gu, '');   // Dingbats
  result = result.replace(/[\u{FE00}-\u{FE0F}]/gu, '');   // Variation Selectors
  result = result.replace(/[\u{1F900}-\u{1F9FF}]/gu, ''); // Supplemental Symbols
  result = result.replace(/[\u{1FA00}-\u{1FA6F}]/gu, ''); // Chess Symbols
  result = result.replace(/[\u{1FA70}-\u{1FAFF}]/gu, ''); // Symbols Extended-A
  result = result.replace(/[\u{231A}-\u{231B}]/gu, '');   // Watch, Hourglass
  result = result.replace(/[\u{23E9}-\u{23F3}]/gu, '');   // Various symbols
  result = result.replace(/[\u{23F8}-\u{23FA}]/gu, '');   // Various symbols
  result = result.replace(/[\u{25AA}-\u{25AB}]/gu, '');   // Squares
  result = result.replace(/[\u{25B6}]/gu, '');            // Play button
  result = result.replace(/[\u{25C0}]/gu, '');            // Reverse button
  result = result.replace(/[\u{25FB}-\u{25FE}]/gu, '');   // Squares
  result = result.replace(/[\u{200D}]/gu, '');            // Zero width joiner
  
  // Keep only printable ASCII and common extended chars that Arial can render
  let filtered = '';
  for (const char of result) {
    const code = char.charCodeAt(0);
    // Keep ASCII printable characters (space through tilde)
    // and some extended Latin characters
    if ((code >= 32 && code <= 126) || (code >= 192 && code <= 255)) {
      filtered += char;
    }
  }
  
  // Clean up multiple spaces
  filtered = filtered.replace(/\s+/g, ' ').trim();
  
  // Return the filtered name or original if nothing left
  return filtered || name.substring(0, 20) || 'Player';
}

// Get card image URL from deckofcardsapi.com
function getCardImageUrl(card) {
  const suitCodes = { '\u2660': 'S', '\u2665': 'H', '\u2666': 'D', '\u2663': 'C' };
  const suitCode = suitCodes[card.suit];
  if (!suitCode) {
    console.error('Unknown suit:', card.suit, 'Card:', JSON.stringify(card));
    return null;
  }
  let rankCode = card.rank;
  if (card.rank === '10') rankCode = '0';
  return `https://deckofcardsapi.com/static/img/${rankCode}${suitCode}.png`;
}

// Get back of card image URL
function getCardBackUrl() {
  return 'https://deckofcardsapi.com/static/img/back.png';
}

// Load image with caching
async function loadCardImage(url) {
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }
  
  try {
    const img = await loadImage(url);
    imageCache.set(url, img);
    return img;
  } catch (error) {
    console.error('Error loading card image:', error);
    return null;
  }
}

// Generate a composite image of multiple cards with smart overlapping
async function generateHandImage(hand, hideSecond = false) {
  const numCards = hand.length;
  
  // Smart spacing - overlap more when there are many cards
  let cardSpacing;
  if (numCards <= 2) {
    cardSpacing = CARD_WIDTH * 0.15; // Small overlap for few cards
  } else if (numCards <= 4) {
    cardSpacing = CARD_WIDTH * 0.35; // More overlap for medium hands
  } else {
    cardSpacing = CARD_WIDTH * 0.45; // Heavy overlap for big hands
  }
  
  const totalWidth = PADDING * 2 + CARD_WIDTH + (numCards - 1) * cardSpacing;
  const totalHeight = PADDING * 2 + CARD_HEIGHT;
  
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');
  
  // Draw dark background with rounded corners
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, 0, 0, totalWidth, totalHeight, 8);
  ctx.fill();
  
  // Draw each card with smart spacing
  for (let i = 0; i < numCards; i++) {
    const x = PADDING + i * cardSpacing;
    const y = PADDING;
    
    let url;
    if (hideSecond && i === 1) {
      url = getCardBackUrl();
    } else {
      url = getCardImageUrl(hand[i]);
    }
    
    const img = await loadCardImage(url);
    if (img) {
      // Draw card with slight shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      // Draw rounded card
      ctx.save();
      roundRect(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, 4);
      ctx.clip();
      ctx.drawImage(img, x, y, CARD_WIDTH, CARD_HEIGHT);
      ctx.restore();
      
      // Reset shadow
      ctx.shadowColor = 'transparent';
    }
  }
  
  return canvas.toBuffer('image/png');
}

// Generate a combined image showing both hands (dealer on top, player on bottom)
async function generateBlackjackImage(playerHand, dealerHand, hideDealer = false) {
  // Calculate dimensions with larger cards and smart spacing
  const playerCards = playerHand.length;
  const dealerCards = dealerHand.length;
  
  // Use smart spacing like in multiplayer
  const getCardSpacing = (numCards) => {
    if (numCards <= 2) return CARD_WIDTH * 0.15;
    if (numCards <= 4) return CARD_WIDTH * 0.35;
    return CARD_WIDTH * 0.45;
  };
  
  const dealerSpacing = getCardSpacing(dealerCards);
  const playerSpacing = getCardSpacing(playerCards);
  
  const dealerWidth = CARD_WIDTH + (dealerCards - 1) * dealerSpacing;
  const playerWidth = CARD_WIDTH + (playerCards - 1) * playerSpacing;
  const maxWidth = Math.max(dealerWidth, playerWidth);
  
  const labelHeight = 28; // Space for labels above each hand
  const rowHeight = labelHeight + CARD_HEIGHT + PADDING;
  const dividerHeight = 10;
  const totalWidth = Math.max(maxWidth + PADDING * 2, 400); // Increased minimum width
  const totalHeight = PADDING + rowHeight * 2 + dividerHeight;
  
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');
  
  // Dark background
  ctx.fillStyle = '#36393f';
  roundRect(ctx, 0, 0, totalWidth, totalHeight, 10);
  ctx.fill();
  
  // Draw dealer section background (top)
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, 5, 5, totalWidth - 10, rowHeight - 5, 8);
  ctx.fill();
  
  // Draw player section background (bottom)
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, 5, rowHeight + dividerHeight, totalWidth - 10, rowHeight - 5, 8);
  ctx.fill();
  
  // Draw dealer label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'left';
  const dealerValue = hideDealer ? '?' : calculateHandValue(dealerHand);
  ctx.fillText(`Dealer: ${dealerValue}`, PADDING, PADDING + 20);
  
  // Draw dealer cards (top row) with smart spacing
  const dealerStartX = (totalWidth - dealerWidth) / 2;
  for (let i = 0; i < dealerCards; i++) {
    const x = dealerStartX + i * dealerSpacing;
    const y = PADDING + labelHeight;
    
    let url;
    if (hideDealer && i === 1) {
      url = getCardBackUrl();
    } else {
      url = getCardImageUrl(dealerHand[i]);
    }
    
    const img = await loadCardImage(url);
    if (img) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      ctx.save();
      roundRect(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, 6);
      ctx.clip();
      ctx.drawImage(img, x, y, CARD_WIDTH, CARD_HEIGHT);
      ctx.restore();
      
      ctx.shadowColor = 'transparent';
    }
  }
  
  // Draw divider line
  ctx.strokeStyle = '#7289da';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, rowHeight + dividerHeight / 2);
  ctx.lineTo(totalWidth - PADDING, rowHeight + dividerHeight / 2);
  ctx.stroke();
  
  // Draw player label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'left';
  const playerValue = calculateHandValue(playerHand);
  ctx.fillText(`You: ${playerValue}`, PADDING, rowHeight + dividerHeight + PADDING + 20);
  
  // Draw player cards (bottom row) with smart spacing
  const playerStartX = (totalWidth - playerWidth) / 2;
  for (let i = 0; i < playerCards; i++) {
    const x = playerStartX + i * playerSpacing;
    const y = rowHeight + dividerHeight + PADDING + labelHeight;
    
    const img = await loadCardImage(getCardImageUrl(playerHand[i]));
    if (img) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      ctx.save();
      roundRect(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, 6);
      ctx.clip();
      ctx.drawImage(img, x, y, CARD_WIDTH, CARD_HEIGHT);
      ctx.restore();
      
      ctx.shadowColor = 'transparent';
    }
  }
  
  return canvas.toBuffer('image/png');
}

// Helper function to draw rounded rectangles
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

// Calculate hand value (needed for labels)
function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (['J', 'Q', 'K'].includes(card.rank)) {
      value += 10;
    } else if (card.rank === 'A') {
      value += 11;
      aces++;
    } else {
      value += parseInt(card.rank);
    }
  }
  
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

// Generate multiplayer blackjack table image (similar style to single-player)
async function generateBlackjackTableImage(game) {
  const playersArray = Array.from(game.players.values());
  const numPlayers = playersArray.length;
  
  // Use same card size as single player for better visibility
  const mpCardWidth = CARD_WIDTH;
  const mpCardHeight = CARD_HEIGHT;
  
  // Layout dimensions
  const sectionPadding = 20;
  const labelHeight = 35;
  const cardRowHeight = mpCardHeight + 30;
  const sectionHeight = labelHeight + cardRowHeight + sectionPadding;
  const dividerHeight = 10;
  
  // Calculate width needed for cards (handle many cards with overlap)
  const getCardSpacing = (numCards) => {
    if (numCards <= 2) return mpCardWidth * 0.15;
    if (numCards <= 4) return mpCardWidth * 0.35;
    return mpCardWidth * 0.45;
  };
  
  // Find the widest hand
  let maxCardsInHand = Math.max(2, game.dealer.hand.length + (game.dealer.holeCard ? 1 : 0));
  for (const player of playersArray) {
    maxCardsInHand = Math.max(maxCardsInHand, player.hand.length);
  }
  const maxHandWidth = mpCardWidth + (maxCardsInHand - 1) * getCardSpacing(maxCardsInHand);
  
  const totalWidth = Math.max(maxHandWidth + sectionPadding * 4 + 250, 600);
  const totalHeight = sectionPadding * 2 + sectionHeight + (Math.max(numPlayers, 1) * (sectionHeight + dividerHeight));
  
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');
  
  // Dark background (same as single player)
  ctx.fillStyle = '#36393f';
  roundRect(ctx, 0, 0, totalWidth, totalHeight, 10);
  ctx.fill();
  
  if (numPlayers === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Empty Table', totalWidth / 2, totalHeight / 2 - 20);
    ctx.font = '18px Arial';
    ctx.fillText('Use /blackjack-table join [bet] to join', totalWidth / 2, totalHeight / 2 + 20);
    return canvas.toBuffer('image/png');
  }
  
  let currentY = sectionPadding;
  
  // === DEALER SECTION ===
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, 5, currentY, totalWidth - 10, sectionHeight, 8);
  ctx.fill();
  
  // Dealer label and value
  const dealerHand = [...game.dealer.hand];
  if (game.dealer.holeCard && game.status !== 'dealer_turn' && game.status !== 'finished') {
    dealerHand.unshift({ suit: '?', rank: '?' }); // Hidden card
  } else if (game.dealer.holeCard) {
    dealerHand.unshift(game.dealer.holeCard);
  }
  
  const dealerValue = (game.status === 'dealer_turn' || game.status === 'finished')
    ? calculateHandValue(game.dealer.hand.concat(game.dealer.holeCard || []))
    : calculateHandValue(game.dealer.hand);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('DEALER', sectionPadding + 10, currentY + 32);
  
  ctx.fillStyle = '#b9bbbe';
  ctx.font = '28px Arial';
  ctx.fillText('Value: ' + (dealerValue === 0 ? '?' : dealerValue), sectionPadding + 10, currentY + 65);
  
  // Draw dealer cards (right side)
  if (dealerHand.length > 0) {
    const dealerSpacing = getCardSpacing(dealerHand.length);
    const dealerWidth = mpCardWidth + (dealerHand.length - 1) * dealerSpacing;
    const dealerStartX = totalWidth - dealerWidth - sectionPadding - 30;
    
    for (let i = 0; i < dealerHand.length; i++) {
      const x = dealerStartX + i * dealerSpacing;
      const y = currentY + labelHeight + 10;
      
      let url;
      if (dealerHand[i].rank === '?' || dealerHand[i].suit === '?') {
        url = getCardBackUrl();
      } else {
        url = getCardImageUrl(dealerHand[i]);
      }
      
      const img = await loadCardImage(url);
      if (img) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        ctx.save();
        roundRect(ctx, x, y, mpCardWidth, mpCardHeight, 6);
        ctx.clip();
        ctx.drawImage(img, x, y, mpCardWidth, mpCardHeight);
        ctx.restore();
        
        ctx.shadowColor = 'transparent';
      }
    }
  }
  
  currentY += sectionHeight;

  // === PLAYER SECTIONS ===
  for (let i = 0; i < numPlayers; i++) {
    const player = playersArray[i];
    
    // Divider line
    ctx.strokeStyle = '#7289da';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sectionPadding, currentY + dividerHeight / 2);
    ctx.lineTo(totalWidth - sectionPadding, currentY + dividerHeight / 2);
    ctx.stroke();
    
    currentY += dividerHeight;
    
    // Player section background
    let bgColor = '#2f3136';
    if (game.currentPlayer === player.id) {
      bgColor = '#3d4a3d'; // Slightly green for current player
    }
    
    ctx.fillStyle = bgColor;
    roundRect(ctx, 5, currentY, totalWidth - 10, sectionHeight, 8);
    ctx.fill();
    
    // Current player indicator border
    if (game.currentPlayer === player.id) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      roundRect(ctx, 5, currentY, totalWidth - 10, sectionHeight, 8);
      ctx.stroke();
    }
    
    // Player name (sanitized for canvas rendering)
    ctx.fillStyle = game.currentPlayer === player.id ? '#ffd700' : '#ffffff';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(sanitizeDisplayName(player.displayName), sectionPadding + 10, currentY + 30);
    
    // Bet and hand value
    ctx.fillStyle = '#b9bbbe';
    ctx.font = '26px Arial';
    ctx.fillText('Bet: ' + player.bet.toLocaleString(), sectionPadding + 10, currentY + 60);
    
    if (player.hand.length > 0) {
      const handValue = calculateHandValue(player.hand);
      ctx.fillText('Value: ' + handValue, sectionPadding + 10, currentY + 90);
    }
    
    // Status
    let statusText = '';
    let statusColor = '#ffffff';
    
    if (player.status === 'blackjack') {
      statusText = 'BLACKJACK!';
      statusColor = '#ffd700';
    } else if (player.status === 'bust') {
      statusText = 'BUST';
      statusColor = '#ed4245';
    } else if (player.status === 'stand') {
      statusText = 'STAND';
      statusColor = '#57f287';
    } else if (player.status === 'playing' && game.currentPlayer === player.id) {
      statusText = 'YOUR TURN';
      statusColor = '#5865f2';
    } else if (player.status === 'waiting') {
      statusText = 'WAITING';
      statusColor = '#99aab5';
    }
    
    if (statusText) {
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 26px Arial';
      ctx.fillText(statusText, sectionPadding + 10, currentY + 120);
    }
    
    // Draw player cards (right side)
    if (player.hand.length > 0) {
      const playerSpacing = getCardSpacing(player.hand.length);
      const playerWidth = mpCardWidth + (player.hand.length - 1) * playerSpacing;
      const playerStartX = totalWidth - playerWidth - sectionPadding - 30;
      
      for (let j = 0; j < player.hand.length; j++) {
        const x = playerStartX + j * playerSpacing;
        const y = currentY + labelHeight + 10;
        
        const url = getCardImageUrl(player.hand[j]);
        const img = await loadCardImage(url);
        if (img) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = 5;
          ctx.shadowOffsetX = 3;
          ctx.shadowOffsetY = 3;
          
          ctx.save();
          roundRect(ctx, x, y, mpCardWidth, mpCardHeight, 6);
          ctx.clip();
          ctx.drawImage(img, x, y, mpCardWidth, mpCardHeight);
          ctx.restore();
          
          ctx.shadowColor = 'transparent';
        }
      }
    }
    
    currentY += sectionHeight;
  }
  
  // Waiting overlay
  if (game.status === 'waiting') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, totalWidth, totalHeight);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('WAITING FOR PLAYERS', totalWidth / 2, totalHeight / 2 - 30);
    
    ctx.font = '20px Arial';
    ctx.fillText(numPlayers + '/4 players at table', totalWidth / 2, totalHeight / 2 + 10);
    
    if (numPlayers >= 2) {
      ctx.fillStyle = '#57f287';
      ctx.fillText('Ready to start!', totalWidth / 2, totalHeight / 2 + 45);
    } else {
      ctx.fillText('Need ' + (2 - numPlayers) + ' more player(s)', totalWidth / 2, totalHeight / 2 + 45);
    }
  }
  
  return canvas.toBuffer('image/png');
}

module.exports = {
  generateHandImage,
  generateBlackjackImage,
  generateBlackjackTableImage,
  CARD_WIDTH,
  CARD_HEIGHT
};
