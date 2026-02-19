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

// Load image with caching and timeout
async function loadCardImage(url) {
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }
  
  try {
    // Add a timeout wrapper around loadImage
    const timeoutMs = 5000; // 5 second timeout
    const img = await Promise.race([
      loadImage(url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Image load timeout')), timeoutMs)
      )
    ]);
    imageCache.set(url, img);
    return img;
  } catch (error) {
    console.error('Error loading card image:', error.message);
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
  let failedImages = 0; // Track failed image loads
  
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
    } else {
      failedImages++;
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
    } else {
      failedImages++;
    }
  }
  
  // If any images failed to load, throw an error so the game can be refunded
  if (failedImages > 0) {
    throw new Error(`Failed to load ${failedImages} card image(s)`);
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

// Generate In Between game image showing pole cards and optional third card
async function generateInBetweenImage(pole1, pole2, thirdCard, playerName, isResolved = false) {
  const safePlayerName = sanitizeDisplayName(playerName);
  
  // Layout dimensions
  const cardWidth = 120;
  const cardHeight = 168;
  const spacing = 40;
  const questionMarkWidth = 80;
  
  // Calculate total width based on whether we have a third card
  const hasThird = thirdCard !== null;
  const totalWidth = hasThird 
    ? PADDING * 2 + cardWidth * 3 + spacing * 2 
    : PADDING * 2 + cardWidth * 2 + spacing + questionMarkWidth + spacing;
  
  const labelHeight = 35;
  const totalHeight = PADDING * 2 + labelHeight + cardHeight + 30;
  
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');
  
  // Dark background with rounded corners
  ctx.fillStyle = '#36393f';
  roundRect(ctx, 0, 0, totalWidth, totalHeight, 12);
  ctx.fill();
  
  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('IN BETWEEN', totalWidth / 2, PADDING + 20);
  
  // Card Y position
  const cardY = PADDING + labelHeight + 10;
  
  // Draw pole 1
  const pole1X = PADDING;
  const pole1Url = getCardImageUrl(pole1);
  const pole1Img = await loadCardImage(pole1Url);
  if (pole1Img) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    ctx.save();
    roundRect(ctx, pole1X, cardY, cardWidth, cardHeight, 6);
    ctx.clip();
    ctx.drawImage(pole1Img, pole1X, cardY, cardWidth, cardHeight);
    ctx.restore();
    ctx.shadowColor = 'transparent';
  }
  
  // Draw third card or question mark in center
  const centerX = pole1X + cardWidth + spacing;
  
  if (hasThird) {
    // Draw the revealed third card
    const thirdUrl = getCardImageUrl(thirdCard);
    const thirdImg = await loadCardImage(thirdUrl);
    if (thirdImg) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      
      // Highlight the third card
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      roundRect(ctx, centerX - 2, cardY - 2, cardWidth + 4, cardHeight + 4, 8);
      ctx.stroke();
      
      ctx.save();
      roundRect(ctx, centerX, cardY, cardWidth, cardHeight, 6);
      ctx.clip();
      ctx.drawImage(thirdImg, centerX, cardY, cardWidth, cardHeight);
      ctx.restore();
      ctx.shadowColor = 'transparent';
    }
  } else {
    // Draw question mark placeholder
    const qmX = centerX + (cardWidth - questionMarkWidth) / 2;
    ctx.fillStyle = '#2f3136';
    roundRect(ctx, qmX, cardY + 20, questionMarkWidth, cardHeight - 40, 8);
    ctx.fill();
    
    ctx.strokeStyle = '#5865f2';
    ctx.lineWidth = 2;
    roundRect(ctx, qmX, cardY + 20, questionMarkWidth, cardHeight - 40, 8);
    ctx.stroke();
    
    ctx.fillStyle = '#5865f2';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('?', qmX + questionMarkWidth / 2, cardY + cardHeight / 2 + 15);
  }
  
  // Draw pole 2
  const pole2X = hasThird ? centerX + cardWidth + spacing : centerX + questionMarkWidth + spacing;
  const pole2Url = getCardImageUrl(pole2);
  const pole2Img = await loadCardImage(pole2Url);
  if (pole2Img) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    ctx.save();
    roundRect(ctx, pole2X, cardY, cardWidth, cardHeight, 6);
    ctx.clip();
    ctx.drawImage(pole2Img, pole2X, cardY, cardWidth, cardHeight);
    ctx.restore();
    ctx.shadowColor = 'transparent';
  }
  
  // Player name at bottom
  ctx.fillStyle = '#99aab5';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(safePlayerName, totalWidth / 2, totalHeight - 10);
  
  return canvas.toBuffer('image/png');
}

