/*!
 * Интерактивная карта БК
 * Copyright (c) 2026 simplysoo [12]. All rights reserved.
 * Personal use only. See LICENSE.md.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'data');
const mapsDir = path.join(outDir, 'maps');
const outFile = path.join(outDir, 'preload.json');
const dungeonsFile = path.join(root, 'src', 'dungeons.js');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(dungeonsFile, 'utf8'), sandbox, { filename: dungeonsFile });
const dungeons = sandbox.window.BK_PALADINS_DUNGEONS || [];

function cleanText(value) {
  return decodeHtml(String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[^a-zа-я0-9\s\-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutizeUrl(url, baseUrl) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    return new URL(value, baseUrl || 'https://lib.paladins.ru/').href;
  } catch {
    return value;
  }
}

function parseCoord(coord) {
  const match = String(coord || '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }
  return { col, row: Number(match[2]) };
}

function wallsFromClass(className) {
  const classList = String(className || '').split(/\s+/);
  const cellClass = classList.find(item => /^cell/i.test(item) && !/^cellnav/i.test(item) && !/^cellclear/i.test(item)) || '';
  const baseMatch = cellClass.match(/^cell([a-z]+)/i);
  const base = baseMatch ? baseMatch[1].toLowerCase().split('_')[0] : '';
  return {
    n: base.includes('t'),
    e: base.includes('r'),
    s: base.includes('b'),
    w: base.includes('l')
  };
}

function cleanObjectName(value) {
  const text = cleanText(value)
    .replace(/^id\d+\s*/i, '')
    .replace(/\[[^\]]*]/g, '')
    .trim();
  if (!text || text.length < 3) return '';
  if (/^(id\d+|img|table|font|small)$/i.test(text)) return '';
  return text.slice(0, 90);
}

