/*!
 * Интерактивная карта БК
 * Copyright (c) 2026 simplysoo [12]. All rights reserved.
 * Personal use only. See LICENSE.md.
 */
(() => {
  'use strict';

  if (window.__bkpmPageBridge) return;
  window.__bkpmPageBridge = true;

  const SOURCE = 'BKPM_PAGE_BRIDGE';
  let lastSignature = '';
  let lastWrapAttempt = 0;
  let lastMatrixAt = 0;

  function walkWindows(rootWindow, callback, depth = 0, seen = new Set()) {
    if (!rootWindow || depth > 4 || seen.has(rootWindow)) return;
    seen.add(rootWindow);
    try {
      callback(rootWindow, depth);
    } catch (error) {
      // Ignore inaccessible or reloading frames.
    }

    let frames = [];
    try {
      frames = Array.from(rootWindow.frames || []);
    } catch (error) {
      frames = [];
    }
    for (const frame of frames) walkWindows(frame, callback, depth + 1, seen);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeDirection(value) {
    const text = cleanText(value).toLowerCase().replace(/ё/g, 'е');
    if (/север|north|^n$/.test(text)) return 'север';
    if (/восток|east|^e$/.test(text)) return 'восток';
    if (/юг|south|^s$/.test(text)) return 'юг';
    if (/запад|west|^w$/.test(text)) return 'запад';
    return '';
  }

  function readMoveTextDirection(win) {
    let node = null;
    try {
      node = win.document && win.document.querySelector ? win.document.querySelector('#movetext') : null;
    } catch (error) {
      node = null;
    }
    if (!node) return '';
    return readMoveTextDirectionNearNode(node);
  }

  function readMoveTextDirectionNearNode(node) {
    const candidates = [
      node,
      node.nextElementSibling,
      node.previousElementSibling,
      node.parentElement,
      node.parentElement && node.parentElement.querySelector ? node.parentElement.querySelector('[align="right"]') : null,
      node.closest ? node.closest('#rbtm') : null
    ];
    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      let text = '';
      try {
        text = candidate.textContent || candidate.innerText || '';
      } catch (error) {
        continue;
      }
      let direction = '';
      try {
        direction = extractMoveTextDirection(text);
      } catch (error) {
        direction = '';
      }
      if (direction) return direction;
    }
    return '';
  }

  function extractMoveTextDirection(value) {
    const text = cleanText(value);
    const match = text.match(/смотрим\s+на[:\s]+(север|юг|запад|восток)/i);
    if (match) return normalizeDirection(match[1]);
    const loose = text.toLowerCase().replace(/ё/g, 'е').match(/(север|юг|запад|восток|north|south|east|west|^n$|^s$|^e$|^w$)/i);
    return normalizeDirection(loose ? loose[1] : text);
  }

  function skinnyMatrix(matrix) {
    if (!matrix || typeof matrix !== 'object') return null;
    const result = {};
    for (const xKey of Object.keys(matrix)) {
      const column = matrix[xKey];
      if (!column || typeof column !== 'object') continue;
      const outColumn = {};
      for (const yKey of Object.keys(column)) {
        const room = column[yKey];
        if (!room || typeof room !== 'object') continue;
        outColumn[yKey] = {
          walls: room.walls || '',
          path: room.path || '',
          name: room.name || '',
          obj: Array.isArray(room.obj) ? room.obj.map(item => ({
            name: item && item.name ? String(item.name) : '',
            image: item && item.image ? String(item.image) : '',
            anim: Boolean(item && item.anim),
            zoom_image: item && item.zoom_image ? String(item.zoom_image) : ''
          })) : [],
          users: Array.isArray(room.users) ? room.users.map(item => ({
            name: item && item.name ? String(item.name) : '',
            image: item && item.image ? String(item.image) : '',
            img: item && item.img ? String(item.img) : '',
            action: item && item.action ? String(item.action) : ''
          })) : []
        };
      }
      result[xKey] = outColumn;
    }
    return result;
  }

  function captureFrom(win, depth, includeMatrix) {
    const data = win.jsondata;
    if (!data || typeof data !== 'object' || !data.movemenu) return null;
    const move = data.movemenu || {};
    const walls2 = move.walls2 || {};
    const movetextDirection = readMoveTextDirection(win);
    return {
      href: String(win.location && win.location.href ? win.location.href : ''),
      depth,
      room: data.room || '',
      movetextDirection,
      HP: data.HP,
      maxHP: data.maxHP,
      users2: Array.isArray(data.users2) ? data.users2.map(item => ({
        i_am: item && item.i_am,
        x: item && item.x,
        y: item && item.y,
        login: item && item.login
      })) : [],
      movemenu: {
        direction: movetextDirection || '',
        mtime: move.mtime || 0,
        m1: move.m1 || null,
        m3: move.m3 || null,
        m5: move.m5 || null,
        m7: move.m7 || null,
        m1name: move.m1name || '',
        m3name: move.m3name || '',
        m5name: move.m5name || '',
        m7name: move.m7name || '',
        walls2: {
          dpref: walls2.dpref,
          ud: walls2.ud,
          texs: walls2.texs || '',
          matrix: includeMatrix ? skinnyMatrix(walls2.matrix) : null,
          hasMatrix: Boolean(walls2.matrix)
        }
      }
    };
  }

  function captureBest(includeMatrix) {
    let best = null;
    walkWindows(window.top || window, (win, depth) => {
      const item = captureFrom(win, depth, includeMatrix);
      if (!item) return;
      let score = 100 - depth * 5;
      if (item.movemenu && item.movemenu.walls2 && item.movemenu.walls2.hasMatrix) score += 100;
      if (Array.isArray(item.users2) && item.users2.some(user => user && user.i_am)) score += 60;
      if (item.movetextDirection) score += 40;
      if (!best || score > best.score) best = Object.assign({ score }, item);
    });
    return best;
  }

  function signatureOf(data) {
    if (!data) return '';
    const user = Array.isArray(data.users2) ? data.users2.find(item => item && item.i_am) : null;
    const move = data.movemenu || {};
    return [
      data.href,
      data.room,
      data.movetextDirection || '',
      user ? user.x : '',
      user ? user.y : '',
      move.m1 || '',
      move.m3 || '',
      move.m5 || '',
      move.m7 || '',
      data.HP,
      data.maxHP
    ].join('|');
  }

  function post(force, includeMatrix) {
    const now = Date.now();
    const withMatrix = Boolean(includeMatrix && now - lastMatrixAt > 5000);
    if (withMatrix) lastMatrixAt = now;
    const data = captureBest(withMatrix);
    if (data) data.capturedAt = now;
    const signature = signatureOf(data);
    if (!force && signature && signature === lastSignature) return;
    lastSignature = signature;
    window.postMessage({ source: SOURCE, type: 'state', data }, '*');
  }

  function burst() {
    post(true, false);
    setTimeout(() => post(false, false), 120);
    setTimeout(() => post(false, false), 420);
    setTimeout(() => post(false, false), 900);
  }

  function wrapDungLink() {
    const now = Date.now();
    if (now - lastWrapAttempt < 250) return;
    lastWrapAttempt = now;
    walkWindows(window.top || window, win => {
      const fn = win.dung_link;
      if (typeof fn !== 'function' || fn.__bkpmWrapped) return;
      const wrapped = function bkpmDungLinkWrapper() {
        const result = fn.apply(this, arguments);
        burst();
        return result;
      };
      wrapped.__bkpmWrapped = true;
      win.dung_link = wrapped;
    });
  }

  window.addEventListener('message', event => {
    if (!event || !event.data || event.data.source !== 'BKPM_CONTENT') return;
    if (event.data.type === 'request-state') post(true, Boolean(event.data.includeMatrix));
  });

  document.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('area,a,button') : null;
    if (!target) return;
    const text = [
      target.getAttribute('href') || '',
      target.getAttribute('onclick') || '',
      target.getAttribute('title') || ''
    ].join(' ');
    if (/dung_link|path=m|path=rl|path=rr|battle|fbattle|поедин|бой|вернуться|законч/i.test(text)) burst();
  }, true);

  setInterval(() => {
    wrapDungLink();
    post(false, false);
  }, 1500);

  wrapDungLink();
  post(true, true);
  setTimeout(() => post(false, false), 250);
})();