// ==================== LET IT RIDE TABLE ====================

async function generateLetItRideImage(playerCards, communityCards, revealedCommunity, betAmount, bet1, bet2, bet3, playerName, result = null) {
  const safePlayerName = sanitizeDisplayName(playerName);
  
  // Table dimensions - larger for better visibility
  const TABLE_WIDTH = 950;
  const TABLE_HEIGHT = 950;
  
  // Much larger cards for better visibility
  const LIR_CARD_WIDTH = 180;
  const LIR_CARD_HEIGHT = 252;
  
  const canvas = createCanvas(TABLE_WIDTH, TABLE_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // Draw table background with green felt texture
  drawLetItRideFelt(ctx, TABLE_WIDTH, TABLE_HEIGHT);
  
  // Draw payout table on the left side
  drawPayoutTable(ctx, 20, 30);
  
  // Draw community cards area (top center)
  const communityY = 80;
  const communitySpacing = LIR_CARD_WIDTH + 40;
  const communityStartX = TABLE_WIDTH / 2 - communitySpacing / 2;
  
  // Label for community cards
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('COMMUNITY CARDS', TABLE_WIDTH / 2, communityY - 20);
  
  for (let i = 0; i < 2; i++) {
    const x = communityStartX + (i * communitySpacing) - LIR_CARD_WIDTH / 2;
    if (i < revealedCommunity) {
      // Show face-up card
      await drawCardScaled(ctx, communityCards[i], x, communityY, LIR_CARD_WIDTH, LIR_CARD_HEIGHT);
    } else {
      // Show face-down card
      await drawCardBackScaled(ctx, x, communityY, LIR_CARD_WIDTH, LIR_CARD_HEIGHT);
    }
  }
  
  // Draw player's 3 cards in the middle area
  const playerCardY = communityY + LIR_CARD_HEIGHT + 80;
  const playerCardSpacing = LIR_CARD_WIDTH + 25;
  const playerStartX = TABLE_WIDTH / 2 - playerCardSpacing;
  
  // Label for player cards
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('YOUR CARDS', TABLE_WIDTH / 2, playerCardY - 20);
  
  for (let i = 0; i < playerCards.length; i++) {
    const card = playerCards[i];
    const x = playerStartX + (i * playerCardSpacing) - LIR_CARD_WIDTH / 2;
    await drawCardScaled(ctx, card, x, playerCardY, LIR_CARD_WIDTH, LIR_CARD_HEIGHT);
  }
  
  // Draw betting circles - positioned halfway between player cards and original bottom position
  const playerCardsBottom = playerCardY + LIR_CARD_HEIGHT;
  const originalCircleY = TABLE_HEIGHT - 120;
  const circleY = playerCardsBottom + (originalCircleY - playerCardsBottom) / 2;
  const circleSpacing = 140;
  const startX = TABLE_WIDTH / 2 - circleSpacing;
  
  // Bet circle labels and positions (from left to right: $, 2, 1)
  const betCircles = [
    { x: startX, label: '$', active: bet3, betNum: 3 },           // Always required
    { x: startX + circleSpacing, label: '2', active: bet2, betNum: 2 },
    { x: startX + circleSpacing * 2, label: '1', active: bet1, betNum: 1 }
  ];
  
  for (const circle of betCircles) {
    drawBetCircle(ctx, circle.x, circleY, circle.label, circle.active, betAmount);
  }
  
  // Draw result if game is resolved
  if (result) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    roundRect(ctx, TABLE_WIDTH / 2 - 180, TABLE_HEIGHT / 2 - 35, 360, 70, 12);
    ctx.fill();
    
    ctx.fillStyle = result.payout > 0 ? '#4CAF50' : '#F44336';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(result.rank, TABLE_WIDTH / 2, TABLE_HEIGHT / 2 + 10);
  }
  
  // Player name at bottom
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '32px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(safePlayerName, TABLE_WIDTH / 2, TABLE_HEIGHT - 20);
  
  return canvas.toBuffer('image/png');
}