function extractCellNames(inner) {
  const names = new Set();
  const raw = String(inner || '');
  const patterns = [
    /obj_name[^>]*>\s*([^<]+)/gi,
    /bot_name[^>]*>\s*([^<]+)/gi,
    /bot_npc_name[^>]*>\s*([^<]+)/gi,
    /class=["']?[^"'>]*obj_name[^"'>]*["']?[^>]*>\s*([^<]+)/gi,
    /class=["']?[^"'>]*bot_name[^"'>]*["']?[^>]*>\s*([^<]+)/gi,
    /class=["']?[^"'>]*bot_npc_name[^"'>]*["']?[^>]*>\s*([^<]+)/gi,
    /onmouseover=["'][\s\S]*?<b>([^<]{3,90})<\/b>/gi,
    /title=["']([^"']{3,90})["']/gi,
    /alt=["']([^"']{3,90})["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      const name = cleanObjectName(decodeHtml(match[1]));
      if (name) names.add(name);
    }
  }
  return Array.from(names).slice(0, 6);
}

function extractCellImage(html, baseUrl) {
  const raw = String(html || '');
  if (!raw || !/<img/i.test(raw)) return '';
  const embedded = raw.match(/(?:src=|src\\?=)(["']?)(\/?(?:i\/chars|i\/monsters|i\/objects|items_db\/map_images\/objects|items_db\/map_images\/bots)[^"'\s>)]*\.(?:gif|png|jpe?g|webp))/i);
  if (embedded && embedded[2]) return absolutizeUrl(embedded[2], baseUrl);
  const imagePattern = /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(raw)) !== null) {
    const src = match[1] || '';
    if (!src || /\/i\/items\//i.test(src) || /\/images\/(?:menu|header|icons)\//i.test(src)) continue;
    return absolutizeUrl(src, baseUrl);
  }
  return '';
}

function extractDropItems(html, baseUrl) {
  const raw = String(html || '');
  const items = [];
  const seen = new Set();
  const pattern = /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>[\s\S]{0,350}?<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const name = cleanText(match[3]);
    if (!name || name.length < 3) continue;
    const href = absolutizeUrl(match[2], baseUrl);
    const image = absolutizeUrl(match[1], baseUrl);
    const key = `${normalizeName(name)}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, href, image });
    if (items.length >= 18) break;
  }
  return items;
}

function classifyCell(className, names, html) {
  const value = String(className || '').toLowerCase();
  const body = String(html || '').toLowerCase();
  if (value.includes('enter')) return 'enter';
  if (value.includes('port')) return 'portal';
  if (body.includes('/guide/monsters')) return 'monster';
  if (body.includes('/guide/npc')) return 'npc';
  if (body.includes('obj_name') || body.includes('/guide/chests')) return 'object';
  if (value.includes('npc')) return 'npc';
  if (value.includes('danger')) return 'danger';
  if (names && names.length) return 'object';
  return 'room';
}

function findStartCoord(map) {
  const special = map.cells.find(cell => /enter/i.test(cell.className) || /вход|старт/i.test((cell.names || []).join(' ')));
  return special ? special.coord : (map.cells[0] ? map.cells[0].coord : '');
}

function parseMapHtml(html, dungeon, floor) {
  const lines = String(html || '').split(/\r?\n/);
  const chunks = [];
  let current = null;
  const startPattern = /^<!--\s*([A-Z]+[0-9]+)\s*-->\s*<div\b[^>]*class=["']([^"']*)["'][^>]*>/i;
  const anyCellPattern = /^<!--\s*(?:[A-Z]+[0-9]+|[A-Z]+|\d*)\s*-->\s*<div\b[^>]*class=["'][^"']*cell/i;

  for (const line of lines) {
    const start = line.match(startPattern);
    if (start) {
      if (current) chunks.push(current);
      current = {
        coord: start[1].toUpperCase(),
        className: start[2] || '',
        lines: [line]
      };
      continue;
    }
    if (current && anyCellPattern.test(line)) {
      chunks.push(current);
      current = null;
    }
    if (current) current.lines.push(line);
  }
  if (current) chunks.push(current);

  const cells = [];
  let maxCol = 0;
  let maxRow = 0;
  for (const chunk of chunks) {
    if (!/\bcell/i.test(chunk.className) || /\bcellnav/i.test(chunk.className) || /\bcellclear/i.test(chunk.className)) continue;
    const parsed = parseCoord(chunk.coord);
    if (!parsed) continue;
    const inner = chunk.lines.join('\n');
    const names = extractCellNames(inner);
    maxCol = Math.max(maxCol, parsed.col);
    maxRow = Math.max(maxRow, parsed.row);
    cells.push({
      coord: chunk.coord,
      label: chunk.coord,
      floorTitle: floor.title,
      col: parsed.col,
      row: parsed.row,
      className: chunk.className,
      walls: wallsFromClass(chunk.className),
      names,
      image: extractCellImage(inner, floor.url),
      dropItems: /\/items\/|guide_link/i.test(inner) ? extractDropItems(inner, floor.url) : [],
      kind: classifyCell(chunk.className, names, inner),
      html: ''
    });
  }

  const map = {
    dungeonId: dungeon.id,
    dungeonTitle: dungeon.title,
    floorId: floor.id,
    floorTitle: floor.title,
    url: floor.url,
    source: 'preload',
    cells,
    maxCol,
    maxRow,
    loadedAt: new Date().toISOString()
  };
  map.startCoord = findStartCoord(map);
  return map;
}

function mapFileName(dungeon, floor) {
  return `${dungeon.id}_${floor.id}.json`.replace(/[^a-z0-9_.-]/gi, '_');
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(mapsDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    version: 1,
    maps: {}
  };
  for (const dungeon of dungeons) {
    for (const floor of dungeon.floors || []) {
      const key = `${dungeon.id}:${floor.id}`;
      process.stdout.write(`fetch ${key} ... `);
      const html = await fetchText(floor.url);
      const map = parseMapHtml(html, dungeon, floor);
      const file = mapFileName(dungeon, floor);
      fs.writeFileSync(path.join(mapsDir, file), JSON.stringify(map), 'utf8');
      payload.maps[key] = {
        file: `data/maps/${file}`,
        cells: map.cells.length,
        maxCol: map.maxCol,
        maxRow: map.maxRow
      };
      console.log(`${map.cells.length} cells`);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(payload), 'utf8');
  console.log(`saved ${outFile} (${fs.statSync(outFile).size} bytes)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
