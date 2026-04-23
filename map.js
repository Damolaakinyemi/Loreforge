/**
 * map.js — Loreforge Illustrated Map Engine
 *
 * Renders a living parchment-style fantasy map where:
 *  - Each region has a unique organic landmass shape
 *  - Terrain icons (mountains, forests, ruins, ports, deserts) drawn in SVG
 *  - Settlements visually grow with Nova simulation power level
 *    (hamlet → village → town → city → capital)
 *  - Trade routes appear between allied/stable regions
 *  - Nova events trigger visual effects (fire, storm, golden glow)
 *  - Compass rose, decorative border, illustrated legend
 *  - Fully clickable — regions open detail modals
 */

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (text !== undefined) el.textContent = text;
  return el;
};

// ─── PARCHMENT COLORS ────────────────────────────────────────
const PARCHMENT = {
  paper:       '#e8d5a3',
  paperDark:   '#d4b87a',
  paperLight:  '#f2e4bc',
  ink:         '#3d2b0e',
  inkFaint:    '#6b4c1e',
  inkGhost:    '#a07840',
  sea:         '#7ba7bc',
  seaLight:    '#9fc3d4',
  seaDark:     '#5a8299',
  seaDeep:     '#3d6677',
  highlight:   '#c9a84c',
};

// ─── TERRAIN TYPE → VISUAL PROFILE ──────────────────────────
const TERRAIN_PROFILES = {
  // keyword → { landColor, icons, label }
  forest:    { land:'#8a7a52', shade:'#6b5e38', icons:['tree','tree','tree'], label:'forest' },
  mountain:  { land:'#9a8870', shade:'#7a6a52', icons:['mountain','mountain'], label:'mountains' },
  desert:    { land:'#c4a86a', shade:'#a88c50', icons:['dune','dune','cactus'], label:'desert' },
  tundra:    { land:'#9aaa9a', shade:'#7a8a7a', icons:['snowpeak','snowpeak'], label:'tundra' },
  swamp:     { land:'#6a7a52', shade:'#4a5a32', icons:['swamp','swamp'], label:'swamp' },
  coast:     { land:'#a09070', shade:'#806a50', icons:['port','anchor'], label:'coast' },
  plains:    { land:'#a09860', shade:'#807848', icons:['windmill','farm'], label:'plains' },
  ruins:     { land:'#8a7868', shade:'#6a5848', icons:['ruin','ruin','skull'], label:'ruins' },
  volcanic:  { land:'#7a5040', shade:'#5a3020', icons:['volcano','ash'], label:'volcanic' },
  island:    { land:'#9a8860', shade:'#7a6840', icons:['palm','anchor'], label:'islands' },
  default:   { land:'#9a8c6a', shade:'#7a6c4a', icons:['hill','hill'], label:'lands' },
};

function getTerrainProfile(typeStr) {
  if (!typeStr) return TERRAIN_PROFILES.default;
  const t = typeStr.toLowerCase();
  for (const [key, profile] of Object.entries(TERRAIN_PROFILES)) {
    if (t.includes(key)) return profile;
  }
  return TERRAIN_PROFILES.default;
}

// ─── SEEDED PSEUDO-RANDOM (deterministic per region) ────────
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ─── ORGANIC LANDMASS SHAPE ──────────────────────────────────
/**
 * Generates a bumpy organic polygon for a landmass.
 * Uses seeded random so the shape is consistent across re-renders.
 */
function makeLandmassPath(cx, cy, radius, regionName, roughness = 0.38) {
  const rand   = seededRand(hashStr(regionName));
  const points = 14 + Math.floor(rand() * 6); // 14–19 vertices
  const pts    = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
    const r     = radius * (0.72 + rand() * roughness);
    pts.push([
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
    ]);
  }

  // Smooth with cubic bezier control points
  const d = pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const cp1x = p[0] + (next[0] - prev[0]) * 0.18;
    const cp1y = p[1] + (next[1] - prev[1]) * 0.18;
    return `${i === 0 ? 'M' : 'S'} ${cp1x},${cp1y} ${p[0]},${p[1]}`;
  }).join(' ') + ' Z';

  return d;
}

// ─── SETTLEMENT TIER RENDERER ────────────────────────────────
/**
 * Draws a settlement symbol scaled to power level.
 * power 0–20: hamlet (single hut)
 * power 21–40: village (3 huts)
 * power 41–60: town (walls + buildings)
 * power 61–80: city (tower + walls)
 * power 81–100: capital (castle)
 */