function drawLetItRideFelt(ctx, width, height) {
  // Base green felt
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, '#1B5E20');  // Lighter center
  gradient.addColorStop(0.7, '#145214'); // Medium
  gradient.addColorStop(1, '#0D3B0D');   // Darker edges
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add subtle texture pattern
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let i = 0; i < height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(width, i);
    ctx.stroke();
  }
  
  // Table border/rail
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  
  ctx.strokeStyle = '#5D4037';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, width - 16, height - 16);
}

function drawPayoutTable(ctx, x, y) {
  const payouts = [
    ['Royal Flush', '1000 to 1'],
    ['Straight Flush', '200 to 1'],
    ['Four of a Kind', '50 to 1'],
    ['Full House', '11 to 1'],
    ['Flush', '8 to 1'],
    ['Straight', '5 to 1'],
    ['Three of a Kind', '3 to 1'],
    ['Two Pair', '2 to 1'],
    ['10s or Better', '1 to 1']
  ];
  
  // Background panel (40% larger: 170->238, row height 22->31, padding 30->42)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(x, y, 238, payouts.length * 31 + 42);
  
  // Title (40% larger font: 14->20)
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('PAYOUT TABLE', x + 119, y + 26);
  
  // Payouts (40% larger font: 12->17)
  ctx.font = '20px Arial';
  ctx.textAlign = 'left';
  
  for (let i = 0; i < payouts.length; i++) {
    const [hand, payout] = payouts[i];
    const rowY = y + 54 + (i * 31);
    
    ctx.fillStyle = '#FFD700';
    ctx.fillText(hand, x + 11, rowY);
    
    ctx.textAlign = 'right';
    ctx.fillText(payout, x + 227, rowY);
    ctx.textAlign = 'left';
  }
}

function drawBetCircle(ctx, x, y, label, isActive, betAmount) {
  const radius = 50;
  
  // Outer circle border
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = isActive ? '#FFD700' : '#666666';
  ctx.lineWidth = 4;
  ctx.stroke();
  
  // Inner fill based on active state
  if (isActive) {
    ctx.fillStyle = 'rgba(30, 60, 30, 0.8)';
  } else {
    ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
  }
  ctx.fill();
  
  if (isActive && betAmount > 0) {
    // Draw flat top-down chip stack inside the circle
    drawFlatChipStack(ctx, x, y, betAmount, radius - 10);
  } else {
    // Empty circle with label when bet is pulled
    ctx.fillStyle = '#666666';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.textBaseline = 'alphabetic';
    
    // Show "PULLED" text below circle
    ctx.fillStyle = '#FF5252';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('PULLED', x, y + radius + 22);
  }
  
  // Circle label below (when active)
  if (isActive) {
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('BET ' + label, x, y + radius + 22);
    
    // Amount below label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(betAmount.toLocaleString(), x, y + radius + 44);
  }
}

function drawFlatChipStack(ctx, x, y, amount, maxRadius) {
  // Determine chip breakdown
  const chips = getChipBreakdown(amount);
  
  // Draw chips from top-down view, stacked with slight offset for 3D effect
  const baseRadius = Math.min(maxRadius, 38);
  const offsetStep = 2; // Slight offset for each chip layer
  
  // Calculate total chips to display (max 8 for visual clarity)
  let totalChips = 0;
  for (const chip of chips) {
    totalChips += Math.min(chip.count, 3);
  }
  totalChips = Math.min(totalChips, 8);
  
  // Draw chips from bottom of stack to top
  let chipIndex = 0;
  const chipsToRender = [];
  
  // Collect chips to render (reversed so highest value on top)
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i];
    for (let j = 0; j < Math.min(chip.count, 3) && chipsToRender.length < 8; j++) {
      chipsToRender.push(chip);
    }
  }
  
  // Draw from bottom to top
  for (let i = 0; i < chipsToRender.length; i++) {
    const chip = chipsToRender[i];
    const offsetY = (chipsToRender.length - 1 - i) * offsetStep;
    drawFlatChip(ctx, x, y + offsetY, baseRadius, chip.color, chip.edgeColor, chip.value);
  }
}

function getChipBreakdown(amount) {
  const chipValues = [
    { value: 100000, color: '#E040FB', edgeColor: '#AA00FF' },  // Purple/Magenta - 100k
    { value: 25000, color: '#FFD700', edgeColor: '#FFA000' },   // Gold - 25k
    { value: 5000, color: '#E91E63', edgeColor: '#C2185B' },    // Pink - 5k
    { value: 1000, color: '#FF9800', edgeColor: '#F57C00' },    // Orange - 1k
    { value: 500, color: '#9C27B0', edgeColor: '#7B1FA2' },     // Purple - 500
    { value: 100, color: '#212121', edgeColor: '#000000' },     // Black - 100
    { value: 25, color: '#4CAF50', edgeColor: '#388E3C' },      // Green - 25
    { value: 5, color: '#F44336', edgeColor: '#D32F2F' },       // Red - 5
    { value: 1, color: '#FFFFFF', edgeColor: '#BDBDBD' }        // White - 1
  ];
  
  const chips = [];
  let remaining = amount;
  
  for (const chipType of chipValues) {
    if (remaining >= chipType.value) {
      const count = Math.floor(remaining / chipType.value);
      chips.push({ ...chipType, count });
      remaining -= count * chipType.value;
    }
  }
  
  return chips;
}

function drawFlatChip(ctx, x, y, radius, color, edgeColor, value) {
  // Outer edge/shadow for depth
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = edgeColor;
  ctx.fill();
  
  // Main chip face (circular, top-down view)
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  // Edge pattern - alternating colored segments around the rim
  const segmentColor = color === '#FFFFFF' ? '#BDBDBD' : '#FFFFFF';
  const numSegments = 8;
  const innerRadius = radius * 0.82;
  const outerRadius = radius * 0.98;
  
  for (let i = 0; i < numSegments; i++) {
    const startAngle = (i / numSegments) * Math.PI * 2 - Math.PI / 2;
    const endAngle = startAngle + (Math.PI / numSegments) * 0.7;
    
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, startAngle, endAngle);
    ctx.arc(x, y, innerRadius, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = segmentColor;
    ctx.fill();
  }
  
  // Inner decorative ring
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = segmentColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Center circle with value indicator
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = edgeColor;
  ctx.fill();
  
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  // Value text in center (abbreviated)
  const valueText = value >= 1000 ? Math.floor(value / 1000) + 'K' : value.toString();
  ctx.fillStyle = color === '#FFFFFF' ? '#333333' : '#FFFFFF';
  ctx.font = `bold ${radius * 0.35}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(valueText, x, y);
  ctx.textBaseline = 'alphabetic';
}

async function drawCard(ctx, card, x, y) {
  try {
    const cardImage = await getCardImage(card);
    ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);
  } catch (err) {
    // Fallback: draw a simple card representation
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CARD_WIDTH, CARD_HEIGHT);
    
    const suitSymbols = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
    const suitColors = { 'S': '#000000', 'H': '#FF0000', 'D': '#FF0000', 'C': '#000000' };
    
    ctx.fillStyle = suitColors[card.suit];
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${card.rank}${suitSymbols[card.suit]}`, x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2);
  }
}