function drawSettlement(g, cx, cy, power, regionName, ink) {
  const tier = power <= 20 ? 0 : power <= 40 ? 1 : power <= 60 ? 2 : power <= 80 ? 3 : 4;
  const s    = ink || PARCHMENT.ink;
  const sw   = 0.8;

  if (tier === 0) {
    // Hamlet: single small house
    drawHut(g, cx, cy, 5, s, sw);

  } else if (tier === 1) {
    // Village: 3 huts
    drawHut(g, cx - 7, cy, 4.5, s, sw);
    drawHut(g, cx,     cy, 5,   s, sw);
    drawHut(g, cx + 7, cy, 4.5, s, sw);

  } else if (tier === 2) {
    // Town: wall arc + buildings
    g.appendChild(mk('path', { d:`M ${cx-14} ${cy+2} Q ${cx} ${cy-4} ${cx+14} ${cy+2}`, fill:'none', stroke:s, 'stroke-width':sw }));
    drawHut(g, cx - 7, cy - 1, 5, s, sw);
    drawHut(g, cx,     cy - 3, 6, s, sw);
    drawHut(g, cx + 7, cy - 1, 5, s, sw);
    // Wall towers
    g.appendChild(mk('rect', { x:cx-16, y:cy-3, width:4, height:7, fill:'none', stroke:s, 'stroke-width':sw }));
    g.appendChild(mk('rect', { x:cx+12, y:cy-3, width:4, height:7, fill:'none', stroke:s, 'stroke-width':sw }));

  } else if (tier === 3) {
    // City: tower + walled complex
    drawTower(g, cx, cy - 10, 5, 14, s, sw);
    g.appendChild(mk('path', { d:`M ${cx-18} ${cy+2} Q ${cx} ${cy-6} ${cx+18} ${cy+2}`, fill:'none', stroke:s, 'stroke-width':sw }));
    drawHut(g, cx - 9, cy - 2, 5, s, sw);
    drawHut(g, cx + 9, cy - 2, 5, s, sw);
    g.appendChild(mk('rect', { x:cx-20, y:cy-4, width:4, height:8, fill:'none', stroke:s, 'stroke-width':sw }));
    g.appendChild(mk('rect', { x:cx+16, y:cy-4, width:4, height:8, fill:'none', stroke:s, 'stroke-width':sw }));

  } else {
    // Capital: full castle
    drawCastle(g, cx, cy, s, sw);
  }
}

function drawHut(g, cx, cy, size, s, sw) {
  g.appendChild(mk('rect', { x:cx-size*0.7, y:cy-size*0.6, width:size*1.4, height:size*0.8, fill:'none', stroke:s, 'stroke-width':sw }));
  g.appendChild(mk('path', { d:`M ${cx-size} ${cy-size*0.5} L ${cx} ${cy-size*1.3} L ${cx+size} ${cy-size*0.5}`, fill:'none', stroke:s, 'stroke-width':sw }));
}

function drawTower(g, cx, cy, w, h, s, sw) {
  g.appendChild(mk('rect', { x:cx-w, y:cy-h, width:w*2, height:h, fill:'none', stroke:s, 'stroke-width':sw }));
  // Battlements
  for (let i = -1; i <= 1; i++) {
    g.appendChild(mk('rect', { x:cx+i*w*0.6-2, y:cy-h-4, width:4, height:4, fill:'none', stroke:s, 'stroke-width':sw }));
  }
}

function drawCastle(g, cx, cy, s, sw) {
  // Main keep
  drawTower(g, cx, cy - 8, 7, 16, s, sw);
  // Flanking towers
  drawTower(g, cx - 14, cy - 4, 5, 12, s, sw);
  drawTower(g, cx + 14, cy - 4, 5, 12, s, sw);
  // Walls
  g.appendChild(mk('line', { x1:cx-9, y1:cy+8, x2:cx-9, y2:cy-2, stroke:s, 'stroke-width':sw }));
  g.appendChild(mk('line', { x1:cx+9, y1:cy+8, x2:cx+9, y2:cy-2, stroke:s, 'stroke-width':sw }));
  g.appendChild(mk('line', { x1:cx-9, y1:cy+8, x2:cx+9, y2:cy+8, stroke:s, 'stroke-width':sw }));
  // Gate
  g.appendChild(mk('path', { d:`M ${cx-4} ${cy+8} L ${cx-4} ${cy+2} Q ${cx} ${cy-1} ${cx+4} ${cy+2} L ${cx+4} ${cy+8}`, fill:'none', stroke:s, 'stroke-width':sw }));
}