async function drawCardScaled(ctx, card, x, y, width, height) {
  try {
    const cardImage = await getCardImage(card);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    ctx.save();
    roundRect(ctx, x, y, width, height, 6);
    ctx.clip();
    ctx.drawImage(cardImage, x, y, width, height);
    ctx.restore();
    
    ctx.shadowColor = 'transparent';
  } catch (err) {
    // Fallback: draw a simple card representation
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, x, y, width, height, 6);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, width, height, 6);
    ctx.stroke();
    
    const suitSymbols = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
    const suitColors = { 'S': '#000000', 'H': '#FF0000', 'D': '#FF0000', 'C': '#000000' };
    
    ctx.fillStyle = suitColors[card.suit];
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${card.rank}${suitSymbols[card.suit]}`, x + width / 2, y + height / 2 + 5);
  }
}

async function drawCardBack(ctx, x, y) {
  // Draw card back design
  ctx.fillStyle = '#1565C0';
  ctx.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
  
  // Border
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 5, y + 5, CARD_WIDTH - 10, CARD_HEIGHT - 10);
  
  // Pattern
  ctx.fillStyle = '#1976D2';
  const patternSize = 15;
  for (let px = x + 10; px < x + CARD_WIDTH - 10; px += patternSize) {
    for (let py = y + 10; py < y + CARD_HEIGHT - 10; py += patternSize) {
      if ((Math.floor((px - x) / patternSize) + Math.floor((py - y) / patternSize)) % 2 === 0) {
        ctx.fillRect(px, py, patternSize - 2, patternSize - 2);
      }
    }
  }
  
  // Center diamond
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 - 20);
  ctx.lineTo(x + CARD_WIDTH / 2 + 15, y + CARD_HEIGHT / 2);
  ctx.lineTo(x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 + 20);
  ctx.lineTo(x + CARD_WIDTH / 2 - 15, y + CARD_HEIGHT / 2);
  ctx.closePath();
  ctx.fill();
}

async function drawCardBackScaled(ctx, x, y, width, height) {
  // Draw card back design with shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  
  ctx.fillStyle = '#1565C0';
  roundRect(ctx, x, y, width, height, 6);
  ctx.fill();
  
  ctx.shadowColor = 'transparent';
  
  // Border
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 4, y + 4, width - 8, height - 8, 4);
  ctx.stroke();
  
  // Pattern
  ctx.fillStyle = '#1976D2';
  const patternSize = Math.min(12, width / 8);
  for (let px = x + 8; px < x + width - 8; px += patternSize) {
    for (let py = y + 8; py < y + height - 8; py += patternSize) {
      if ((Math.floor((px - x) / patternSize) + Math.floor((py - y) / patternSize)) % 2 === 0) {
        ctx.fillRect(px, py, patternSize - 2, patternSize - 2);
      }
    }
  }
  
  // Center diamond
  const diamondSize = Math.min(12, width / 8);
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y + height / 2 - diamondSize);
  ctx.lineTo(x + width / 2 + diamondSize, y + height / 2);
  ctx.lineTo(x + width / 2, y + height / 2 + diamondSize);
  ctx.lineTo(x + width / 2 - diamondSize, y + height / 2);
  ctx.closePath();
  ctx.fill();
}

async function getCardImage(card) {
  const key = `${card.rank}${card.suit}`;
  
  if (imageCache.has(key)) {
    return imageCache.get(key);
  }
  
  // Try to load from API
  const suitMap = { 'S': 'S', 'H': 'H', 'D': 'D', 'C': 'C' };
  const rankMap = { 
    'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5', 
    '6': '6', '7': '7', '8': '8', '9': '9', '10': '0', 
    'J': 'J', 'Q': 'Q', 'K': 'K' 
  };
  
  const code = rankMap[card.rank] + suitMap[card.suit];
  const url = `https://deckofcardsapi.com/static/img/${code}.png`;
  
  try {
    const image = await loadImage(url);
    imageCache.set(key, image);
    return image;
  } catch (err) {
    throw new Error(`Failed to load card image: ${key}`);
  }
}

// ==================== THREE CARD POKER TABLE ====================

async function generateThreeCardPokerImage(playerCards, dealerCards, revealDealer, anteBet, pairPlusBet, sixCardBet, anteResolved, playBet, playerName, result = null) {
  const safePlayerName = sanitizeDisplayName(playerName);
  
  // Table dimensions
  const TABLE_WIDTH = 900;
  const TABLE_HEIGHT = 800;
  
  // Card dimensions
  const TCP_CARD_WIDTH = 160;
  const TCP_CARD_HEIGHT = 224;
  
  const canvas = createCanvas(TABLE_WIDTH, TABLE_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // Draw table background with green felt
  drawThreeCardPokerFelt(ctx, TABLE_WIDTH, TABLE_HEIGHT);
  
  // Draw payout tables on sides
  drawTCPPayoutTable(ctx, 15, 30, 'PAIR PLUS', [
    ['Straight Flush', '40:1'],
    ['Three of a Kind', '30:1'],
    ['Straight', '6:1'],
    ['Flush', '4:1'],
    ['Pair', '1:1']
  ]);
  
  drawTCPPayoutTable(ctx, TABLE_WIDTH - 215, 30, '6-CARD BONUS', [
    ['Royal Flush', '1000:1'],
    ['Straight Flush', '200:1'],
    ['Four of a Kind', '50:1'],
    ['Full House', '25:1'],
    ['Flush', '20:1'],
    ['Straight', '10:1'],
    ['Three of a Kind', '5:1']
  ]);
  
  // Draw dealer area (top center)
  const dealerY = 80;
  const cardSpacing = TCP_CARD_WIDTH + 20;
  const dealerStartX = TABLE_WIDTH / 2 - cardSpacing;
  
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('DEALER', TABLE_WIDTH / 2, dealerY - 15);
  
  // Dealer qualifying text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '14px Arial';
  ctx.fillText('Dealer qualifies with Queen-high or better', TABLE_WIDTH / 2, dealerY + TCP_CARD_HEIGHT + 25);
  
  // Draw dealer cards
  for (let i = 0; i < 3; i++) {
    const x = dealerStartX + (i * cardSpacing) - TCP_CARD_WIDTH / 2;
    if (revealDealer) {
      await drawCardScaled(ctx, dealerCards[i], x, dealerY, TCP_CARD_WIDTH, TCP_CARD_HEIGHT);
    } else {
      await drawCardBackScaled(ctx, x, dealerY, TCP_CARD_WIDTH, TCP_CARD_HEIGHT);
    }
  }
  
  // Draw player area (middle)
  const playerCardY = dealerY + TCP_CARD_HEIGHT + 80;
  const playerStartX = TABLE_WIDTH / 2 - cardSpacing;
  
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('YOUR HAND', TABLE_WIDTH / 2, playerCardY - 15);
  
  // Draw player cards
  for (let i = 0; i < playerCards.length; i++) {
    const x = playerStartX + (i * cardSpacing) - TCP_CARD_WIDTH / 2;
    await drawCardScaled(ctx, playerCards[i], x, playerCardY, TCP_CARD_WIDTH, TCP_CARD_HEIGHT);
  }
  
  // Draw betting circles at bottom
  const circleY = TABLE_HEIGHT - 120;
  const circleSpacing = 160;
  const startX = TABLE_WIDTH / 2 - circleSpacing * 1.5;
  
  // Bet circles (left to right: 6-Card, Pair Plus, Ante, Play)
  const betCircles = [
    { x: startX, label: '6-CARD', amount: sixCardBet, active: sixCardBet > 0 },
    { x: startX + circleSpacing, label: 'PAIR+', amount: pairPlusBet, active: pairPlusBet > 0 },
    { x: startX + circleSpacing * 2, label: 'ANTE', amount: anteBet, active: true },
    { x: startX + circleSpacing * 3, label: 'PLAY', amount: playBet ? anteBet : 0, active: playBet }
  ];
  
  for (const circle of betCircles) {
    drawTCPBetCircle(ctx, circle.x, circleY, circle.label, circle.active, circle.amount);
  }
  
  // Draw result overlay if resolved
  if (result) {
    const resultText = result.totalResult > 0 ? `+${result.totalResult.toLocaleString()}` : 
                       result.totalResult < 0 ? result.totalResult.toLocaleString() : 'PUSH';
    const resultColor = result.totalResult > 0 ? '#4CAF50' : result.totalResult < 0 ? '#F44336' : '#FFC107';
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    roundRect(ctx, TABLE_WIDTH / 2 - 150, TABLE_HEIGHT / 2 - 30, 300, 60, 12);
    ctx.fill();
    
    ctx.fillStyle = resultColor;
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(resultText, TABLE_WIDTH / 2, TABLE_HEIGHT / 2 + 12);
  }
  
  // Player name at bottom
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '18px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(safePlayerName, TABLE_WIDTH / 2, TABLE_HEIGHT - 15);
  
  return canvas.toBuffer('image/png');
}

function drawThreeCardPokerFelt(ctx, width, height) {
  // Base green felt
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, '#1B5E20');
  gradient.addColorStop(0.7, '#145214');
  gradient.addColorStop(1, '#0D3B0D');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Subtle texture
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let i = 0; i < height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(width, i);
    ctx.stroke();
  }
  
  // Table border
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  
  ctx.strokeStyle = '#5D4037';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, width - 16, height - 16);
}