// ─── TERRAIN ICONS ────────────────────────────────────────────
function drawTerrainIcon(g, type, x, y, scale, ink) {
  const s = ink || PARCHMENT.ink;
  scale   = scale || 1;
  const sw = 0.7;

  switch (type) {
    case 'mountain':
      g.appendChild(mk('path', { d:`M ${x} ${y-14*scale} L ${x-11*scale} ${y+2*scale} L ${x+11*scale} ${y+2*scale} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x-1*scale} ${y-14*scale} L ${x+4*scale} ${y-6*scale}`, stroke:s, 'stroke-width':sw*0.6, fill:'none' }));
      break;
    case 'snowpeak':
      g.appendChild(mk('path', { d:`M ${x} ${y-14*scale} L ${x-10*scale} ${y+2*scale} L ${x+10*scale} ${y+2*scale} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x-3*scale} ${y-10*scale} L ${x} ${y-14*scale} L ${x+3*scale} ${y-10*scale}`, fill:s, 'fill-opacity':0.3, stroke:s, 'stroke-width':sw*0.5 }));
      break;
    case 'tree':
      g.appendChild(mk('line', { x1:x, y1:y, x2:x, y2:y-12*scale, stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-18*scale} L ${x-6*scale} ${y-8*scale} L ${x+6*scale} ${y-8*scale} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-24*scale} L ${x-4*scale} ${y-14*scale} L ${x+4*scale} ${y-14*scale} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'palm':
      g.appendChild(mk('path', { d:`M ${x} ${y} Q ${x+4*scale} ${y-8*scale} ${x} ${y-16*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-16*scale} Q ${x-10*scale} ${y-20*scale} ${x-8*scale} ${y-12*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-16*scale} Q ${x+10*scale} ${y-20*scale} ${x+8*scale} ${y-12*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-16*scale} Q ${x-6*scale} ${y-24*scale} ${x-2*scale} ${y-13*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'port':
    case 'anchor':
      g.appendChild(mk('circle', { cx:x, cy:y-10*scale, r:3*scale, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('line', { x1:x, y1:y-7*scale, x2:x, y2:y+2*scale, stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x-6*scale} ${y-2*scale} Q ${x} ${y+6*scale} ${x+6*scale} ${y-2*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('line', { x1:x-4*scale, y1:y-10*scale, x2:x+4*scale, y2:y-10*scale, stroke:s, 'stroke-width':sw }));
      break;
    case 'ruin':
      g.appendChild(mk('rect', { x:x-5*scale, y:y-12*scale, width:4*scale, height:14*scale, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('rect', { x:x+1*scale, y:y-8*scale, width:4*scale, height:10*scale, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('line', { x1:x-8*scale, y1:y+2*scale, x2:x+8*scale, y2:y+2*scale, stroke:s, 'stroke-width':sw*0.7 }));
      break;
    case 'skull':
      g.appendChild(mk('circle', { cx:x, cy:y-8*scale, r:5*scale, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x-3*scale} ${y-4*scale} L ${x-3*scale} ${y+2*scale} L ${x+3*scale} ${y+2*scale} L ${x+3*scale} ${y-4*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'volcano':
      g.appendChild(mk('path', { d:`M ${x} ${y-16*scale} L ${x-12*scale} ${y+4*scale} L ${x+12*scale} ${y+4*scale} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x-2*scale} ${y-16*scale} Q ${x-5*scale} ${y-22*scale} ${x} ${y-20*scale} Q ${x+5*scale} ${y-22*scale} ${x+2*scale} ${y-16*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'dune':
      g.appendChild(mk('path', { d:`M ${x-10*scale} ${y} Q ${x} ${y-10*scale} ${x+10*scale} ${y}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'windmill':
      g.appendChild(mk('line', { x1:x, y1:y, x2:x, y2:y-12*scale, stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('line', { x1:x-8*scale, y1:y-10*scale, x2:x+8*scale, y2:y-14*scale, stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('line', { x1:x-8*scale, y1:y-14*scale, x2:x+8*scale, y2:y-10*scale, stroke:s, 'stroke-width':sw }));
      break;
    case 'farm':
      g.appendChild(mk('rect', { x:x-6*scale, y:y-6*scale, width:12*scale, height:8*scale, fill:'none', stroke:s, 'stroke-width':sw*0.7 }));
      for (let i = -4; i <= 4; i += 4) {
        g.appendChild(mk('line', { x1:x+i*scale, y1:y-6*scale, x2:x+i*scale, y2:y+2*scale, stroke:s, 'stroke-width':sw*0.5 }));
      }
      break;
    case 'swamp':
      g.appendChild(mk('path', { d:`M ${x-8*scale} ${y} Q ${x-4*scale} ${y-8*scale} ${x} ${y} Q ${x+4*scale} ${y-8*scale} ${x+8*scale} ${y}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'ash':
      for (let i = -6; i <= 6; i += 6) {
        g.appendChild(mk('line', { x1:x+i*scale, y1:y, x2:x+i*scale+2*scale, y2:y-8*scale, stroke:s, 'stroke-width':sw*0.6 }));
      }
      break;
    case 'cactus':
      g.appendChild(mk('line', { x1:x, y1:y, x2:x, y2:y-14*scale, stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-8*scale} L ${x-5*scale} ${y-8*scale} L ${x-5*scale} ${y-5*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      g.appendChild(mk('path', { d:`M ${x} ${y-10*scale} L ${x+5*scale} ${y-10*scale} L ${x+5*scale} ${y-7*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
    case 'hill':
      g.appendChild(mk('path', { d:`M ${x-10*scale} ${y+2*scale} Q ${x} ${y-8*scale} ${x+10*scale} ${y+2*scale}`, fill:'none', stroke:s, 'stroke-width':sw }));
      break;
  }
}

// ─── TRADE ROUTE ─────────────────────────────────────────────
function drawTradeRoute(svg, r1, r2, strength) {
  // Dashed curved line between two regions — opacity scales with alliance strength
  const opacity = 0.15 + strength * 0.35;
  const mx = (r1.x + r2.x) / 2 + (Math.random() * 20 - 10);
  const my = (r1.y + r2.y) / 2 - 15;
  const path = mk('path', {
    d: `M ${r1.x} ${r1.y} Q ${mx} ${my} ${r2.x} ${r2.y}`,
    fill: 'none',
    stroke: PARCHMENT.inkGhost,
    'stroke-width': 1,
    'stroke-dasharray': '5 4',
    'stroke-opacity': opacity,
  });
  svg.appendChild(path);

  // Small ship icon at midpoint if strong alliance
  if (strength > 0.6) {
    drawShipIcon(svg, mx, my);
  }
}

function drawShipIcon(svg, x, y) {
  const g  = mk('g');
  const s  = PARCHMENT.inkGhost;
  const sw = 0.7;
  g.appendChild(mk('path', { d:`M ${x-8} ${y+3} Q ${x} ${y+7} ${x+8} ${y+3}`, fill:'none', stroke:s, 'stroke-width':sw }));
  g.appendChild(mk('line', { x1:x, y1:y+3, x2:x, y2:y-8, stroke:s, 'stroke-width':sw }));
  g.appendChild(mk('path', { d:`M ${x} ${y-8} L ${x+7} ${y-2} L ${x} ${y+2} Z`, fill:'none', stroke:s, 'stroke-width':sw }));
  svg.appendChild(g);
}

// ─── NOVA EVENT VISUAL EFFECTS ────────────────────────────────
function drawEventEffect(g, cx, cy, radius, eventType) {
  switch (eventType) {
    case 'conflict':
      // Crossed swords overlay
      drawSwords(g, cx, cy);
      break;
    case 'disaster':
      // Flame glow ring
      drawFlameRing(g, cx, cy, radius);
      break;
    case 'golden':
      // Radiating lines (golden age)
      drawGoldenRays(g, cx, cy, radius);
      break;
    case 'alliance':
      // Handshake dots
      g.appendChild(mk('circle', { cx:cx-10, cy:cy, r:3, fill:'none', stroke:PARCHMENT.inkGhost, 'stroke-width':0.8 }));
      g.appendChild(mk('circle', { cx:cx+10, cy:cy, r:3, fill:'none', stroke:PARCHMENT.inkGhost, 'stroke-width':0.8 }));
      g.appendChild(mk('line', { x1:cx-7, y1:cy, x2:cx+7, y2:cy, stroke:PARCHMENT.inkGhost, 'stroke-width':0.8 }));
      break;
  }
}

function drawSwords(g, cx, cy) {
  const s = '#8a3020';
  g.appendChild(mk('line', { x1:cx-8, y1:cy-8, x2:cx+8, y2:cy+8, stroke:s, 'stroke-width':1.2 }));
  g.appendChild(mk('line', { x1:cx+8, y1:cy-8, x2:cx-8, y2:cy+8, stroke:s, 'stroke-width':1.2 }));
  g.appendChild(mk('line', { x1:cx-6, y1:cy-2, x2:cx-2, y2:cy-6, stroke:s, 'stroke-width':2 }));
  g.appendChild(mk('line', { x1:cx+2, y1:cy+6, x2:cx+6, y2:cy+2, stroke:s, 'stroke-width':2 }));
}

function drawFlameRing(g, cx, cy, r) {
  const flames = 6;
  for (let i = 0; i < flames; i++) {
    const angle = (i / flames) * Math.PI * 2;
    const fx    = cx + Math.cos(angle) * r;
    const fy    = cy + Math.sin(angle) * r;
    g.appendChild(mk('path', {
      d: `M ${fx} ${fy} Q ${fx+3} ${fy-8} ${fx} ${fy-14} Q ${fx-3} ${fy-8} ${fx} ${fy}`,
      fill: '#c04020', 'fill-opacity': 0.35, stroke: 'none',
    }));
  }
}

function drawGoldenRays(g, cx, cy, r) {
  const rays = 8;
  for (let i = 0; i < rays; i++) {
    const angle = (i / rays) * Math.PI * 2;
    g.appendChild(mk('line', {
      x1: cx + Math.cos(angle) * (r + 5),
      y1: cy + Math.sin(angle) * (r + 5),
      x2: cx + Math.cos(angle) * (r + 18),
      y2: cy + Math.sin(angle) * (r + 18),
      stroke: '#c9a84c', 'stroke-opacity': 0.5, 'stroke-width': 1.2,
    }));
  }
}

// ─── COMPASS ROSE ─────────────────────────────────────────────
function drawCompassRose(svg, cx, cy, size) {
  const g  = mk('g');
  const s  = PARCHMENT.ink;
  const sw = 0.8;
  const r  = size;

  // Cardinal points
  const dirs = [
    [0, -r, 'N'], [r, 0, 'E'], [0, r, 'S'], [-r, 0, 'W'],
  ];
  dirs.forEach(([dx, dy, label]) => {
    // Arrow
    g.appendChild(mk('path', {
      d: `M ${cx} ${cy} L ${cx + dx * 0.35} ${cy + dy * 0.35 - 3} L ${cx + dx} ${cy + dy} L ${cx + dx * 0.35} ${cy + dy * 0.35 + 3} Z`,
      fill: label === 'N' ? s : PARCHMENT.inkGhost, stroke: s, 'stroke-width': sw * 0.5,
    }));
    // Label
    g.appendChild(mk('text', {
      x: cx + dx * 1.35, y: cy + dy * 1.35 + 4,
      'text-anchor': 'middle', 'font-family': 'Cinzel,serif',
      'font-size': size * 0.28, fill: s, 'font-weight': '600',
    }, label));
  });

  // Ordinal points (smaller)
  const ordinals = [
    [-r * 0.65, -r * 0.65], [r * 0.65, -r * 0.65],
    [r * 0.65, r * 0.65],  [-r * 0.65, r * 0.65],
  ];
  ordinals.forEach(([dx, dy]) => {
    g.appendChild(mk('path', {
      d: `M ${cx} ${cy} L ${cx + dx * 0.3} ${cy + dy * 0.3 - 2} L ${cx + dx} ${cy + dy} L ${cx + dx * 0.3} ${cy + dy * 0.3 + 2} Z`,
      fill: PARCHMENT.inkFaint, stroke: s, 'stroke-width': sw * 0.4,
    }));
  });

  // Centre circle
  g.appendChild(mk('circle', { cx, cy, r: size * 0.12, fill: PARCHMENT.paper, stroke: s, 'stroke-width': sw }));
  g.appendChild(mk('circle', { cx, cy, r: size * 0.05, fill: s }));

  // Outer ring
  g.appendChild(mk('circle', { cx, cy, r: r * 1.15, fill: 'none', stroke: s, 'stroke-width': sw * 0.5, 'stroke-dasharray': '2 3' }));

  svg.appendChild(g);
}

// ─── DECORATIVE BORDER ────────────────────────────────────────
function drawBorder(svg, w, h) {
  const s  = PARCHMENT.ink;
  const sw = 0.8;

  // Outer frame
  svg.appendChild(mk('rect', { x:4, y:4, width:w-8, height:h-8, fill:'none', stroke:s, 'stroke-width':1.5 }));
  // Inner frame
  svg.appendChild(mk('rect', { x:10, y:10, width:w-20, height:h-20, fill:'none', stroke:s, 'stroke-width':sw, 'stroke-dasharray':'4 3' }));

  // Corner ornaments
  const corners = [[14,14],[w-14,14],[14,h-14],[w-14,h-14]];
  corners.forEach(([cx, cy]) => {
    svg.appendChild(mk('circle', { cx, cy, r:4, fill:'none', stroke:s, 'stroke-width':sw }));
    svg.appendChild(mk('circle', { cx, cy, r:1.5, fill:s }));
    // Cross marks
    svg.appendChild(mk('line', { x1:cx-8, y1:cy, x2:cx+8, y2:cy, stroke:s, 'stroke-width':sw*0.6 }));
    svg.appendChild(mk('line', { x1:cx, y1:cy-8, x2:cx, y2:cy+8, stroke:s, 'stroke-width':sw*0.6 }));
  });

  // Mid-edge ornaments
  const mids = [[w/2,8],[w/2,h-8],[8,h/2],[w-8,h/2]];
  mids.forEach(([cx, cy]) => {
    svg.appendChild(mk('path', { d:`M ${cx-6} ${cy} L ${cx} ${cy-5} L ${cx+6} ${cy} L ${cx} ${cy+5} Z`, fill:'none', stroke:s, 'stroke-width':sw*0.7 }));
  });
}

// ─── LEGEND ──────────────────────────────────────────────────
function drawLegend(svg, x, y, novaYear) {
  const g  = mk('g');
  const s  = PARCHMENT.ink;
  const bg = PARCHMENT.paperLight;

  // Background scroll shape
  g.appendChild(mk('rect', { x, y, width:110, height:95, rx:4, fill:bg, stroke:s, 'stroke-width':0.8, 'fill-opacity':0.9 }));
  g.appendChild(mk('line', { x1:x+6, y1:y+8, x2:x+104, y2:y+8, stroke:s, 'stroke-width':0.5 }));

  g.appendChild(mk('text', { x:x+55, y:y+6, 'text-anchor':'middle', 'font-family':'Cinzel,serif', 'font-size':7, fill:s, 'font-weight':'600' }, 'LEGEND'));

  // Settlement tiers
  const tiers = [
    { label:'Hamlet',  power:10 },
    { label:'Village', power:30 },
    { label:'Town',    power:55 },
    { label:'City',    power:72 },
    { label:'Capital', power:95 },
  ];

  tiers.forEach((t, i) => {
    const lx = x + 18;
    const ly = y + 20 + i * 14;
    const sg = mk('g');
    drawSettlement(sg, lx, ly, t.power, t.label, s);
    g.appendChild(sg);
    g.appendChild(mk('text', { x:lx+16, y:ly+4, 'font-family':'Crimson Pro,serif', 'font-size':8, fill:s }, t.label));
  });

  // Year
  if (novaYear > 0) {
    g.appendChild(mk('line', { x1:x+6, y1:y+87, x2:x+104, y2:y+87, stroke:s, 'stroke-width':0.5 }));
    g.appendChild(mk('text', { x:x+55, y:y+94, 'text-anchor':'middle', 'font-family':'Cinzel,serif', 'font-size':6.5, fill:s }, `Year ${novaYear}`));
  }

  svg.appendChild(g);
}

// ─── TITLE SCROLL ─────────────────────────────────────────────
function drawTitleScroll(svg, worldName, genre, cx, y) {
  const g = mk('g');
  const s = PARCHMENT.ink;

  // Scroll ribbon
  const w = Math.min(300, worldName.length * 12 + 60);
  g.appendChild(mk('path', {
    d: `M ${cx-w/2} ${y-2} Q ${cx-w/2-8} ${y+9} ${cx-w/2} ${y+20} L ${cx+w/2} ${y+20} Q ${cx+w/2+8} ${y+9} ${cx+w/2} ${y-2} Z`,
    fill: PARCHMENT.paperDark, stroke: s, 'stroke-width': 0.9, 'fill-opacity': 0.92,
  }));
  // Scroll curl tabs
  g.appendChild(mk('path', { d:`M ${cx-w/2-8} ${y+9} Q ${cx-w/2-14} ${y+5} ${cx-w/2-8} ${y+1}`, fill:'none', stroke:s, 'stroke-width':0.7 }));
  g.appendChild(mk('path', { d:`M ${cx+w/2+8} ${y+9} Q ${cx+w/2+14} ${y+5} ${cx+w/2+8} ${y+1}`, fill:'none', stroke:s, 'stroke-width':0.7 }));

  g.appendChild(mk('text', {
    x:cx, y:y+12, 'text-anchor':'middle', 'font-family':'Cinzel,serif',
    'font-size':12, fill:s, 'font-weight':'700', 'letter-spacing':'2',
  }, worldName.toUpperCase()));
  g.appendChild(mk('text', {
    x:cx, y:y+21, 'text-anchor':'middle', 'font-family':'Crimson Pro,serif',
    'font-size':7, fill:PARCHMENT.inkFaint, 'font-style':'italic',
  }, genre));

  svg.appendChild(g);
}

// ─── SEA WAVES & ATMOSPHERE ───────────────────────────────────
function drawSeaAtmosphere(svg, w, h, regions) {
  // Scattered wave marks across the sea areas
  const waveCount = 28;
  const rand = seededRand(12345);
  for (let i = 0; i < waveCount; i++) {
    const wx = 30 + rand() * (w - 60);
    const wy = 30 + rand() * (h - 60);

    // Skip if too close to any region center
    const tooClose = regions.some(r =>
      Math.hypot(wx - r.x, wy - r.y) < (parseFloat(r.radius) || 65) + 30
    );
    if (tooClose) continue;

    const ww = 10 + rand() * 12;
    svg.appendChild(mk('path', {
      d: `M ${wx} ${wy} Q ${wx + ww/2} ${wy - 3} ${wx + ww} ${wy}`,
      fill: 'none', stroke: PARCHMENT.seaDark, 'stroke-width': 0.5, 'stroke-opacity': 0.4,
    }));
  }

  // Sea creature hint (decorative)
  const cr = seededRand(99999);
  const creatureX = 30 + cr() * (w - 100);
  const creatureY = 30 + cr() * (h - 60);
  const tooClose = regions.some(r => Math.hypot(creatureX - r.x, creatureY - r.y) < 80);
  if (!tooClose) {
    drawSeaCreature(svg, creatureX, creatureY);
  }
}

function drawSeaCreature(svg, x, y) {
  const s = PARCHMENT.seaDark;
  // Simple sea serpent silhouette
  svg.appendChild(mk('path', {
    d: `M ${x} ${y} Q ${x+12} ${y-10} ${x+24} ${y} Q ${x+36} ${y+10} ${x+48} ${y} Q ${x+60} ${y-8} ${x+66} ${y-4}`,
    fill: 'none', stroke: s, 'stroke-width': 1.2, 'stroke-opacity': 0.35,
  }));
  svg.appendChild(mk('circle', { cx:x, cy:y, r:4, fill:'none', stroke:s, 'stroke-width':0.8, 'stroke-opacity':0.35 }));
}

// ─── MAIN RENDER FUNCTION ─────────────────────────────────────
/**
 * Full illustrated map render.
 * @param {string} svgId     - ID of the SVG element to render into
 * @param {object} world     - The world data object
 * @param {object} novaState - Nova simulation state { year, regionState, events }
 * @param {function} onRegionClick - Called with regionName when clicked
 */
export function renderIllustratedMap(svgId, world, novaState, onRegionClick) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';

  const vw = 900;
  const vh = 580;
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

  // ── Background: parchment texture ──────────────────────────
  const defs = document.createElementNS(NS, 'defs');

  // Parchment gradient
  defs.innerHTML = `
    <linearGradient id="parchGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PARCHMENT.paperLight}"/>
      <stop offset="40%" stop-color="${PARCHMENT.paper}"/>
      <stop offset="100%" stop-color="${PARCHMENT.paperDark}"/>
    </linearGradient>
    <filter id="roughen">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
      <feBlend in="SourceGraphic" in2="grayNoise" mode="multiply" result="blended"/>
      <feComponentTransfer in="blended">
        <feFuncA type="linear" slope="1"/>
      </feComponentTransfer>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="60%" stop-color="transparent"/>
      <stop offset="100%" stop-color="${PARCHMENT.paperDark}" stop-opacity="0.5"/>
    </radialGradient>
    <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PARCHMENT.seaLight}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${PARCHMENT.seaDark}" stop-opacity="0.55"/>
    </linearGradient>`;
  svg.appendChild(defs);

  // Parchment base
  svg.appendChild(mk('rect', { width:vw, height:vh, fill:'url(#parchGrad)' }));

  // Sea overlay (tinted blue-green over parchment)
  svg.appendChild(mk('rect', { width:vw, height:vh, fill:'url(#seaGrad)' }));

  // Vignette
  svg.appendChild(mk('rect', { width:vw, height:vh, fill:'url(#vignette)' }));

  const regions = world.regions || [];

  // ── Sea atmosphere ─────────────────────────────────────────
  drawSeaAtmosphere(svg, vw, vh, regions);

  // ── Trade routes (before landmasses so they go under) ──────
  if (novaState && novaState.events) {
    // Find alliance events to determine active trade routes
    const alliances = novaState.events.filter(e => e.type === 'alliance');
    regions.forEach((r1, i) => {
      regions.forEach((r2, j) => {
        if (j <= i) return;
        const dist  = Math.hypot(r1.x - r2.x, r1.y - r2.y);
        const hasAlliance = alliances.some(a =>
          a.text.toLowerCase().includes(r1.name.toLowerCase().split(' ')[0].slice(0,4)) &&
          a.text.toLowerCase().includes(r2.name.toLowerCase().split(' ')[0].slice(0,4))
        );
        // Always draw faint routes between nearby regions; stronger if allied
        if (dist < 280) {
          drawTradeRoute(svg, r1, r2, hasAlliance ? 0.8 : 0.2);
        }
      });
    });
  } else {
    // No sim yet — draw faint baseline routes
    regions.forEach((r1, i) => {
      regions.forEach((r2, j) => {
        if (j <= i) return;
        if (Math.hypot(r1.x - r2.x, r1.y - r2.y) < 240) {
          drawTradeRoute(svg, r1, r2, 0.15);
        }
      });
    });
  }

  // ── Render each region ─────────────────────────────────────
  regions.forEach(region => {
    const cx      = Math.max(80, Math.min(vw - 80, parseFloat(region.x) || 300));
    const cy      = Math.max(80, Math.min(vh - 80, parseFloat(region.y) || 290));
    const radius  = Math.max(45, Math.min(100, parseFloat(region.radius) || 70));

    const profile    = getTerrainProfile(region.type);
    const simState   = novaState?.regionState?.[region.name] || { power:50, stability:50 };
    const powerLevel = simState.power || 50;

    // Determine if there's a recent event for this region
    const recentEvent = novaState?.events?.slice(-8).find(e =>
      e.text.toLowerCase().includes((region.name||'').toLowerCase().split(' ')[0].slice(0,4))
    );

    // ── Group ──────────────────────────────────────────────
    const g = mk('g');
    g.style.cursor = 'pointer';

    // Landmass shadow
    const shadowPath = makeLandmassPath(cx + 3, cy + 4, radius + 5, region.name + '_shadow', 0.3);
    g.appendChild(mk('path', { d:shadowPath, fill:PARCHMENT.inkFaint, 'fill-opacity':0.12, stroke:'none' }));

    // Landmass body
    const landPath = makeLandmassPath(cx, cy, radius, region.name, 0.35);
    g.appendChild(mk('path', {
      d: landPath,
      fill: profile.land,
      'fill-opacity': 0.82,
      stroke: PARCHMENT.ink,
      'stroke-width': 1.0,
      'stroke-opacity': 0.7,
    }));

    // Landmass inner highlight (slightly lighter, smaller)
    const innerPath = makeLandmassPath(cx - 2, cy - 2, radius * 0.75, region.name + '_inner', 0.25);
    g.appendChild(mk('path', {
      d: innerPath,
      fill: profile.shade,
      'fill-opacity': 0.0,   // just stroke
      stroke: PARCHMENT.inkGhost,
      'stroke-width': 0.4,
      'stroke-dasharray': '2 3',
      'stroke-opacity': 0.35,
    }));

    // ── Terrain icons ─────────────────────────────────────
    const rand       = seededRand(hashStr(region.name + '_icons'));
    const iconCount  = Math.min(profile.icons.length, 2 + Math.floor(radius / 30));
    const iconScale  = Math.max(0.55, radius / 80);

    for (let i = 0; i < iconCount; i++) {
      const angle  = (i / iconCount) * Math.PI * 2 + rand() * 0.5;
      const ir     = radius * (0.35 + rand() * 0.28);
      const ix     = cx + Math.cos(angle) * ir;
      const iy     = cy + Math.sin(angle) * ir;
      const ig     = mk('g');
      drawTerrainIcon(ig, profile.icons[i % profile.icons.length], ix, iy, iconScale, PARCHMENT.ink);
      g.appendChild(ig);
    }

    // ── Settlement ────────────────────────────────────────
    const sg = mk('g');
    drawSettlement(sg, cx, cy - 4, powerLevel, region.name, PARCHMENT.ink);
    g.appendChild(sg);

    // ── Event effect overlay ──────────────────────────────
    if (recentEvent && recentEvent.type !== 'neutral') {
      const eg = mk('g');
      drawEventEffect(eg, cx, cy, radius, recentEvent.type);
      g.appendChild(eg);
    }

    // ── Region label ──────────────────────────────────────
    // Name on a small scroll ribbon below landmass
    const labelY = cy + radius + 16;
    const nameW  = Math.max(60, region.name.length * 6.5);
    g.appendChild(mk('rect', {
      x: cx - nameW/2, y: labelY - 9,
      width: nameW, height: 13, rx: 2,
      fill: PARCHMENT.paperDark, 'fill-opacity': 0.85,
      stroke: PARCHMENT.ink, 'stroke-width': 0.6,
    }));
    g.appendChild(mk('text', {
      x: cx, y: labelY + 1,
      'text-anchor': 'middle',
      'font-family': 'Cinzel,serif',
      'font-size': 7.5,
      'letter-spacing': 1,
      fill: PARCHMENT.ink,
      'font-weight': '600',
    }, (region.name || '').toUpperCase()));

    // Type label (smaller, italic)
    if (region.type) {
      g.appendChild(mk('text', {
        x: cx, y: labelY + 13,
        'text-anchor': 'middle',
        'font-family': 'Crimson Pro,serif',
        'font-size': 6.5,
        fill: PARCHMENT.inkFaint,
        'font-style': 'italic',
      }, region.type));
    }

    // ── Interaction ───────────────────────────────────────
    g.addEventListener('mouseenter', () => {
      const landEl = g.querySelector('path');
      if (landEl) landEl.setAttribute('fill-opacity', '0.95');
    });
    g.addEventListener('mouseleave', () => {
      const landEl = g.querySelector('path');
      if (landEl) landEl.setAttribute('fill-opacity', '0.82');
    });
    g.addEventListener('click', () => onRegionClick && onRegionClick(region.name));

    svg.appendChild(g);
  });

  // ── Decorative border ──────────────────────────────────────
  drawBorder(svg, vw, vh);

  // ── Compass rose (bottom-right area) ──────────────────────
  drawCompassRose(svg, vw - 70, vh - 70, 42);

  // ── Legend (bottom-left) ──────────────────────────────────
  drawLegend(svg, 18, vh - 112, novaState?.year || 0);

  // ── Title scroll (top center) ─────────────────────────────
  drawTitleScroll(svg, world.worldName || 'Unknown World', world.genre || '', vw / 2, 14);
}

/**
 * Lightweight version for the Nova mini-map panel.
 * Same art style but smaller and non-interactive.
 */
export function renderMiniMap(svgId, world, novaState) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';

  const vw = 380;
  const vh = 260;
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `
    <linearGradient id="miniParchGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PARCHMENT.paperLight}"/>
      <stop offset="100%" stop-color="${PARCHMENT.paper}"/>
    </linearGradient>
    <linearGradient id="miniSeaGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PARCHMENT.seaLight}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${PARCHMENT.seaDark}" stop-opacity="0.5"/>
    </linearGradient>`;
  svg.appendChild(defs);

  svg.appendChild(mk('rect', { width:vw, height:vh, fill:'url(#miniParchGrad)' }));
  svg.appendChild(mk('rect', { width:vw, height:vh, fill:'url(#miniSeaGrad)' }));
  svg.appendChild(mk('rect', { x:2, y:2, width:vw-4, height:vh-4, fill:'none', stroke:PARCHMENT.ink, 'stroke-width':0.8 }));

  const regions = world.regions || [];
  const scaleX  = vw / 900;
  const scaleY  = vh / 580;

  regions.forEach(region => {
    const cx    = (parseFloat(region.x) || 300) * scaleX;
    const cy    = (parseFloat(region.y) || 290) * scaleY;
    const r     = (parseFloat(region.radius) || 70) * Math.min(scaleX, scaleY);
    const profile    = getTerrainProfile(region.type);
    const simState   = novaState?.regionState?.[region.name] || { power:50 };
    const powerLevel = simState.power || 50;

    const g = mk('g');
    const landPath = makeLandmassPath(cx, cy, r, region.name, 0.35);
    g.appendChild(mk('path', { d:landPath, fill:profile.land, 'fill-opacity':0.8, stroke:PARCHMENT.ink, 'stroke-width':0.6 }));

    // Tiny settlement dot scaled to power
    const dotR = 1.5 + (powerLevel / 100) * 3;
    g.appendChild(mk('circle', { cx, cy, r:dotR, fill:PARCHMENT.ink, 'fill-opacity':0.7 }));

    // Label
    g.appendChild(mk('text', {
      x:cx, y:cy + r + 9,
      'text-anchor':'middle', 'font-family':'Cinzel,serif',
      'font-size': Math.max(5, r * 0.4),
      fill:PARCHMENT.ink, 'fill-opacity':0.8, 'letter-spacing':0.5,
    }, (region.name||'').toUpperCase().slice(0,10)));

    svg.appendChild(g);
  });

  // Mini compass rose
  drawCompassRose(svg, vw - 28, vh - 28, 18);

  // Year stamp
  if (novaState?.year > 0) {
    svg.appendChild(mk('text', {
      x:8, y:vh-6, 'font-family':'Cinzel,serif', 'font-size':6.5,
      fill:PARCHMENT.inkFaint,
    }, `Year ${novaState.year}`));
  }
}