function drawTCPPayoutTable(ctx, x, y, title, payouts) {
  const width = 200;
  const rowHeight = 55; // Two lines per payout entry
  const height = payouts.length * rowHeight + 50;
  
  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  roundRect(ctx, x, y, width, height, 10);
  ctx.fill();
  
  // Title
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(title, x + width / 2, y + 30);
  
  // Payouts - two lines each (hand name, then payout)
  for (let i = 0; i < payouts.length; i++) {
    const [hand, payout] = payouts[i];
    const rowY = y + 55 + (i * rowHeight);
    
    // Hand name (white, centered)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(hand, x + width / 2, rowY);
    
    // Payout ratio (gold, centered, below hand name)
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(payout, x + width / 2, rowY + 26);
  }
}

function drawTCPBetCircle(ctx, x, y, label, isActive, amount) {
  const radius = 45;
  
  // Outer circle
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = isActive ? '#FFD700' : '#666666';
  ctx.lineWidth = 4;
  ctx.stroke();
  
  // Inner fill
  ctx.fillStyle = isActive ? 'rgba(30, 60, 30, 0.8)' : 'rgba(40, 40, 40, 0.8)';
  ctx.fill();
  
  if (isActive && amount > 0) {
    // Draw chips
    drawFlatChipStack(ctx, x, y, amount, radius - 8);
  }
  
  // Label below circle
  ctx.fillStyle = isActive ? '#FFD700' : '#666666';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + radius + 18);
  
  // Amount below label
  if (amount > 0) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(amount.toLocaleString(), x, y + radius + 34);
  }
}

// Generate Screw Your Neighbor reveal image - all players' cards in a row
async function generateSYNRevealImage(players) {
  // players = [{ name, card: { rank, suit }, isLoser }, ...]
  const numPlayers = players.length;
  if (numPlayers === 0) return null;

  const cardWidth = CARD_WIDTH;
  const cardHeight = CARD_HEIGHT;
  const sectionWidth = cardWidth + 40; // card + padding per player
  const nameHeight = 50;
  const statusHeight = 30;
  const topPadding = 20;
  const bottomPadding = 15;

  const totalWidth = Math.max(sectionWidth * numPlayers + 20, 300);
  const totalHeight = topPadding + cardHeight + nameHeight + statusHeight + bottomPadding;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#36393f';
  roundRect(ctx, 0, 0, totalWidth, totalHeight, 10);
  ctx.fill();

  for (let i = 0; i < numPlayers; i++) {
    const p = players[i];
    const centerX = 10 + i * sectionWidth + sectionWidth / 2;
    const cardX = centerX - cardWidth / 2;
    const cardY = topPadding;

    // Draw card
    if (p.card) {
      const url = getCardImageUrl(p.card);
      const img = await loadCardImage(url);
      if (img) {
        // Glow effect for losers
        if (p.isLoser) {
          ctx.shadowColor = 'rgba(231, 76, 60, 0.7)';
          ctx.shadowBlur = 12;
        } else {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
          ctx.shadowBlur = 4;
        }
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        ctx.save();
        roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 4);
        ctx.clip();
        ctx.drawImage(img, cardX, cardY, cardWidth, cardHeight);
        ctx.restore();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Red border for losers
        if (p.isLoser) {
          ctx.strokeStyle = '#e74c3c';
          ctx.lineWidth = 3;
          roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 4);
          ctx.stroke();
        }
      }
    }

    // Player name below card
    const safeName = sanitizeDisplayName(p.name);
    const displayName = safeName.length > 12 ? safeName.substring(0, 11) + '…' : safeName;
    ctx.fillStyle = p.isLoser ? '#e74c3c' : '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(displayName, centerX, cardY + cardHeight + 22);

    // Status below name
    ctx.font = '14px Arial';
    ctx.fillStyle = p.isLoser ? '#e74c3c' : '#2ecc71';
    ctx.fillText(p.isLoser ? '💀 LOWEST' : '✅ Safe', centerX, cardY + cardHeight + 44);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateHandImage,
  generateBlackjackImage,
  generateBlackjackTableImage,
  generateInBetweenImage,
  generateLetItRideImage,
  generateThreeCardPokerImage,
  generateSYNRevealImage,
  CARD_WIDTH,
  CARD_HEIGHT
};

