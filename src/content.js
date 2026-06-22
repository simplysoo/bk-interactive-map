/*!
 * Интерактивная карта БК
 * Copyright (c) 2026 simplysoo [12]. All rights reserved.
 * Personal use only. See LICENSE.md.
 */
(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (!/combats\.com$/i.test(location.hostname)) return;
  if (window.__BKPM_CONTENT_LOADED__) return;
  window.__BKPM_CONTENT_LOADED__ = true;

  const ROOT_ID = 'bkpm-root';
  const STORAGE_KEY = 'bkpm_state_v1';
  const CELL_SIZE_MIN = 18;
  const CELL_SIZE_MAX = 54;
  const CATEGORY_LIST_INITIAL = 16;
  const CATEGORY_LIST_STEP = 16;
  const OPTIMISTIC_MOVE_GRACE_MS = 1250;
  const OPTIMISTIC_TURN_GRACE_MS = 700;
  const KEY_REPEAT_SYNC_MIN_MS = 140;
  const DUNGMAP_CELL_SIZE = 15;
  const DUNGMAP_TILE_OFFSET = -8;
  const DUNGMAP_USER_OFFSET = 1;
  const SCENE_ANCHOR_RADIUS = 6;
  const MINIMAP_WALL_MODES = [
    { id: 'wall-n-e-s-w', digitsAreOpen: false, sideByDigit: { 1: 'n', 3: 'e', 5: 's', 7: 'w' } },
    { id: 'open-n-e-s-w', digitsAreOpen: true, sideByDigit: { 1: 'n', 3: 'e', 5: 's', 7: 'w' } },
    { id: 'wall-e-s-w-n', digitsAreOpen: false, sideByDigit: { 1: 'e', 3: 's', 5: 'w', 7: 'n' } },
    { id: 'open-e-s-w-n', digitsAreOpen: true, sideByDigit: { 1: 'e', 3: 's', 5: 'w', 7: 'n' } },
    { id: 'wall-s-w-n-e', digitsAreOpen: false, sideByDigit: { 1: 's', 3: 'w', 5: 'n', 7: 'e' } },
    { id: 'open-s-w-n-e', digitsAreOpen: true, sideByDigit: { 1: 's', 3: 'w', 5: 'n', 7: 'e' } },
    { id: 'wall-w-n-e-s', digitsAreOpen: false, sideByDigit: { 1: 'w', 3: 'n', 5: 'e', 7: 's' } },
    { id: 'open-w-n-e-s', digitsAreOpen: true, sideByDigit: { 1: 'w', 3: 'n', 5: 'e', 7: 's' } }
  ];
  const DUNGEONS = Array.isArray(window.BK_PALADINS_DUNGEONS) ? window.BK_PALADINS_DUNGEONS : [];
  const MAP_ICON_FILES = {
    knight: 'role-knight.png',
    rogue: 'role-rogue.png',
    bag: 'loot-bag.png',
    compass: 'nav-compass.png',
    skull: 'monster-skull.png',
    beast: 'monster-beast.png',
    demon: 'monster-demon.png',
    spider: 'monster-spider.png',
    chest: 'object-chest.png',
    cache: 'object-cache.png',
    coins: 'loot-coins.png',
    lockbox: 'object-lockbox.png',
    npc: 'npc-human.png',
    shield: 'defense-shield.png',
    pin: 'nav-pin.png',
    player: 'player-glow.png'
  };

  const runtime = {
    started: false,
    bootPromise: null,
    root: null,
    mapByKey: new Map(),
    guideByDungeon: new Map(),
    pendingLoads: new Map(),
    pendingGuideLoads: new Map(),
    preloadMapPromises: new Map(),
    coordCalibration: {},
    minimapCalibration: {},
    gameClickDocs: new WeakSet(),
    gameKeyDocs: new WeakSet(),
    gameMinimapDocs: new WeakSet(),
    gameMoveTextDocs: new WeakSet(),
    bridgeData: null,
    bridgeAt: 0,
    lastBridgeRequestAt: 0,
    lastObserverBind: 0,
    contextCache: null,
    optimisticMove: null,
    pendingMove: null,
    lastDungeonKey: { token: '', at: 0 },
    mapDrag: null,
    mapCellTap: null,
    mapCellClickGuard: null,
    cacheStamp: 0,
    cellMetaScope: '',
    cellMetaCache: new Map(),
    mapImageIndexScope: '',
    mapImageIndex: null,
    guideIndexScope: '',
    guideIndex: null,
    categoryListLimits: {},
    playerMapCoord: '',
    game: null,
    lastLootScan: 0,
    lastFullSyncAt: 0,
    lastBattleSeenAt: 0,
    lastRecoverySyncAt: 0,
    renderQueued: false,
    lastStatus: '',
    state: {
      dungeonId: DUNGEONS[0] ? DUNGEONS[0].id : '',
      floorId: DUNGEONS[0] && DUNGEONS[0].floors[0] ? DUNGEONS[0].floors[0].id : '',
      selectedCoord: '',
      targetCoord: '',
      routeStartCoord: '',
      route: [],
      routeBlocked: false,
      zoom: 1,
      collapsed: false,
      railOpen: true,
      drawerOpen: false,
      drawerView: 'cell',
      guideCollapsed: true,
      marker: 'light',
      visible: true,
      lastPlayer: null,
      lootStats: {},
      lootEvents: [],
      seenLootMessages: {},
      visited: {},
      clearedMonsters: {}
    }
  };

  function markExtensionContextInvalid(error) {
    runtime.extensionContextInvalid = true;
    if (!runtime.extensionContextWarned) {
      runtime.extensionContextWarned = true;
      console.warn('[BKPM] Extension context invalidated, reload the game tab to attach the fresh extension context.');
    }
  }

  function safeRuntimeUrl(path) {
    if (runtime.extensionContextInvalid) return '';
    try {
      return chrome.runtime.getURL(path);
    } catch (error) {
      markExtensionContextInvalid(error);
      return '';
    }
  }

  async function safeStorageGet(key) {
    if (runtime.extensionContextInvalid) return null;
    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      markExtensionContextInvalid(error);
      return null;
    }
  }

  function safeStorageSet(value) {
    if (runtime.extensionContextInvalid) return;
    try {
      chrome.storage.local.set(value).catch(error => {
        markExtensionContextInvalid(error);
      });
    } catch (error) {
      markExtensionContextInvalid(error);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'bkpmTogglePanel') return false;
    startOrToggleFromAction()
      .then(result => sendResponse(Object.assign({ ok: true }, result || {})))
      .catch(error => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  });

  async function startOrToggleFromAction() {
    if (!runtime.started) {
      if (!runtime.bootPromise) {
        runtime.bootPromise = boot().finally(() => {
          runtime.bootPromise = null;
        });
      }
      await runtime.bootPromise;
      return { visible: true, started: true };
    }

    runtime.state.visible = !runtime.state.visible;
    runtime.state.collapsed = false;
    if (runtime.root) {
      runtime.root.classList.toggle('is-hidden', !runtime.state.visible);
      runtime.root.classList.remove('is-collapsed');
      const toggleButton = runtime.root.querySelector('[data-action="toggle"]');
      if (toggleButton) toggleButton.textContent = '×';
    }
    if (runtime.state.visible) {
      syncGameState();
      queueRender('Карта открыта');
      scheduleMapLoad(false);
    }
    saveStateSoon();
    return { visible: runtime.state.visible, started: true };
  }

  async function boot() {
    if (runtime.started) return;
    runtime.started = true;
    await loadState();
    runtime.state.visible = true;
    runtime.state.collapsed = false;
    ensurePanel();
    installLiveSync();
    bindMapClickIfNeeded();
    bindPanelEvents();
    installResponsiveRender();
    updateDungeonControls();
    syncGameState();
    queueRender('Открыто');
    scheduleMapLoad(false);

    setInterval(() => {
      if (runtime.state.visible) {
        requestBridgeState(false);
        scheduleGameSync('interval', false);
      }
      if (Date.now() - runtime.lastObserverBind > 5000) bindGameObservers();
    }, 2500);
  }

  function installLiveSync() {
    injectPageBridge();
    window.addEventListener('message', event => {
      if (!event || event.source !== window || !event.data || event.data.source !== 'BKPM_PAGE_BRIDGE') return;
      if (event.data.type !== 'state') return;
      runtime.bridgeData = event.data.data || null;
      runtime.bridgeAt = Date.now();
      scheduleGameSync('bridge', true);
    });

    document.addEventListener('click', handleGameMoveClick, true);
    document.addEventListener('click', handleGameRecoveryClick, true);
    window.addEventListener('focus', () => scheduleRecoverySync('focus'), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRecoverySync('visibility');
    }, { passive: true });

    bindGameObservers();
    requestBridgeState();
  }

  function injectPageBridge() {
    if (document.getElementById('bkpm-page-bridge')) return;
    const bridgeUrl = safeRuntimeUrl('src/page-bridge.js');
    if (!bridgeUrl) return;
    const script = document.createElement('script');
    script.id = 'bkpm-page-bridge';
    script.src = bridgeUrl;
    script.async = false;
    script.onload = () => script.remove();
    try {
      (document.documentElement || document.head || document.body).appendChild(script);
    } catch (error) {
      markExtensionContextInvalid(error);
    }
  }

  function requestBridgeState(includeMatrix) {
    const now = Date.now();
    if (!includeMatrix && now - runtime.lastBridgeRequestAt < 90) return;
    runtime.lastBridgeRequestAt = now;
    window.postMessage({
      source: 'BKPM_CONTENT',
      type: 'request-state',
      includeMatrix: Boolean(includeMatrix)
    }, '*');
  }

  function handleGameRecoveryClick(event) {
    if (!event || !event.target) return;
    if (runtime.root && runtime.root.contains(event.target)) return;
    const target = event.target.closest ? event.target.closest('area,a,button,input') : null;
    if (!target) return;
    const text = [
      target.getAttribute && target.getAttribute('href') || '',
      target.getAttribute && target.getAttribute('onclick') || '',
      target.getAttribute && target.getAttribute('title') || '',
      target.value || '',
      target.textContent || ''
    ].join(' ');
    const wasBattle = runtime.game && runtime.game.syncMode === 'battle';
    if (!wasBattle && !/battle|fbattle|dung|path=|поедин|бой|вернуться|законч|обнов/i.test(text)) return;
    scheduleRecoverySync('activity');
  }

  function scheduleRecoverySync(reason) {
    const now = Date.now();
    if (now - runtime.lastRecoverySyncAt < 650) return;
    runtime.lastRecoverySyncAt = now;
    runtime.contextCache = null;
    injectPageBridge();
    bindGameObservers();
    requestBridgeState(true);
    scheduleGameSync(reason || 'recovery', true);
    clearTimeout(scheduleRecoverySync.timer);
    scheduleRecoverySync.timer = setTimeout(() => {
      runtime.contextCache = null;
      bindGameObservers();
      requestBridgeState(true);
      renderSyncResult(syncGameState());
    }, 900);
  }

  function scheduleGameSync(reason, burst) {
    clearTimeout(scheduleGameSync.timer);
    if (burst || reason === 'bridge' || reason === 'key-repeat' || reason === 'minimap') {
      for (const timer of scheduleGameSync.burstTimers || []) clearTimeout(timer);
      scheduleGameSync.burstTimers = [];
    }
    scheduleGameSync.timer = setTimeout(() => {
      renderSyncResult(syncGameState());
    }, reason === 'bridge' || reason === 'minimap' || reason === 'movetext' ? 35 : reason === 'key-repeat' ? 70 : 120);
    if (!burst) return;
    const delays = reason === 'click' ? [260, 900, 1500] : reason === 'key' ? [220, 700, 1500] : reason === 'key-repeat' ? [140, 420] : [260];
    for (const delay of delays) {
      const timer = setTimeout(() => {
        renderSyncResult(syncGameState());
      }, delay);
      scheduleGameSync.burstTimers.push(timer);
    }
  }

  function renderSyncResult(result) {
    if (!result) return;
    if (result === 'fast') {
      if (!applyFastMapUpdate()) queueRender();
      return;
    }
    queueRender();
  }

  function bindGameObservers() {
    runtime.lastObserverBind = Date.now();
    for (const context of getAccessibleContexts()) {
      const doc = context.doc;
      if (!doc) continue;
      let looksLikeGameDoc = Boolean(doc.querySelector('#MoveMap,.Dungeon,#DungMap,#roomname,.UserBattleMethod,.UserBattleMethodDisabled,button[data-cmd^="skill "]'));
      try {
        looksLikeGameDoc = looksLikeGameDoc || Boolean(doc.defaultView && doc.defaultView.jsondata && doc.defaultView.jsondata.movemenu);
      } catch (error) {
        // Cross-frame reloads can briefly deny access.
      }
      if (!looksLikeGameDoc) continue;
      bindGameClickDoc(doc);
      bindGameKeyDoc(doc);
      bindGameMinimapDoc(doc);
      bindGameMoveTextDoc(doc);
      // Movement is synchronized through the page bridge, click/key hooks and
      // tiny observers on #DungMap and #movetext only. Watching the whole dungeon subtree lags.
      continue;
    }
  }

  function bindGameClickDoc(doc) {
    if (!doc || runtime.gameClickDocs.has(doc)) return;
    runtime.gameClickDocs.add(doc);
    doc.addEventListener('click', handleGameMoveClick, true);
  }

  function bindGameKeyDoc(doc) {
    if (!doc || runtime.gameKeyDocs.has(doc)) return;
    runtime.gameKeyDocs.add(doc);
    doc.addEventListener('keydown', handleGameKeyDown, true);
  }

  function bindGameMinimapDoc(doc) {
    if (!doc) return;
    const minimap = doc.querySelector && doc.querySelector('#DungMap');
    if (minimap && runtime.gameMinimapDocs.has(minimap)) return;
    if (!minimap || typeof MutationObserver !== 'function') return;
    runtime.gameMinimapDocs.add(minimap);
    const observer = new MutationObserver(() => {
      if (!runtime.state.visible) return;
      scheduleGameSync('minimap', false);
    });
    observer.observe(minimap, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'src', 'class']
    });
  }

  function bindGameMoveTextDoc(doc) {
    if (!doc) return;
    const node = doc.querySelector && doc.querySelector('#movetext');
    const watchNode = node && (node.parentElement || node);
    if (!watchNode || runtime.gameMoveTextDocs.has(watchNode) || typeof MutationObserver !== 'function') return;
    runtime.gameMoveTextDocs.add(watchNode);
    const observer = new MutationObserver(() => {
      if (!runtime.state.visible) return;
      scheduleGameSync('movetext', false);
      requestBridgeState(false);
    });
    observer.observe(watchNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function handleGameKeyDown(event) {
    if (!event) return;
    if (!event.isTrusted) return;
    const target = event.target;
    if (runtime.root && target && runtime.root.contains(target)) return;
    if (target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const token = dungeonTokenFromKey(event);
    if (!token) return;
    if (!shouldTrackDungeonKey(event, token)) return;
    prepareDungeonKeyMove(token);
    scheduleGameSync(event.repeat ? 'key-repeat' : 'key', true);
    requestBridgeState(false);
  }

  function shouldTrackDungeonKey(event, token) {
    if (!event || event.type !== 'keydown' || !token) return false;
    const now = Date.now();
    const last = runtime.lastDungeonKey || { token: '', at: 0 };
    if (event.repeat && last.token === token && now - (last.at || 0) < KEY_REPEAT_SYNC_MIN_MS) return false;
    runtime.lastDungeonKey = { token, at: now };
    return true;
  }

  function prepareDungeonKeyMove(token) {
    runtime.optimisticMove = null;
    refreshPendingMoveBeforeNewInput();
    beginConfirmedDungeonMove(token);
    if (token === 'rr' || token === 'rl') applyDungeonPathToken(token, { allowWallFallback: false });
  }

  function refreshPendingMoveBeforeNewInput() {
    const pending = runtime.pendingMove;
    if (!pending || !pending.signature) return;
    const currentMinimap = readVisibleMinimap();
    const currentSignature = minimapSignature(currentMinimap);
    if (!currentSignature || currentSignature === pending.signature) return;
    renderSyncResult(syncGameState());
  }

  function dungeonTokenFromKey(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '');
    if (key === 'q' || code === 'KeyQ') return 'rl';
    if (key === 'e' || code === 'KeyE') return 'rr';
    if (key === 'w' || code === 'KeyW') return 'm1';
    if (key === 'd' || code === 'KeyD') return 'm3';
    if (key === 's' || code === 'KeyS') return 'm5';
    if (key === 'a' || code === 'KeyA') return 'm7';
    return '';
  }

  function handleGameMoveClick(event) {
    const target = event.target && event.target.closest
      ? event.target.closest('area,a,button,#m1,#m3,#m5,#m7,[class^="TurnRight"],[class^="TurnLeft"],[class^="Front"],[class^="Back"],[class^="Left"],[class^="Right"],[class*=" TurnRight"],[class*=" TurnLeft"],[class*=" Front"],[class*=" Back"],[class*=" Left"],[class*=" Right"]')
      : null;
    if (!target) return;
    const token = extractDungeonPathToken(target);
    const text = [
      target.getAttribute('href') || '',
      target.getAttribute('onclick') || '',
      target.getAttribute('title') || ''
    ].join(' ');
    if (!token && !/dung_link/i.test(text)) return;
    if (token) {
      runtime.optimisticMove = null;
      beginConfirmedDungeonMove(token);
      if (token === 'rr' || token === 'rl') applyDungeonPathToken(token, { allowWallFallback: false });
    }
    scheduleGameSync('click', true);
    requestBridgeState(false);
  }

  function extractDungeonPathToken(element) {
    const text = [
      element && element.getAttribute ? element.getAttribute('href') || '' : '',
      element && element.getAttribute ? element.getAttribute('onclick') || '' : '',
      element && element.getAttribute ? element.getAttribute('id') || '' : '',
      element && element.getAttribute ? element.getAttribute('class') || '' : ''
    ].join(' ');
    const match = text.match(/path=([a-z0-9_]+)/i);
    if (match) return match[1].toLowerCase();
    const dungLink = text.match(/dung_link\s*\(\s*['"]?([a-z0-9_]+)['"]?/i);
    if (dungLink) return dungLink[1].toLowerCase();
    if (/\bTurnRight\d*\b/i.test(text)) return 'rr';
    if (/\bTurnLeft\d*\b/i.test(text)) return 'rl';
    if (/\bm1\b|\bFront\d*\b/i.test(text)) return 'm1';
    if (/\bm3\b|\bRight\d*\b/i.test(text)) return 'm3';
    if (/\bm5\b|\bBack\d*\b/i.test(text)) return 'm5';
    if (/\bm7\b|\bLeft\d*\b/i.test(text)) return 'm7';
    if (/\brr\b/i.test(text)) return 'rr';
    if (/\brl\b/i.test(text)) return 'rl';
    return '';
  }

  function applyDungeonPathToken(token, options) {
    const settings = Object.assign({ allowWallFallback: true }, options || {});
    const map = getCurrentMap();
    if (!map || !token) return false;
    const current = getCurrentCoord() || (!hasMinimapTiles(runtime.game) ? getStoredPlayerCoordForMap(map) : '');
    if (!current || !map.cells.has(current)) return false;
    const now = Date.now();
    const direction = getEffectiveDirection();

    if (token === 'rr' || token === 'rl') {
      const nextDirection = turnDirection(direction, token);
      setOptimisticPosition(current, nextDirection, token, now + 1600);
      if (!applyFastMapUpdate()) queueRender();
      return true;
    }

    if (!/^m[1357]$/.test(token)) return false;
    let target = getMoveTargetCoord(map, current, token, direction, false);
    if (!target && settings.allowWallFallback) target = getMoveTargetCoord(map, current, token, direction, true);
    if (!target || !map.cells.has(target)) return false;

    markVisited(map, current);
    markVisited(map, target);
    runtime.state.selectedCoord = target;
    setOptimisticPosition(target, direction, token, now + 2400, current);
    if (runtime.state.targetCoord) {
      updateRouteFromStart(map, target);
    }
    saveStateSoon();
    if (!applyFastMapUpdate()) queueRender();
    setTimeout(() => centerOnCoord(target, 'auto'), 25);
    return true;
  }

  function setOptimisticPosition(coord, direction, token, until, fromCoord) {
    const now = Date.now();
    runtime.playerMapCoord = coord;
    runtime.optimisticMove = {
      coord,
      fromCoord: fromCoord || '',
      direction: normalizeGameDirection(direction),
      token: token || '',
      startedAt: now,
      rawCoord: runtime.game && runtime.game.rawCoord ? runtime.game.rawCoord : '',
      sourceDirection: runtime.game && runtime.game.direction ? runtime.game.direction : '',
      until: until || now + 4500
    };
    if (!runtime.game) runtime.game = {};
    runtime.game.coord = coord;
    runtime.game.direction = runtime.optimisticMove.direction;
    runtime.game.syncMode = token && /^m/.test(token) ? 'move' : 'turn';
    runtime.gameSignature = [runtime.game.room || '', runtime.game.floorNumber || '', coord, runtime.game.rawCoord || '', runtime.game.direction, runtime.game.syncMode].join('|');
    if (token !== 'rr' && token !== 'rl') {
      persistLastPlayer(getCurrentMap(), coord, runtime.game.direction, token && /^m/.test(token) ? 'move' : 'turn');
    }
  }

  function persistLastPlayer(map, coord, direction, syncMode) {
    if (!map || !coord || !map.cells || !map.cells.has(coord)) return;
    const previous = runtime.state.lastPlayer;
    const previousDirection = previous && previous.dungeonId === map.dungeonId && previous.floorId === map.floorId
      ? previous.direction
      : '';
    runtime.state.lastPlayer = {
      dungeonId: map.dungeonId,
      floorId: map.floorId,
      coord,
      direction: strictNormalizeGameDirection(direction) || strictNormalizeGameDirection(previousDirection),
      syncMode: syncMode || '',
      at: Date.now()
    };
  }

  function getStoredPlayerCoordForMap(map) {
    const last = runtime.state.lastPlayer;
    if (!map || !last) return '';
    if (last.dungeonId !== map.dungeonId || last.floorId !== map.floorId) return '';
    return last.coord && map.cells.has(last.coord) ? last.coord : '';
  }

  function getEffectiveDirection() {
    if (runtime.optimisticMove && runtime.optimisticMove.until > Date.now() && runtime.optimisticMove.direction) {
      return runtime.optimisticMove.direction;
    }
    return strictNormalizeGameDirection(runtime.game && runtime.game.direction) ||
      strictNormalizeGameDirection(runtime.state.lastPlayer && runtime.state.lastPlayer.direction) ||
      'север';
  }

  function turnDirection(direction, token) {
    const order = ['север', 'восток', 'юг', 'запад'];
    const current = order.indexOf(normalizeGameDirection(direction));
    const index = current < 0 ? 0 : current;
    const delta = token === 'rl' ? -1 : 1;
    return order[(index + delta + 4) % 4];
  }

  function applyRecentTurnDirection(game, previousGame) {
    if (!game) return;
    const rawDirection = game.direction || '';
    if (!rawDirection) {
      game.direction = (previousGame && previousGame.direction) ||
        (runtime.state.lastPlayer && runtime.state.lastPlayer.direction) ||
        '';
      if (game.direction) game.directionSource = 'fallback';
    }
  }

  function getExactGameDirection(game) {
    return game && game.directionSource === 'movetext'
      ? strictNormalizeGameDirection(game.direction)
      : '';
  }

  function getMoveTargetCoord(map, coord, token, direction, ignoreWalls) {
    const cell = map.cells.get(coord);
    if (!cell) return '';
    const side = sideForMoveToken(token, direction);
    if (!side || (!ignoreWalls && cell.walls && cell.walls[side])) return '';
    const delta = sideDelta(side);
    let target = '';
    if (map.source === 'live' || Number.isFinite(cell.gameX)) {
      target = liveCoordKey(cell.gameX + delta.dx, cell.gameY + delta.dy);
    } else {
      target = coordFromGrid(cell.col + delta.dx, cell.row + delta.dy);
    }
    const next = map.cells.get(target);
    if (!next) return '';
    const opposite = oppositeSide(side);
    if (!ignoreWalls && next.walls && next.walls[opposite]) return '';
    return target;
  }

  function sideForMoveToken(token, direction) {
    const front = sideForDirection(direction);
    if (!front) return '';
    if (token === 'm1') return front;
    if (token === 'm5') return oppositeSide(front);
    if (token === 'm3') return rightSide(front);
    if (token === 'm7') return leftSide(front);
    return '';
  }

  function sideForDirection(direction) {
    const value = normalizeGameDirection(direction);
    if (value === 'север') return 'n';
    if (value === 'восток') return 'e';
    if (value === 'юг') return 's';
    if (value === 'запад') return 'w';
    return 'n';
  }

  function sideDelta(side) {
    return {
      n: { dx: 0, dy: -1 },
      e: { dx: 1, dy: 0 },
      s: { dx: 0, dy: 1 },
      w: { dx: -1, dy: 0 }
    }[side] || { dx: 0, dy: 0 };
  }

  function oppositeSide(side) {
    return { n: 's', e: 'w', s: 'n', w: 'e' }[side] || '';
  }

  function rightSide(side) {
    return { n: 'e', e: 's', s: 'w', w: 'n' }[side] || '';
  }

  function leftSide(side) {
    return { n: 'w', w: 's', s: 'e', e: 'n' }[side] || '';
  }

  function trimObjectByKeys(value, limit) {
    if (!value || typeof value !== 'object') return {};
    const keys = Object.keys(value);
    if (keys.length <= limit) return value;
    const keep = new Set(keys
      .sort((a, b) => {
        const av = Number(value[a]) || 0;
        const bv = Number(value[b]) || 0;
        return av - bv;
      })
      .slice(-limit));
    const result = {};
    for (const key of keys) {
      if (keep.has(key)) result[key] = value[key];
    }
    return result;
  }

  async function loadState() {
    try {
      const stored = await safeStorageGet(STORAGE_KEY);
      if (!stored) return;
      const value = stored && stored[STORAGE_KEY];
      if (value && typeof value === 'object') {
        runtime.state = Object.assign(runtime.state, value);
        runtime.state.visited = value.visited && typeof value.visited === 'object' ? value.visited : {};
        runtime.state.clearedMonsters = value.clearedMonsters && typeof value.clearedMonsters === 'object' ? value.clearedMonsters : {};
        runtime.state.lastPlayer = value.lastPlayer && typeof value.lastPlayer === 'object' ? value.lastPlayer : null;
        runtime.state.lootStats = value.lootStats && typeof value.lootStats === 'object' ? value.lootStats : {};
        runtime.state.lootEvents = Array.isArray(value.lootEvents) ? value.lootEvents.slice(-300) : [];
        runtime.state.seenLootMessages = trimObjectByKeys(value.seenLootMessages, 700);
        runtime.state.routeStartCoord = typeof value.routeStartCoord === 'string' ? value.routeStartCoord : '';
        runtime.state.route = Array.isArray(value.route) ? value.route : [];
        runtime.state.routeBlocked = Boolean(value.routeBlocked);
        runtime.state.railOpen = true;
        runtime.state.drawerOpen = false;
        runtime.state.drawerView = ['cell', 'route', 'guide', 'loot', 'monsters', 'caches', 'npcs'].includes(value.drawerView) ? value.drawerView : 'cell';
        runtime.state.marker = ['light', 'dark', 'elements'].includes(value.marker) ? value.marker : 'light';
      }
    } catch (error) {
      console.warn('[BKPM] Не удалось прочитать настройки', error);
    }
  }

  function saveStateSoon() {
    clearTimeout(saveStateSoon.timer);
    saveStateSoon.timer = setTimeout(() => {
      runtime.state.lootEvents = Array.isArray(runtime.state.lootEvents) ? runtime.state.lootEvents.slice(-300) : [];
      runtime.state.seenLootMessages = trimObjectByKeys(runtime.state.seenLootMessages, 700);
      safeStorageSet({ [STORAGE_KEY]: runtime.state });
      /*
        console.warn('[BKPM] Не удалось сохранить настройки', error);
        });
      } catch (error) {
        markExtensionContextInvalid(error);
      }
      */
    }, 900);
  }

  function invalidateCellCaches() {
    runtime.cacheStamp++;
    runtime.cellMetaScope = '';
    runtime.cellMetaCache.clear();
    runtime.mapImageIndexScope = '';
    runtime.mapImageIndex = null;
    runtime.guideIndexScope = '';
    runtime.guideIndex = null;
  }

  function mapIconUrl(id) {
    const file = MAP_ICON_FILES[id] || MAP_ICON_FILES.pin;
    return safeRuntimeUrl(`assets/icons/${file}`);
  }

  function renderIconRail() {
    const icons = [
      ['monster', 'demon', 'Монстры с дропом', 'show-monsters', 'monsters'],
      ['object', 'chest', 'Сундуки и тайники', 'show-caches', 'caches'],
      ['npc', 'npc', 'NPC и люди', 'show-npcs', 'npcs'],
      ['player', 'player', 'Обновить местоположение', 'refresh-location', 'player']
    ];
    return `<div class="bkpm-event-rail" aria-label="Иконки событий">${icons.map(item => {
      return `<button type="button" class="bkpm-rail-icon kind-${escapeAttr(item[0])}" data-action="${escapeAttr(item[3])}" data-view="${escapeAttr(item[4])}" aria-label="${escapeAttr(item[2])}">
        <img src="${escapeAttr(mapIconUrl(item[1]))}" alt="">
      </button>`;
    }).join('')}</div>`;
  }

  function ensurePanel() {
    let root = document.getElementById(ROOT_ID);
    if (root) {
      runtime.root = root;
      return root;
    }

    root = document.createElement('aside');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="bkpm-head">
        <div class="bkpm-brand">
          <img class="bkpm-brand-icon" src="${escapeAttr(mapIconUrl('compass'))}" alt="">
          <div>
          <div class="bkpm-title">Интерактивная карта БК</div>
          <div class="bkpm-subtitle">пещеры, объекты, маршруты</div>
        </div>
        </div>
        <button class="bkpm-icon bkpm-close" type="button" data-action="toggle" aria-label="Свернуть или раскрыть">×</button>
      </div>
      <div class="bkpm-body">
        <div class="bkpm-map-frame" data-role="mapFrame">
          <button class="bkpm-rail-toggle" type="button" data-action="toggle-rail" data-tip="Скрыть/показать панель объектов" aria-label="Скрыть или показать панель объектов">
            <span class="bkpm-rail-toggle-open" aria-hidden="true">×</span>
            <span class="bkpm-rail-toggle-closed" aria-hidden="true">☰</span>
          </button>
          ${renderIconRail()}
          <div class="bkpm-map-hud" aria-label="Управление картой">
            <div class="bkpm-map-hud-panel">
              <div class="bkpm-toolbar bkpm-main-toolbar">
                <label>
                  <span>Пещера</span>
                  <select data-role="dungeon"></select>
                </label>
                <label>
                  <span>Этаж</span>
                  <select data-role="floor"></select>
                </label>
              </div>
              <div class="bkpm-map-zoom-row">
                <div class="bkpm-control-group">
                  <button class="bkpm-hud-btn" type="button" data-action="zoom-out" aria-label="Уменьшить карту">−</button>
                  <button class="bkpm-hud-btn wide" type="button" data-action="zoom-reset" aria-label="Масштаб 100%">100%</button>
                  <button class="bkpm-hud-btn" type="button" data-action="zoom-in" aria-label="Увеличить карту">+</button>
                </div>
                <div class="bkpm-control-group presets">
                  <button class="bkpm-hud-btn text" type="button" data-action="zoom-player" aria-label="Максимально близко к игроку">Игрок</button>
                  <button class="bkpm-hud-btn text" type="button" data-action="zoom-fit" aria-label="Показать всю карту">Вся карта</button>
                </div>
              </div>
            </div>
          </div>
          <div class="bkpm-map-wrap" data-role="mapWrap">
            <div class="bkpm-map" data-role="map"></div>
          </div>
        </div>
        <div class="bkpm-toolbar bkpm-info-tabs">
          <button type="button" data-action="show-cell">Клетка</button>
          <button type="button" data-action="show-guide">Рыцарство</button>
          <button type="button" data-action="show-loot">Дроп</button>
        </div>
        <section class="bkpm-drawer" data-role="drawer"></section>
        <section class="bkpm-location-panel" aria-label="Текущее местоположение">
          <div class="bkpm-location-title">Местоположение</div>
          <div class="bkpm-status" data-role="status">Загрузка...</div>
        </section>
        <footer class="bkpm-footer" aria-label="Обратная связь и автор">
          <span class="bkpm-footer-label">Обратная связь и автор</span>
          <span class="bkpm-author-line team1">
            <a class="bkpm-author-profile bkpm-combats-author" href="/inf.pl?1189001034" target="_blank" rel="noreferrer" aria-label="Профиль автора simplysoo">
              <span class="bkpm-author-cross" aria-hidden="true">†</span>
              <img class="bkpm-author-align" src="${escapeAttr(mapIconUrl('compass'))}" width="16" height="16" alt="">
              <b>simplysoo</b><span class="bkpm-author-level">[12]</span>
              <img class="bkpm-author-info" src="https://img.combats.com/i/inf.gif" width="12" height="11" alt="">
            </a>
            <a class="bkpm-support-link" href="https://scrolls.combats.com/~simplysoo/1362767.html" target="_blank" rel="noreferrer">Поддержка</a>
          </span>
        </footer>
      </div>`;
    document.documentElement.appendChild(root);
    runtime.root = root;
    for (const button of Array.from(root.querySelectorAll('button'))) button.tabIndex = -1;
    root.classList.toggle('is-collapsed', runtime.state.collapsed);
    root.classList.toggle('is-hidden', !runtime.state.visible);
    root.classList.toggle('is-rail-open', runtime.state.railOpen);
    const toggleButton = root.querySelector('[data-action="toggle"]');
    if (toggleButton) toggleButton.textContent = runtime.state.collapsed ? '▣' : '×';
    return root;
  }

  function bindPanelEvents() {
    const root = runtime.root;
    root.addEventListener('keydown', handlePanelKeyboardEvent, true);
    root.addEventListener('keypress', handlePanelKeyboardEvent, true);
    root.addEventListener('keyup', handlePanelKeyboardEvent, true);

    root.addEventListener('mousedown', event => {
      const target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('select,input,textarea,[contenteditable="true"]')) return;
      if (target.closest('button,.bkpm-cell')) event.preventDefault();
    }, true);

    root.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      if (document.activeElement && runtime.root.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      const action = button.getAttribute('data-action');
      handleAction(action, button).catch(error => {
        setStatus(`Ошибка: ${formatError(error)}`);
      });
    });

    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.matches('[data-role="dungeon"]')) {
        runtime.state.dungeonId = target.value;
        const dungeon = getCurrentDungeon();
        runtime.state.floorId = dungeon && dungeon.floors[0] ? dungeon.floors[0].id : '';
        runtime.state.selectedCoord = '';
        runtime.state.targetCoord = '';
        runtime.state.routeStartCoord = '';
        runtime.state.route = [];
        runtime.state.routeBlocked = false;
        updateDungeonControls();
        saveStateSoon();
        queueRender('Пещера выбрана');
        scheduleMapLoad(false);
      }
      if (target.matches('[data-role="floor"]')) {
        runtime.state.floorId = target.value;
        runtime.state.selectedCoord = '';
        runtime.state.targetCoord = '';
        runtime.state.routeStartCoord = '';
        runtime.state.route = [];
        runtime.state.routeBlocked = false;
        saveStateSoon();
        queueRender('Этаж выбран');
        scheduleMapLoad(false);
      }
    });

    const mapWrap = root.querySelector('[data-role="mapWrap"]');
    if (mapWrap) {
      mapWrap.addEventListener('pointerdown', handleMapCellPointerDown, true);
      mapWrap.addEventListener('pointerup', handleMapCellPointerUp, true);
      mapWrap.addEventListener('pointercancel', clearMapCellTap, true);
      mapWrap.addEventListener('pointerdown', handleMapPointerDown);
      mapWrap.addEventListener('pointermove', handleMapPointerMove);
      mapWrap.addEventListener('pointerup', handleMapPointerEnd);
      mapWrap.addEventListener('pointercancel', handleMapPointerEnd);
      mapWrap.addEventListener('lostpointercapture', event => {
        clearMapCellTap(event);
        handleMapPointerEnd(event);
      });
    }
  }

  function installResponsiveRender() {
    if (installResponsiveRender.bound) return;
    installResponsiveRender.bound = true;
    const schedule = () => {
      clearTimeout(installResponsiveRender.timer);
      installResponsiveRender.timer = setTimeout(() => {
        if (!runtime.state.visible || !runtime.root) return;
        runtime.renderCenteredKey = '';
        queueRender();
      }, 180);
    };
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
  }

  function handleMapPointerDown(event) {
    if (!event || event.button !== 0) return;
    const target = event.target;
    if (target && target.closest && target.closest('.bkpm-map-hud,.bkpm-event-rail,.bkpm-drawer,select,input,textarea,a')) return;
    if (target && target.closest && target.closest('button:not(.bkpm-cell)')) return;
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (!wrap || !wrap.contains(target)) return;
    runtime.mapDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
      moved: false,
      suppressClickUntil: 0
    };
    wrap.classList.add('is-panning');
    if (typeof wrap.setPointerCapture === 'function') {
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best-effort; dragging still works without it.
      }
    }
    event.preventDefault();
  }

  function handleMapPointerMove(event) {
    const drag = runtime.mapDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (!wrap) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 6) return;
    drag.moved = true;
    wrap.scrollLeft = drag.scrollLeft - dx;
    wrap.scrollTop = drag.scrollTop - dy;
    event.preventDefault();
  }

  function handleMapPointerEnd(event) {
    const drag = runtime.mapDrag;
    if (!drag || event && drag.pointerId !== event.pointerId) return;
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (wrap) {
      wrap.classList.remove('is-panning');
      if (event && typeof wrap.releasePointerCapture === 'function') {
        try {
          wrap.releasePointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture can already be released by the browser.
        }
      }
    }
    runtime.mapDrag = drag.moved
      ? { suppressClickUntil: Date.now() + 250 }
      : null;
  }

  function handleMapCellPointerDown(event) {
    if (!event || event.button !== 0) return;
    const cellButton = getMapCellButtonFromEvent(event);
    if (!cellButton) return;
    runtime.mapCellTap = {
      pointerId: event.pointerId,
      coord: cellButton.getAttribute('data-coord') || '',
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleMapCellPointerUp(event) {
    const tap = runtime.mapCellTap;
    runtime.mapCellTap = null;
    if (!tap || !event || tap.pointerId !== event.pointerId) return;
    if (!tap.coord) return;
    const dx = event.clientX - tap.x;
    const dy = event.clientY - tap.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) return;
    if (runtime.mapDrag && runtime.mapDrag.moved) return;
    const info = selectMapCell(tap.coord, { openDrawer: true });
    if (!info) return;
    runtime.mapCellClickGuard = { coord: tap.coord, until: Date.now() + 350 };
    event.preventDefault();
  }

  function clearMapCellTap(event) {
    if (!event || !runtime.mapCellTap || runtime.mapCellTap.pointerId === event.pointerId) {
      runtime.mapCellTap = null;
    }
  }

  function getMapCellButtonFromEvent(event) {
    const target = event && event.target;
    if (!target || !target.closest) return null;
    const cellButton = target.closest('.bkpm-cell[data-coord]');
    if (!cellButton) return null;
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    return wrap && wrap.contains(cellButton) ? cellButton : null;
  }

  function handlePanelKeyboardEvent(event) {
    if (!event || event.defaultPrevented) return;
    const target = event.target;
    if (target && target.closest && target.closest('select,input,textarea,[contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    if (target && typeof target.blur === 'function') target.blur();
    const token = dungeonTokenFromKey(event);
    const shouldSync = token && shouldTrackDungeonKey(event, token);
    if (shouldSync) prepareDungeonKeyMove(token);
    forwardKeyboardToGame(event);
    if (shouldSync) {
      scheduleGameSync(event.repeat ? 'key-repeat' : 'key', true);
      requestBridgeState(false);
    }
  }

  function forwardKeyboardToGame(sourceEvent) {
    for (const context of getAccessibleContexts()) {
      const doc = context.doc;
      const win = context.win;
      if (!doc || !win) continue;
      const targets = [doc.body, doc.documentElement, doc, win];
      if (doc !== document && doc.activeElement) targets.unshift(doc.activeElement);
      for (const target of targets) {
        try {
          target.dispatchEvent(new win.KeyboardEvent(sourceEvent.type, {
            key: sourceEvent.key,
            code: sourceEvent.code,
            keyCode: sourceEvent.keyCode,
            which: sourceEvent.which,
            repeat: Boolean(sourceEvent.repeat),
            bubbles: true,
            cancelable: true,
            composed: true
          }));
        } catch (error) {
          // Some legacy frames reject synthetic keyboard constructors; ignore safely.
        }
      }
    }
  }

  function refreshPlayerLocation() {
    runtime.pendingMove = null;
    runtime.optimisticMove = null;
    runtime.playerMapCoord = '';
    runtime.lastCenteredCoord = '';
    runtime.bridgeData = null;
    runtime.bridgeAt = 0;
    runtime.contextCache = null;
    requestBridgeState(false);
    renderSyncResult(syncGameState());
    const coord = getCurrentCoord();
    if (coord) {
      setTimeout(() => centerOnCoord(coord, 'smooth'), 80);
      queueRender(`Местоположение обновлено: ${coord}`);
    } else {
      queueRender('Ищу текущее местоположение...');
    }
    scheduleGameSync('refresh-location', true);
  }

  async function handleAction(action, source) {
    if (action === 'toggle') {
      runtime.state.collapsed = !runtime.state.collapsed;
      runtime.root.classList.toggle('is-collapsed', runtime.state.collapsed);
      runtime.root.querySelector('[data-action="toggle"]').textContent = runtime.state.collapsed ? '▣' : '×';
      saveStateSoon();
      return;
    }
    if (action === 'toggle-rail') {
      runtime.state.railOpen = !runtime.state.railOpen;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'refresh-location' || action === 'refresh') {
      refreshPlayerLocation();
      saveStateSoon();
      return;
    }
    if (action === 'toggle-guide') {
      runtime.state.guideCollapsed = !runtime.state.guideCollapsed;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'route-floor') {
      const map = getCurrentMap();
      if (!map) return setStatus('Карта еще не загружена');
      const start = getRouteStartCoord(map);
      runtime.state.targetCoord = '';
      runtime.state.routeStartCoord = start;
      runtime.state.route = buildCoverageRoute(map, start);
      runtime.state.routeBlocked = false;
      runtime.state.drawerView = 'route';
      runtime.state.drawerOpen = true;
      saveStateSoon();
      queueRender(`Маршрут этажа построен: ${runtime.state.route.length} шагов`);
      return;
    }
    if (action === 'route-clear') {
      runtime.state.targetCoord = '';
      runtime.state.routeStartCoord = '';
      runtime.state.route = [];
      runtime.state.routeBlocked = false;
      runtime.state.drawerView = 'route';
      runtime.state.drawerOpen = true;
      saveStateSoon();
      queueRender('Маршрут сброшен');
      return;
    }
    if (action === 'show-cell') {
      runtime.state.drawerView = 'cell';
      runtime.state.drawerOpen = true;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'show-monsters' || action === 'show-caches' || action === 'show-npcs') {
      runtime.state.drawerView = action === 'show-monsters' ? 'monsters' : action === 'show-caches' ? 'caches' : 'npcs';
      runtime.state.drawerOpen = true;
      scheduleGuideLoad(false);
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'category-more') {
      const category = source && source.getAttribute ? source.getAttribute('data-category') : runtime.state.drawerView;
      const key = getCategoryListLimitKey(category);
      runtime.categoryListLimits[key] = (runtime.categoryListLimits[key] || CATEGORY_LIST_INITIAL) + CATEGORY_LIST_STEP;
      queueRender();
      return;
    }
    if (action === 'show-route') {
      runtime.state.drawerView = 'route';
      runtime.state.drawerOpen = true;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'show-guide') {
      runtime.state.drawerView = 'guide';
      runtime.state.drawerOpen = true;
      scheduleGuideLoad(false);
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'show-loot') {
      collectLootFromChat({ force: true, limit: 180 });
      runtime.state.drawerView = 'loot';
      runtime.state.drawerOpen = true;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'loot-clear') {
      runtime.state.lootStats = {};
      runtime.state.lootEvents = [];
      runtime.state.seenLootMessages = {};
      saveStateSoon();
      queueRender('Статистика дропа очищена');
      return;
    }
    if (action === 'drawer-close') {
      runtime.state.drawerOpen = false;
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'zoom-out') {
      setZoomValue(getZoomValue() - 0.1);
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'zoom-reset') {
      setZoomValue(1);
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'zoom-in') {
      setZoomValue(getZoomValue() + 0.1);
      saveStateSoon();
      queueRender();
      return;
    }
    if (action === 'zoom-player') {
      const map = getCurrentMap();
      const coord = getCurrentCoord() || runtime.playerMapCoord || (map ? getStoredPlayerCoordForMap(map) || map.startCoord : '');
      setZoomValue(getPlayerCloseZoomValue(map));
      runtime.renderCenteredKey = '';
      saveStateSoon();
      queueRender();
      requestAnimationFrame(() => centerOnCoord(coord, 'smooth'));
      return;
    }
    if (action === 'zoom-fit') {
      const map = getCurrentMap();
      if (!map) return;
      setZoomValue(getFitMapZoomValue(map));
      runtime.renderCenteredKey = '';
      saveStateSoon();
      queueRender();
      requestAnimationFrame(() => fitMapToView('smooth'));
      return;
    }
    if (action === 'center-current') {
      centerOnCoord(getCurrentCoord());
      return;
    }
    if (action === 'select-coord') {
      const coord = source && source.getAttribute ? source.getAttribute('data-coord') : '';
      selectMapCell(coord, { center: true });
      return;
    }
  }

  function updateDungeonControls() {
    const dungeonSelect = runtime.root.querySelector('[data-role="dungeon"]');
    const floorSelect = runtime.root.querySelector('[data-role="floor"]');
    dungeonSelect.innerHTML = DUNGEONS.map(dungeon => {
      return `<option value="${escapeAttr(dungeon.id)}">${escapeHtml(dungeon.title)}</option>`;
    }).join('');
    dungeonSelect.value = runtime.state.dungeonId;

    const dungeon = getCurrentDungeon();
    floorSelect.innerHTML = dungeon ? dungeon.floors.map(floor => {
      return `<option value="${escapeAttr(floor.id)}">${escapeHtml(floor.title)}</option>`;
    }).join('') : '';
    if (dungeon && !dungeon.floors.some(floor => floor.id === runtime.state.floorId)) {
      runtime.state.floorId = dungeon.floors[0] ? dungeon.floors[0].id : '';
    }
    floorSelect.value = runtime.state.floorId;

  }

  function scheduleMapLoad(force) {
    const dungeon = getCurrentDungeon();
    const floor = getCurrentFloor();
    if (!dungeon || !floor) return;
    const key = mapKey(dungeon.id, floor.id);
    pruneMapCacheToCurrent();
    if (!force && runtime.mapByKey.has(key)) {
      queueRender();
      return;
    }
    if (scheduleMapLoad.frame) cancelAnimationFrame(scheduleMapLoad.frame);
    clearTimeout(scheduleMapLoad.timer);
    scheduleMapLoad.frame = requestAnimationFrame(() => {
      scheduleMapLoad.frame = 0;
      scheduleMapLoad.timer = setTimeout(() => {
        scheduleMapLoad.timer = 0;
        loadCurrentFloor(force).then(map => {
          if (map && getCurrentMapKey() !== key) return;
          if (map) {
            requestBridgeState(true);
            scheduleGameSync('bridge', true);
          }
          if (map) queueRender('Карта загружена');
        });
      }, 0);
    });
  }

  function scheduleGuideLoad(force) {
    const dungeon = getCurrentDungeon();
    if (!dungeon) return;
    if (!force && runtime.guideByDungeon.has(dungeon.id)) return;
    clearTimeout(scheduleGuideLoad.timer);
    scheduleGuideLoad.timer = setTimeout(() => {
      scheduleGuideLoad.timer = 0;
      runWhenIdle(() => {
        loadGuidesForCurrentDungeon(force)
          .then(() => {
            if (runtime.state.visible && runtime.state.drawerOpen) queueRender('Подсказки загружены');
          })
          .catch(error => setStatus(`Подсказки не загружены: ${formatError(error)}`));
      }, 800);
    }, 120);
  }

  function runWhenIdle(task, timeout) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => task(), { timeout: timeout || 1000 });
      return;
    }
    setTimeout(task, 0);
  }

  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async function loadPreloadedMap(dungeon, floor) {
    const file = `data/maps/${preloadMapFileName(dungeon.id, floor.id)}`;
    if (runtime.preloadMapPromises.has(file)) return runtime.preloadMapPromises.get(file);
    const fileUrl = safeRuntimeUrl(file);
    if (!fileUrl) return null;
    const promise = fetch(fileUrl, { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`preload HTTP ${response.status}`);
        return response.json();
      })
      .then(raw => {
        if (!raw || !Array.isArray(raw.cells) || !raw.cells.length) return null;
        return reviveMap(raw, dungeon, floor);
      })
      .catch(error => {
        console.warn('[BKPM] preload map not available', file, error);
        return null;
      })
      .finally(() => runtime.preloadMapPromises.delete(file));
    runtime.preloadMapPromises.set(file, promise);
    return promise;
  }

  function preloadMapFileName(dungeonId, floorId) {
    return `${dungeonId}_${floorId}.json`.replace(/[^a-z0-9_.-]/gi, '_');
  }

  function reviveMap(raw, dungeon, floor) {
    const cells = new Map();
    for (const cell of raw.cells || []) {
      if (!cell || !cell.coord) continue;
      cells.set(cell.coord, Object.assign({
        label: cell.coord,
        floorTitle: floor.title,
        names: [],
        dropItems: [],
        walls: { n: false, e: false, s: false, w: false },
        kind: 'room',
        html: ''
      }, cell));
    }
    return Object.assign({}, raw, {
      dungeonId: dungeon.id,
      dungeonTitle: dungeon.title,
      floorId: floor.id,
      floorTitle: floor.title,
      url: floor.url,
      source: 'preload',
      cells
    });
  }

  async function loadCurrentFloor(force) {
    const dungeon = getCurrentDungeon();
    const floor = getCurrentFloor();
    if (!dungeon || !floor) {
      setStatus('Нет настроенного подземелья');
      return null;
    }

    const key = mapKey(dungeon.id, floor.id);
    if (runtime.mapByKey.has(key)) return runtime.mapByKey.get(key);
    if (runtime.pendingLoads.has(key)) return runtime.pendingLoads.get(key);

    setStatus(`Открываю ${dungeon.title}, ${floor.title}`);
    const promise = loadPreloadedMap(dungeon, floor)
      .then(async preloaded => {
        let loaded = preloaded;
        if (preloaded) {
          loaded = preloaded;
        } else {
          const text = await fetchPaladins(floor.url, force);
          loaded = parsePaladinsMap(text, dungeon, floor);
          loaded.source = 'paladins';
        }
        if (getCurrentMapKey() === key) {
          runtime.mapByKey.set(key, loaded);
          pruneMapCacheToCurrent();
          invalidateCellCaches();
        }
        return loaded;
      })
      .catch(error => {
        setStatus(`Карта не загружена: ${formatError(error)}`);
        return null;
      })
      .finally(() => runtime.pendingLoads.delete(key));
    runtime.pendingLoads.set(key, promise);
    return promise;
  }

  async function loadGuidesForCurrentDungeon(force) {
    const dungeon = getCurrentDungeon();
    if (!dungeon) return null;
    if (!force && runtime.guideByDungeon.has(dungeon.id)) return runtime.guideByDungeon.get(dungeon.id);
    if (!force && runtime.pendingGuideLoads.has(dungeon.id)) return runtime.pendingGuideLoads.get(dungeon.id);

    const promise = (async () => {
      const sources = await Promise.all((dungeon.guides || []).map(async guide => {
        try {
          return { guide, text: await fetchPaladins(guide.url, force), error: null };
        } catch (error) {
          return { guide, text: '', error };
        }
      }));

      const guides = [];
      for (const source of sources) {
        await yieldToBrowser();
        if (source.error) {
          guides.push({
            type: source.guide.type,
            name: source.guide.title,
            normalized: normalizeName(source.guide.title),
            text: `Не удалось загрузить страницу: ${formatError(source.error)}`,
            drops: []
          });
          continue;
        }
        try {
          guides.push(...parseGuidePage(source.text, source.guide));
        } catch (error) {
          guides.push({
            type: source.guide.type,
            name: source.guide.title,
            normalized: normalizeName(source.guide.title),
            text: `Не удалось разобрать страницу: ${formatError(error)}`,
            drops: []
          });
        }
        await yieldToBrowser();
      }
      runtime.guideByDungeon.set(dungeon.id, guides);
      invalidateCellCaches();
      return guides;
    })()
      .finally(() => runtime.pendingGuideLoads.delete(dungeon.id));

    runtime.pendingGuideLoads.set(dungeon.id, promise);
    return promise;
  }

  function fetchPaladins(url, noCache) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'bkpmFetchPaladins', url, noCache: Boolean(noCache) }, response => {
          try {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : 'Пустой ответ загрузчика'));
          return;
        }
        resolve(response.text || '');
          } catch (error) {
            markExtensionContextInvalid(error);
            reject(error);
          }
        });
      } catch (error) {
        markExtensionContextInvalid(error);
        reject(error);
      }
    });
  }

  function parsePaladinsMap(html, dungeon, floor) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cells = new Map();
    let maxCol = 0;
    let maxRow = 0;
    const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_COMMENT);

    while (walker.nextNode()) {
      const comment = walker.currentNode;
      const coord = cleanText(comment.nodeValue || '').toUpperCase();
      if (!/^[A-Z]+[0-9]+$/.test(coord)) continue;

      const element = nextElementAfter(comment);
      if (!element || element.tagName !== 'DIV') continue;
      const className = String(element.getAttribute('class') || '');
      if (!/\bcell/i.test(className) || /\bcellnav/i.test(className) || /\bcellclear/i.test(className)) continue;

      const parsedCoord = parseCoord(coord);
      if (!parsedCoord) continue;
      maxCol = Math.max(maxCol, parsedCoord.col);
      maxRow = Math.max(maxRow, parsedCoord.row);

      const inner = element.innerHTML || '';
      const names = extractCellNames(inner);
      const cell = {
        coord,
        label: coord,
        floorTitle: floor.title,
        col: parsedCoord.col,
        row: parsedCoord.row,
        className,
        walls: wallsFromClass(className),
        names,
        image: extractCellImage(inner, floor.url),
        dropItems: /\/items\/|guide_link/i.test(inner) ? extractDropItems(inner, floor.url) : [],
        kind: classifyCell(className, names, inner),
        html: inner.slice(0, 1200)
      };
      cells.set(coord, cell);
    }

    const map = {
      dungeonId: dungeon.id,
      dungeonTitle: dungeon.title,
      floorId: floor.id,
      floorTitle: floor.title,
      url: floor.url,
      source: 'paladins',
      cells,
      maxCol,
      maxRow,
      loadedAt: new Date().toISOString()
    };
    if (!map.cells.size) {
      throw new Error(`Страница ${floor.url}: клетки карты недоступны`);
    }
    map.startCoord = findStartCoord(map);
    return map;
  }

  function parseGuidePage(html, guide) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (guide.type === 'intro') return parseSectionGuidePage(doc, guide, 'intro');
    if (guide.type === 'floor') return parseSectionGuidePage(doc, guide, 'floor');
    if (guide.type === 'npc') return parseSectionGuidePage(doc, guide, 'npc');
    if (/\/dungeons\/ppk\/guide\/chests\//i.test(guide.url || '')) return parsePpkChestGuidePage(doc, guide);
    if (guide.type === 'monster' || /\/guide\/monsters\//i.test(guide.url || '')) return parsePpkMonsterGuidePage(doc, guide);

    const result = [];
    const rows = Array.from(doc.querySelectorAll('tr'));

    for (const row of rows) {
      const rowHtml = row.innerHTML || '';
      const cells = Array.from(row.children)
        .filter(element => /^(TD|TH)$/i.test(element.tagName))
        .map(element => cleanText(element.textContent));
      if (cells.length < 2) continue;

      const rowText = cleanText(cells.join(' | '));
      if (!rowText || /^(тайники|локации|подробности|бот|уровень|дроп)$/i.test(rowText)) continue;
      const name = cleanGuideName(cells[0]);
      if (!name || name.length < 3 || name.length > 90) continue;
      if (/карты этажей|руководство|информация|подземелья/i.test(name)) continue;

      result.push({
        type: guide.type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        name,
        normalized: normalizeName(name),
        locations: cells[1] || '',
        details: cells.slice(2).join(' '),
        drops: extractDrops(rowText),
        dropItems: extractDropItems(rowHtml, guide.url),
        text: rowText
      });
    }

    if (!result.length) {
      const text = cleanText(doc.body ? doc.body.textContent : html);
      result.push({
        type: guide.type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        name: guide.title,
        normalized: normalizeName(guide.title),
        locations: '',
        details: text.slice(0, 1200),
        drops: extractDrops(text),
        text: text.slice(0, 1400)
      });
    }

    return dedupeGuideEntries(result);
  }

  function parsePpkChestGuidePage(doc, guide) {
    const result = [];
    const rows = Array.from(doc.querySelectorAll('tr')).filter(row => row.querySelector('td[id^="object_id"]'));

    for (const row of rows) {
      const nameElement = row.querySelector('.main_char_parad');
      const name = cleanGuideName(nameElement ? nameElement.textContent : '');
      if (!name || name.length < 3) continue;
      const rowHtml = row.innerHTML || '';
      const rowText = cleanText(row.textContent || '');
      const dropItems = extractDropItems(rowHtml, guide.url);
      result.push({
        type: guide.type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        name,
        normalized: normalizeName(name),
        locations: extractLocations(rowText),
        details: compactText(rowText, 1200),
        drops: extractDrops(rowText),
        dropItems,
        text: rowText
      });
    }

    return dedupeGuideEntries(result);
  }

  function parsePpkMonsterGuidePage(doc, guide) {
    const byName = new Map();
    const nodes = Array.from(doc.querySelectorAll('.bot_name_id'));

    for (const node of nodes) {
      const name = cleanGuideName(extractDirectText(node) || node.textContent || '');
      if (!name || name.length < 3) continue;
      const container = node.closest('.spoiler_monsters') || node.closest('td') || node.parentElement;
      if (!container) continue;
      const dropBox = container.querySelector('.bot_drop') || container;
      const dropItems = extractDropItems(dropBox.innerHTML || container.innerHTML || '', guide.url);
      const image = extractGuideImage(container, guide.url);
      const details = compactText(container.textContent || '', 1400);
      const key = normalizeName(name);
      const old = byName.get(key);
      if (old) {
        old.dropItems = mergeDropItems(old.dropItems, dropItems);
        if (!old.image && image) old.image = image;
        old.details = old.details.length >= details.length ? old.details : details;
        old.text = old.details;
        continue;
      }
      byName.set(key, {
        type: guide.type,
        sourceTitle: guide.title,
        sourceUrl: `${guide.url}#${escapeHashId(container.closest('[id]') ? container.closest('[id]').id : key)}`,
        name,
        normalized: key,
        locations: '',
        details,
        drops: extractDrops(details),
        dropItems,
        image,
        text: details
      });
    }

    return Array.from(byName.values());
  }

  function parseSectionGuidePage(doc, guide, type) {
    const result = [];
    const sections = Array.from(doc.querySelectorAll('p.sub-section, p.section, h1, h2, h3'));

    for (const section of sections) {
      const title = cleanText(section.textContent);
      if (!isUsefulSectionTitle(title)) continue;
      const details = compactText(collectSectionText(section), 2200);
      if (!details || details.length < 12) continue;
      result.push({
        type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        category: guide.title,
        name: title,
        normalized: normalizeName(title),
        locations: extractLocations(details),
        details,
        drops: extractDrops(details),
        text: details
      });
    }

    const articleText = compactText(extractArticleText(doc), 2400);
    if (!result.length && articleText) {
      const title = cleanText(doc.querySelector('title') ? doc.querySelector('title').textContent : guide.title)
        .replace(/\s*»\s*.*$/, '') || guide.title;
      result.push({
        type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        category: guide.title,
        name: title,
        normalized: normalizeName(title),
        locations: extractLocations(articleText),
        details: articleText,
        drops: extractDrops(articleText),
        text: articleText
      });
    }

    const botNames = extractBotNames(doc);
    for (const botName of botNames) {
      if (result.some(entry => normalizeName(entry.name) === normalizeName(botName))) continue;
      const text = compactText(findTextAroundName(doc, botName) || articleText, 1600);
      result.push({
        type,
        sourceTitle: guide.title,
        sourceUrl: guide.url,
        category: guide.title,
        name: botName,
        normalized: normalizeName(botName),
        locations: extractLocations(text),
        details: text,
        drops: extractDrops(text),
        text
      });
    }

    return dedupeGuideEntries(result);
  }

  function collectSectionText(section) {
    const chunks = [cleanText(section.textContent)];
    let node = section.nextSibling;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        if (element.matches && element.matches('p.sub-section, p.section, h1, h2, h3, .author_infocombats')) break;
      }
      const text = cleanText(node.textContent || '');
      if (text) chunks.push(text);
      node = node.nextSibling;
    }
    return chunks.join(' ');
  }

  function extractArticleText(doc) {
    const bodyText = cleanText(doc.body ? doc.body.textContent : '');
    if (!bodyText) return '';
    const startMarkers = ['» Подземелья » Грибница', 'Подземелья » Грибница'];
    let start = -1;
    for (const marker of startMarkers) {
      start = bodyText.indexOf(marker);
      if (start >= 0) break;
    }
    if (start < 0) start = Math.max(0, bodyText.indexOf('Грибница'));
    let end = bodyText.indexOf('Автор:', start);
    if (end < 0) end = bodyText.indexOf('Опубликовано:', start);
    if (end < 0) end = Math.min(bodyText.length, start + 5000);
    return bodyText.slice(start, end).trim();
  }

  function extractBotNames(doc) {
    const names = new Set();
    const selectors = [
      '.bot_name',
      '.kukla_bot_name b',
      '.main_char_dungeon b',
      'a[href*="/handbook/npc/"]'
    ];
    for (const selector of selectors) {
      for (const element of Array.from(doc.querySelectorAll(selector))) {
        const name = cleanObjectName(element.textContent);
        if (name) names.add(name);
      }
    }
    return Array.from(names).slice(0, 20);
  }

  function findTextAroundName(doc, name) {
    const text = extractArticleText(doc);
    const index = normalizeName(text).indexOf(normalizeName(name));
    if (index < 0) return text;
    return text.slice(Math.max(0, index - 300), Math.min(text.length, index + 1700));
  }

  function isUsefulSectionTitle(title) {
    if (!title || title.length < 3 || title.length > 120) return false;
    if (/каталог|справочник|полезные ссылки|последние обновления/i.test(title)) return false;
    return true;
  }

  function extractLocations(text) {
    const matches = cleanText(text).match(/(?:\d+\s+этаж|клетка\s+[A-ZА-Я]+\d+|[A-ZА-Я]+\d+)/gi);
    if (!matches) return '';
    return Array.from(new Set(matches.map(item => item.trim()))).slice(0, 8).join(', ');
  }

  function dedupeGuideEntries(entries) {
    const map = new Map();
    for (const entry of entries) {
      const key = `${entry.type}|${entry.normalized}|${normalizeName(entry.locations)}|${normalizeName(entry.details).slice(0, 60)}`;
      if (!map.has(key)) map.set(key, entry);
    }
    return Array.from(map.values());
  }

  function mergeDropItems(a, b) {
    const result = [];
    const seen = new Set();
    for (const item of [].concat(a || [], b || [])) {
      if (!item || !item.name) continue;
      const key = `${normalizeName(item.name)}|${item.href || ''}|${item.image || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function extractGuideImage(element, baseUrl) {
    if (!element) return '';
    const preferred = element.querySelector('.bot_obraz img[src], .bot_image img[src], img[src*="/i/chars/"], img[src*="/i/monsters/"]');
    const candidates = preferred ? [preferred] : Array.from(element.querySelectorAll('img[src]'));
    for (const img of candidates) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      if (/\/i\/items\//i.test(src)) continue;
      if (/\/images\/(?:menu|header|icons)\//i.test(src)) continue;
      return absolutizeUrl(src, baseUrl);
    }
    return '';
  }

  function extractCellImage(html, baseUrl) {
    const raw = String(html || '');
    if (!raw || !/<img/i.test(raw)) return '';
    const embedded = raw.match(/(?:src=|src\\?=)(["']?)(\/?(?:i\/chars|i\/monsters|i\/objects|items_db\/map_images\/objects)[^"'\s>)]*\.(?:gif|png|jpe?g|webp))/i);
    if (embedded && embedded[2]) return absolutizeUrl(embedded[2], baseUrl);
    const imagePattern = /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;
    let match;
    while ((match = imagePattern.exec(raw)) !== null) {
      const src = match[1] || '';
      if (!src) continue;
      if (/\/i\/items\//i.test(src)) continue;
      if (/\/images\/(?:menu|header|icons)\//i.test(src)) continue;
      return absolutizeUrl(src, baseUrl);
    }
    return '';
  }

  function extractDirectText(element) {
    if (!element || !element.childNodes) return '';
    const text = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent || '')
      .join(' ');
    return cleanText(text);
  }

  function escapeHashId(value) {
    return String(value || '')
      .replace(/[^\w\-а-яё]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function render() {
    runtime.renderQueued = false;
    const root = runtime.root;
    if (!root) return;

    root.classList.toggle('is-collapsed', runtime.state.collapsed);
    root.classList.toggle('is-hidden', !runtime.state.visible);
    root.classList.toggle('is-rail-open', runtime.state.railOpen);
    const map = getCurrentMap();
    const guide = runtime.guideByDungeon.get(runtime.state.dungeonId) || [];
    const mapEl = root.querySelector('[data-role="map"]');
    const mapWrapEl = root.querySelector('[data-role="mapWrap"]');
    const drawerEl = root.querySelector('[data-role="drawer"]');
    const zoomValue = getZoomValue();
    updateZoomControl(root, zoomValue);
    if (mapWrapEl) mapWrapEl.classList.toggle('is-live', Boolean(map && map.source === 'live'));

    if (!map) {
      mapEl.innerHTML = '<div class="bkpm-empty">Карта еще не загружена.</div>';
      drawerEl.classList.toggle('is-open', runtime.state.drawerOpen);
      drawerEl.classList.toggle('is-category', isCategoryDrawerView(runtime.state.drawerView));
      setDrawerHtml(drawerEl, runtime.state.drawerOpen ? renderDrawer(null, guide) : '', getDrawerRenderKey(null));
      updateInfoTabs();
      updateStatusLine();
      return;
    }

    const currentCoord = getCurrentCoord();
    if (currentCoord && map.cells.has(currentCoord) && !isVisited(map, currentCoord)) {
      markVisited(map, currentCoord);
      saveStateSoon();
    }
    const routeSet = new Set(runtime.state.route || []);
    const visitedSet = getVisitedSet(map);
    const clearedMonsterSet = getClearedMonsterSet(map);
    const cellSize = Math.round(getAutoCellSize(map) * zoomValue);
    const cssSize = clamp(cellSize, CELL_SIZE_MIN, CELL_SIZE_MAX);
    mapEl.style.setProperty('--bkpm-cell', `${cssSize}px`);
    mapEl.classList.toggle('is-live', map.source === 'live');
    mapEl.style.gridTemplateColumns = `repeat(${map.maxCol}, var(--bkpm-cell))`;
    mapEl.style.gridTemplateRows = `repeat(${map.maxRow}, var(--bkpm-cell))`;

    const cells = Array.from(map.cells.values()).sort((a, b) => a.row - b.row || a.col - b.col);
    const cellsHtml = cells.map(cell => renderCell(cell, {
      currentCoord,
      routeSet,
      visitedSet,
      clearedMonsterSet
    })).join('');
    mapEl.innerHTML = cellsHtml + renderPlayerOverlay(map, currentCoord);
    runtime.renderedMapKey = mapKey(map.dungeonId, map.floorId);
    runtime.renderedCoord = currentCoord || '';
    const centerCoord = currentCoord || (!hasMinimapTiles(runtime.game) ? getStoredPlayerCoordForMap(map) : '') || getPrimaryDescentCoord(map) || map.startCoord;
    const centerKey = `${map.dungeonId}:${map.floorId}:${centerCoord}:${zoomValue}`;
    if (centerCoord && runtime.renderCenteredKey !== centerKey) {
      runtime.renderCenteredKey = centerKey;
      requestAnimationFrame(() => centerMapView(centerCoord));
    }

    drawerEl.classList.toggle('is-open', runtime.state.drawerOpen);
    drawerEl.classList.toggle('is-category', isCategoryDrawerView(runtime.state.drawerView));
    setDrawerHtml(drawerEl, runtime.state.drawerOpen ? renderDrawer(map, guide) : '', getDrawerRenderKey(map));
    updateInfoTabs();
    updateStatusLine();
  }

  function getDrawerRenderKey(map) {
    const mapKeyPart = map ? `${map.dungeonId}:${map.floorId}` : 'no-map';
    return `${mapKeyPart}:${runtime.state.drawerOpen ? 'open' : 'closed'}:${runtime.state.drawerView || 'cell'}`;
  }

  function setDrawerHtml(drawerEl, html, key) {
    if (!drawerEl) return;
    const next = String(html || '');
    const renderKey = String(key || '');
    if (drawerEl.__bkpmDrawerHtml === next && drawerEl.dataset.bkpmDrawerKey === renderKey) return;
    const scroll = captureDrawerScroll(drawerEl);
    drawerEl.innerHTML = next;
    drawerEl.__bkpmDrawerHtml = next;
    drawerEl.dataset.bkpmDrawerKey = renderKey;
    restoreDrawerScroll(drawerEl, scroll, renderKey);
  }

  function captureDrawerScroll(drawerEl) {
    const body = drawerEl && drawerEl.querySelector ? drawerEl.querySelector('.bkpm-drawer-body') : null;
    return {
      key: drawerEl && drawerEl.dataset ? drawerEl.dataset.bkpmDrawerKey || '' : '',
      top: body ? body.scrollTop : 0,
      left: body ? body.scrollLeft : 0
    };
  }

  function restoreDrawerScroll(drawerEl, snapshot, key) {
    if (!snapshot || snapshot.key !== String(key || '')) return;
    const body = drawerEl && drawerEl.querySelector ? drawerEl.querySelector('.bkpm-drawer-body') : null;
    if (!body) return;
    body.scrollTop = snapshot.top || 0;
    body.scrollLeft = snapshot.left || 0;
    requestAnimationFrame(() => {
      if (!drawerEl.isConnected) return;
      body.scrollTop = snapshot.top || 0;
      body.scrollLeft = snapshot.left || 0;
    });
  }

  function isCategoryDrawerView(view) {
    return view === 'monsters' || view === 'caches' || view === 'npcs';
  }

  function renderDrawer(map, guide) {
    const view = runtime.state.drawerView || 'cell';
    const title = view === 'route'
      ? 'Маршрут'
      : view === 'guide'
        ? 'Рыцарство и важное'
        : view === 'loot'
          ? 'Дроп похода'
          : view === 'monsters'
            ? 'Монстры'
            : view === 'caches'
              ? 'Сундуки и тайники'
              : view === 'npcs'
                ? 'NPC и люди'
                : 'Клетка';
    const body = view === 'route'
      ? renderRouteDetails(map)
      : view === 'guide'
        ? renderGuideBox(guide)
      : view === 'loot'
        ? renderLootStats()
        : view === 'monsters' || view === 'caches' || view === 'npcs'
            ? renderMapCategoryList(map, guide, view)
            : renderCellDetails(map, guide);

    return `<div class="bkpm-drawer-head">
      <b>${escapeHtml(title)}</b>
      <button type="button" class="bkpm-drawer-hide" data-action="drawer-close" aria-label="Скрыть панель">Скрыть</button>
    </div>
    <div class="bkpm-drawer-body">${body}</div>`;
  }

  function renderGuideBox(entries) {
    const important = getImportantGuideEntries(entries).slice(0, 6);
    if (!important.length) {
      return '<div class="bkpm-muted">Важные заметки пока не загружены. Открой вкладку позже или обнови карту.</div>';
    }
    return `<div class="bkpm-guide-body is-cards">${important.map(entry => renderGuideInfoCard(entry)).join('')}</div>`;
  }

  function getImportantGuideEntries(entries) {
    const source = Array.isArray(entries) ? entries : [];
    const important = source.filter(entry => {
      if (!entry || entry.type !== 'intro') return false;
      const text = normalizeName(`${entry.name || ''} ${entry.category || ''} ${entry.details || entry.text || ''}`);
      return /рыцар|награды|вход|валюта|задани|репутац|изумруд|алчущ|бурун/.test(text);
    });
    return dedupeGuideEntries(important).sort((a, b) => guideEntryPriority(b) - guideEntryPriority(a));
  }

  function guideEntryPriority(entry) {
    const text = normalizeName(`${entry && entry.name ? entry.name : ''} ${entry && entry.details ? entry.details : ''}`);
    let score = 0;
    if (/рыцар|репутац|награ/.test(text)) score += 40;
    if (/задани|квест/.test(text)) score += 30;
    if (/вход|проход|спуск/.test(text)) score += 20;
    if (/валюта|изумруд|грибоч/.test(text)) score += 10;
    return score;
  }

  function renderGuideInfoCard(entry) {
    const summary = summarizeGuideText(entry.details || entry.text || '', entry.name, 210);
    const bullets = buildInfoBullets(entry.details || entry.text || '', entry.name, 5)
      .filter(item => normalizeName(item) !== normalizeName(summary))
      .slice(0, 4);
    const tags = [
      entry.category || entry.sourceTitle || '',
      entry.locations ? `Точки: ${entry.locations}` : ''
    ].filter(Boolean);
    return `<article class="bkpm-guide-section bkpm-info-card">
      <div class="bkpm-info-card-head">
        <b>${escapeHtml(entry.name || 'Важно')}</b>
        ${tags.length ? `<span>${escapeHtml(tags[0])}</span>` : ''}
      </div>
      ${summary ? `<p class="bkpm-guide-summary">${escapeHtml(summary)}</p>` : ''}
      ${bullets.length ? `<ul class="bkpm-guide-steps">${bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      ${tags.length > 1 ? `<div class="bkpm-mini-chip-row">${tags.slice(1).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
    </article>`;
  }

  function summarizeGuideText(text, title, limit) {
    const clean = compactText(String(text || ''), Math.max(260, limit || 220))
      .replace(new RegExp(`^${escapeRegExp(cleanText(title || ''))}\\s*`, 'i'), '')
      .trim();
    const sentence = splitGuideSentences(clean).find(item => item.length >= 24) || clean;
    return compactText(sentence, limit || 220);
  }

  function buildInfoBullets(text, title, limit) {
    const titleText = normalizeName(title || '');
    const sentences = splitGuideSentences(text)
      .map(item => cleanText(item).replace(/^[-•]\s*/, ''))
      .filter(item => item.length >= 18)
      .filter(item => normalizeName(item) !== titleText)
      .filter(item => !/^автор:|^опубликовано:/i.test(item));
    const picked = [];
    const seen = new Set();
    for (const sentence of sentences) {
      const key = normalizeName(sentence).slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picked.push(compactText(sentence, 170));
      if (picked.length >= (limit || 4)) break;
    }
    return picked;
  }

  function splitGuideSentences(text) {
    return String(text || '')
      .replace(/\s*[•·]\s*/g, '. ')
      .replace(/\s+[-–—]\s+/g, '. ')
      .split(/(?<=[.!?])\s+|\s{2,}|;\s+/)
      .map(item => cleanText(item))
      .filter(Boolean);
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function collectLootFromChat(options) {
    const settings = Object.assign({ limit: 120, force: false }, options || {});
    const now = Date.now();
    if (!settings.force && now - runtime.lastLootScan < 2500) return false;
    runtime.lastLootScan = now;
    let changed = false;
    for (const context of getAccessibleContexts()) {
      const doc = context.doc;
      if (!doc) continue;
      const allMessages = Array.from(doc.querySelectorAll('.Chat, .ct_message, .ct_chatfilter_marked'));
      const messages = allMessages.slice(-settings.limit);
      for (const message of messages) {
        const text = cleanText(message.textContent || '');
        if (!/поднял(?:а)?\s+предмет/i.test(text)) continue;
        const item = extractPickedLootName(text);
        if (!item) continue;
        const key = hashText(text);
        if (runtime.state.seenLootMessages[key]) continue;
        runtime.state.seenLootMessages[key] = Date.now();
        rememberLootItem(item, text);
        changed = true;
      }
    }
    if (changed) {
      runtime.state.lootEvents = runtime.state.lootEvents.slice(-300);
      saveStateSoon();
    }
    return changed;
  }

  function extractPickedLootName(text) {
    const value = cleanText(text);
    const quoted = value.match(/поднял(?:а)?\s+предмет\s+["'«]([^"'»]+)["'»]/i);
    if (quoted && quoted[1]) return cleanText(quoted[1]).slice(0, 140);
    const fallback = value.match(/поднял(?:а)?\s+предмет\s+(.+)$/i);
    return fallback && fallback[1] ? cleanText(fallback[1]).replace(/\[копировать]$/i, '').slice(0, 140) : '';
  }

  function rememberLootItem(name, sourceText) {
    const cleanName = cleanText(name);
    const key = canonicalName(cleanName);
    if (!key) return;
    const now = new Date().toISOString();
    const old = runtime.state.lootStats[key] || {
      name: cleanName,
      count: 0,
      firstAt: now,
      lastAt: now
    };
    old.name = old.name || cleanName;
    old.count += 1;
    old.lastAt = now;
    runtime.state.lootStats[key] = old;
    runtime.state.lootEvents.push({
      at: now,
      time: extractChatTime(sourceText),
      name: cleanName
    });
  }

  function extractChatTime(text) {
    const match = String(text || '').match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
    return match ? match[0] : '';
  }

  function renderLootStats() {
    collectLootFromChat({ limit: 120 });
    const stats = Object.values(runtime.state.lootStats || {})
      .sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.name).localeCompare(String(b.name), 'ru'));
    const total = stats.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const head = `<div class="bkpm-loot-head">
      <div><b>${total}</b><span>поднято предметов</span></div>
      <button type="button" data-action="loot-clear">Сбросить дроп</button>
    </div>`;
    if (!stats.length) {
      return `${head}<div class="bkpm-muted">Пока нет поднятого дропа. Учитываются только сообщения чата вида «поднял предмет "..."».</div>`;
    }
    const rows = stats.slice(0, 80).map(item => {
      const known = findKnownDropItem(item.name);
      const image = known && known.image ? `<img src="${escapeAttr(known.image)}" alt="" loading="lazy" decoding="async">` : '<span class="bkpm-loot-empty-icon"></span>';
      const label = known && known.href
        ? `<a href="${escapeAttr(known.href)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>`
        : `<span>${escapeHtml(item.name)}</span>`;
      return `<div class="bkpm-loot-row">
        ${image}
        <div>${label}<small>последний раз: ${escapeHtml(formatLootTime(item.lastAt))}</small></div>
        <b>${Number(item.count) || 0}</b>
      </div>`;
    }).join('');
    const events = (runtime.state.lootEvents || []).slice(-8).reverse().map(event => {
      return `<span><b>${escapeHtml(event.time || formatLootTime(event.at))}</b>${escapeHtml(event.name)}</span>`;
    }).join('');
    return `${head}<div class="bkpm-loot-list">${rows}</div><div class="bkpm-loot-events">${events}</div>`;
  }

  function findKnownDropItem(name) {
    const target = canonicalName(name);
    if (!target) return null;
    const guides = runtime.guideByDungeon.get(runtime.state.dungeonId) || [];
    for (const entry of guides) {
      for (const item of Array.isArray(entry.dropItems) ? entry.dropItems : []) {
        const itemName = canonicalName(item.name);
        if (itemName && (itemName === target || itemName.includes(target) || target.includes(itemName))) return item;
      }
    }
    return null;
  }

  function formatLootTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderCell(cell, context) {
    const eventPreview = getFastCellPreview(cell);
    const descent = isDescentCell(cell);
    const boss = isBossCell(cell);
    const classes = [
      'bkpm-cell',
      `kind-${cell.kind}`,
      cell.walls.n ? 'wall-n' : '',
      cell.walls.e ? 'wall-e' : '',
      cell.walls.s ? 'wall-s' : '',
      cell.walls.w ? 'wall-w' : '',
      context.currentCoord === cell.coord ? 'is-current' : '',
      runtime.state.selectedCoord === cell.coord ? 'is-selected' : '',
      runtime.state.targetCoord === cell.coord ? 'is-target' : '',
      runtime.state.routeBlocked && runtime.state.targetCoord === cell.coord ? 'is-unreachable' : '',
      context.routeSet.has(cell.coord) ? 'is-route' : '',
      context.visitedSet.has(cell.coord) ? 'is-visited' : '',
      context.clearedMonsterSet && context.clearedMonsterSet.has(cell.coord) ? 'is-cleared-monster' : '',
      descent ? 'has-descent' : '',
      boss ? 'has-boss' : '',
      cell.names.length ? 'has-name' : ''
    ].filter(Boolean).join(' ');
    const shortName = eventPreview.name || (cell.names[0] ? shortLabel(cell.names[0]) : '');
    const iconSrc = getCellIconSrc(cell, eventPreview);
    return `<button type="button" tabindex="-1" class="${classes}" data-coord="${escapeAttr(cell.coord)}" style="grid-column:${cell.col};grid-row:${cell.row}">
      ${iconSrc ? `<span class="bkpm-cell-event-icon"><img src="${escapeAttr(iconSrc)}" alt="${escapeAttr(shortName || labelCellKind(cell.kind))}" loading="lazy" decoding="async"></span>` : ''}
      ${context.clearedMonsterSet && context.clearedMonsterSet.has(cell.coord) ? '<span class="bkpm-clear-cross" aria-label="Зачищено"></span>' : ''}
      ${boss ? '<span class="bkpm-boss-badge" aria-label="Босс">★</span>' : ''}
      <span class="bkpm-coord">${escapeHtml(cell.label || cell.coord)}</span>
      ${shortName ? `<span class="bkpm-cell-name">${escapeHtml(shortName)}</span>` : ''}
      ${iconSrc ? '' : renderKindMarker(cell)}
    </button>`;
  }

  function getCellIconSrc(cell, preview) {
    if (cell && ['monster', 'npc', 'object'].includes(cell.kind) && preview && preview.image && !isGenericCellImage(preview.image)) return preview.image;
    return '';
  }

  function isGenericCellImage(url) {
    const value = String(url || '').toLowerCase();
    return /assets\/icons\/|npc-human|nav-pin|nav-compass|player-glow|defense-shield|loot-bag|loot-coins/.test(value);
  }

  function getFastCellPreview(cell) {
    if (!cell || !['monster', 'npc', 'object', 'portal', 'enter'].includes(cell.kind)) return { name: '', image: '' };
    const name = cell.names && cell.names[0] ? shortLabel(cell.names[0]) : '';
    return { name, image: cell.image || '' };
  }

  function getCellMapIcon(cell, preview) {
    if (!cell) return '';
    const text = normalizeName(`${cell.kind || ''} ${(cell.names || []).join(' ')} ${(preview && preview.name) || ''}`);
    if (cell.kind === 'monster') {
      if (/паук|пауч|spider/.test(text)) return 'spider';
      if (/волк|звер|рогонос|гусениц|черв|мокриц|beast/.test(text)) return 'beast';
      if (/скелет|мертв|мёртв|череп|зомби|skull/.test(text)) return 'skull';
      return 'demon';
    }
    if (cell.kind === 'npc') return 'npc';
    if (cell.kind === 'portal' || cell.kind === 'enter') return cell.kind === 'enter' ? 'pin' : 'compass';
    if (cell.kind === 'object') {
      if (/сундук|тайник|ларец|хранилищ|chest|box/.test(text)) return 'chest';
      if (/камен|плит|руда|кристалл|нарост|корн|гриб|cache/.test(text)) return 'cache';
      if (/дроп|мешок|монет|bag|coin/.test(text)) return 'bag';
      return 'lockbox';
    }
    return '';
  }

  function renderKindMarker(cell) {
    const data = {
      monster: ['monster', 'M', 'Монстр'],
      npc: ['npc', 'N', 'NPC'],
      object: ['object', '!', 'Действие'],
      portal: ['portal', '↔', 'Переход'],
      enter: ['enter', '↓', 'Вход']
    }[cell.kind];
    if (!data) return '';
    return `<span class="bkpm-kind-marker ${escapeAttr(data[0])}" aria-label="${escapeAttr(data[2])}">${escapeHtml(data[1])}</span>`;
  }

  function getCellSearchText(cell) {
    if (!cell) return '';
    return normalizeName([
      cell.kind || '',
      cell.className || '',
      cell.roomName || '',
      cell.path || '',
      cell.image || '',
      Array.isArray(cell.names) ? cell.names.join(' ') : '',
      cell.html || ''
    ].join(' '));
  }

  function isDescentCell(cell) {
    if (!cell) return false;
    if (cell.kind === 'portal' || cell.kind === 'enter') return true;
    const text = getCellSearchText(cell);
    return /спуск|лестниц|вниз|портал|переход|выход|этаж|gguphole|hole|door|stairs/.test(text);
  }

  function isBossCell(cell) {
    if (!cell || cell.kind !== 'monster') return false;
    const text = getCellSearchText(cell);
    return /босс|королев|король|матк|владык|повелител|хозяин|царь|главар|boss|queen|king/.test(text);
  }

  function getCellDropItems(cell, guide) {
    return getCellMeta(cell, guide).dropItems;
  }

  function getCellMeta(cell, guide) {
    if (!cell) return { matches: [], dropItems: [], hasDrops: false };
    const entries = guide || [];
    const scope = `${runtime.state.dungeonId}|${runtime.state.floorId}|${entries.length}|${runtime.cacheStamp}`;
    if (runtime.cellMetaScope !== scope) {
      runtime.cellMetaScope = scope;
      runtime.cellMetaCache.clear();
    }
    const key = getCellCacheKey(cell);
    const cached = runtime.cellMetaCache.get(key);
    if (cached) return cached;
    const items = [];
    for (const item of cell && Array.isArray(cell.dropItems) ? cell.dropItems : []) items.push(item);
    let matches = matchGuideEntriesIndexed(cell, entries)
      .filter(isCellSpecificGuideEntry)
      .filter(entry => guideEntryMatchesCellKind(cell, entry));
    if (!matches.length) {
      matches = findGuideEntriesByVisualOrName(cell, entries)
        .filter(isCellSpecificGuideEntry)
        .filter(entry => guideEntryMatchesCellKind(cell, entry));
    }
    for (const entry of matches) {
      for (const item of Array.isArray(entry.dropItems) ? entry.dropItems : []) items.push(item);
    }
    const dropItems = mergeDropItems(items, []);
    const hasDrops = Boolean(dropItems.length) || Boolean(cell.dropItems && cell.dropItems.length) || matches.some(entry => (entry.dropItems && entry.dropItems.length) || (entry.drops && entry.drops.length));
    const meta = { matches, dropItems, hasDrops };
    runtime.cellMetaCache.set(key, meta);
    return meta;
  }

  function isCellSpecificGuideEntry(entry) {
    if (!entry || !['monster', 'object', 'npc'].includes(entry.type)) return false;
    if (isNoiseGuideEntry(entry)) return false;
    const hasVisualOrDrop = Boolean(entry.image) ||
      Boolean(entry.dropItems && entry.dropItems.length) ||
      Boolean(entry.drops && entry.drops.length);
    const sameAsSource = normalizeName(entry.name) === normalizeName(entry.sourceTitle || '');
    if (sameAsSource && !hasVisualOrDrop) return false;
    return true;
  }

  function isNoiseGuideEntry(entry) {
    const name = normalizeName(entry && entry.name ? entry.name : '');
    const text = normalizeName(`${entry && entry.name ? entry.name : ''} ${entry && entry.sourceTitle ? entry.sourceTitle : ''}`);
    if (!name && !text) return false;
    return /(?:\u043a\u0430\u0442\u0430\u043b\u043e\u0433\s+\u0434\u0438\u0430\u043b\u043e\u0433\u043e\u0432\u044b\u0445\s+\u0431\u043e\u0442\u043e\u0432|\u0434\u0438\u0430\u043b\u043e\u0433\u043e\u0432\u044b\u0435\s+\u0431\u043e\u0442\u044b|dialog\s*bots?|npc\s*catalog)/i.test(text);
  }

  function guideEntryMatchesCellKind(cell, entry) {
    if (!cell || !entry) return false;
    if (cell.kind === 'monster') return entry.type === 'monster';
    if (cell.kind === 'npc') return entry.type === 'npc';
    if (cell.kind === 'object') return entry.type === 'object';
    if (cell.kind === 'portal' || cell.kind === 'enter') return false;
    return ['monster', 'object', 'npc'].includes(entry.type);
  }

  function findGuideEntriesByVisualOrName(cell, entries) {
    if (!cell || !entries || !entries.length) return [];
    const type = cell.kind === 'monster' ? 'monster' : cell.kind === 'npc' ? 'npc' : cell.kind === 'object' ? 'object' : '';
    if (!type) return [];
    const cellImageKey = imageFingerprint(cell.image || '');
    const names = (cell.names || []).map(guideComparableName).filter(Boolean);
    const found = [];
    const seen = new Set();

    for (const entry of entries) {
      if (!entry || entry.type !== type) continue;
      const key = `${entry.type}|${entry.normalized || normalizeName(entry.name)}|${entry.image || ''}`;
      if (seen.has(key)) continue;

      const entryImageKey = imageFingerprint(entry.image || '');
      const imageMatch = cellImageKey && entryImageKey && cellImageKey === entryImageKey;
      const entryName = guideComparableName(entry.name || entry.normalized || '');
      const exactNameMatch = entryName && names.some(name => name === entryName || name.includes(entryName) || entryName.includes(name));

      if (!imageMatch && !exactNameMatch) continue;
      seen.add(key);
      found.push(entry);
      if (imageMatch && found.length >= 3) break;
      if (found.length >= 6) break;
    }
    return dedupeGuideEntries(found).slice(0, 6);
  }

  function guideComparableName(value) {
    return canonicalName(value)
      .replace(/\s+\[[^\]]+\]$/g, '')
      .replace(/\s+\([^)]*\)$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function importantNameTokens(value) {
    return guideComparableName(value)
      .split(/\s+/)
      .filter(token => token.length >= 5 && !/^\d+$/.test(token));
  }

  function imageFingerprint(url) {
    const value = String(url || '').toLowerCase().split(/[?#]/)[0].replace(/\\/g, '/');
    if (!value) return '';
    const parts = value.split('/').filter(Boolean);
    const last = (parts[parts.length - 1] || '').replace(/\.(gif|png|jpe?g|webp)$/i, '');
    return last.replace(/[^a-z0-9_-]/gi, '');
  }

  function getCellImageKeys(cell) {
    const keys = new Set();
    const add = value => {
      const key = imageFingerprint(value);
      if (key) keys.add(key);
    };
    if (!cell) return [];
    add(cell.image || '');
    for (const item of Array.isArray(cell.dropItems) ? cell.dropItems : []) add(item && item.image ? item.image : '');
    return Array.from(keys);
  }

  function buildMapImageIndex(map) {
    const index = new Map();
    if (!map || !map.cells) return index;
    for (const cell of map.cells.values()) {
      for (const key of getCellImageKeys(cell)) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(cell);
      }
    }
    return index;
  }

  function getMapImageIndex(map) {
    if (!map) return new Map();
    const scope = `${map.dungeonId}:${map.floorId}:${runtime.cacheStamp}`;
    if (runtime.mapImageIndex && runtime.mapImageIndexScope === scope) return runtime.mapImageIndex;
    runtime.mapImageIndex = buildMapImageIndex(map);
    runtime.mapImageIndexScope = scope;
    return runtime.mapImageIndex;
  }

  function scoreSceneCandidate(scene, map, coord, imageIndex) {
    const result = { score: 0, matches: 0, anchors: 0 };
    if (!scene || !scene.images || !scene.images.length || !map || !map.cells || !coord) return result;
    const center = map.cells.get(coord);
    if (!center || !Number.isFinite(center.col) || !Number.isFinite(center.row)) return result;
    const index = imageIndex || buildMapImageIndex(map);

    for (const key of scene.images) {
      const cells = index.get(key);
      if (!cells || !cells.length) continue;
      if (cells.length > 12) continue;
      result.anchors++;

      let bestDistance = Infinity;
      for (const cell of cells) {
        if (!cell || !Number.isFinite(cell.col) || !Number.isFinite(cell.row)) continue;
        const distance = Math.abs(cell.col - center.col) + Math.abs(cell.row - center.row);
        if (distance < bestDistance) bestDistance = distance;
      }
      if (!Number.isFinite(bestDistance) || bestDistance > SCENE_ANCHOR_RADIUS) continue;

      const rarity = cells.length <= 1 ? 95 : cells.length <= 3 ? 70 : cells.length <= 8 ? 40 : 20;
      const count = scene.counts && scene.counts[key] ? Math.min(3, scene.counts[key]) : 1;
      result.score += rarity + Math.max(0, SCENE_ANCHOR_RADIUS - bestDistance) * 4 + (count - 1) * 8;
      result.matches++;
    }

    return result;
  }

  function getCellCacheKey(cell) {
    const names = Array.isArray(cell.names) ? cell.names.join('|') : '';
    const drops = Array.isArray(cell.dropItems) ? cell.dropItems.length : 0;
    return `${cell.coord}|${cell.label || ''}|${cell.kind}|${names}|${cell.image || ''}|${drops}`;
  }

  function renderPlayerOverlay(map, coord) {
    if (!map || !coord || !map.cells.has(coord)) return '';
    const cell = map.cells.get(coord);
    const direction = directionInfo(runtime.game && runtime.game.direction);
    const marker = renderPlayerMarker(direction);
    const label = `Игрок ${cell.label || cell.coord}, смотрит на ${direction.name}`;
    return `<div class="bkpm-player-pin" aria-label="${escapeAttr(label)}" style="grid-column:${cell.col};grid-row:${cell.row}">${marker}</div>`;
  }

  function renderPlayerMarker(direction) {
    const facing = direction && direction.side ? direction : directionInfo(direction);
    const marker = ['light', 'dark', 'elements'].includes(runtime.state.marker) ? runtime.state.marker : 'light';
    const label = marker === 'dark' ? '☾' : marker === 'elements' ? '✦' : '☼';
    const code = marker === 'dark' ? 'ТЬ' : marker === 'elements' ? 'СТ' : 'СВ';
    const title = marker === 'dark' ? 'Тьма' : marker === 'elements' ? 'Стихии' : 'Свет';
    return `<span class="bkpm-player-marker marker-${escapeAttr(marker)} dir-${escapeAttr(facing.side)}" style="--bkpm-player-angle:${Number(facing.angle) || 0}deg" aria-label="Игрок: ${escapeAttr(title)}, смотрит на ${escapeAttr(facing.name)}">
      <img class="bkpm-player-icon" src="${escapeAttr(mapIconUrl('player'))}" alt="">
      <span class="bkpm-player-facing"></span>
      <span class="bkpm-player-emblem">${escapeHtml(label)}</span>
      <span class="bkpm-player-code">${escapeHtml(code)}</span>
      <span class="bkpm-player-direction">${escapeHtml(facing.arrow || '◆')}</span>
    </span>`;
  }

  function renderMapCategoryList(map, guide, category) {
    if (!map) return '<div class="bkpm-muted">Карта еще не загружена.</div>';
    const rows = getMapCategoryRows(map, guide, category);
    const groupedRows = category === 'caches' ? rows : groupMapCategoryRows(rows, category);
    if (!rows.length) {
      const empty = category === 'monsters'
        ? 'Монстров на текущем этаже не найдено.'
        : category === 'caches'
          ? 'Сундуков и тайников на текущем этаже не найдено.'
          : 'NPC на текущем этаже не найдены.';
      return `<div class="bkpm-muted">${escapeHtml(empty)}</div>`;
    }

    const clearedCount = rows.filter(row => row.cleared).length;
    const summary = category === 'monsters'
      ? `${groupedRows.length} видов · ${rows.length} на этаже · убито ${clearedCount}`
      : category === 'caches'
        ? `${rows.length} на этаже · весь возможный дроп`
        : `${groupedRows.length} групп · ${rows.length} на этаже`;
    const limit = getCategoryListLimit(category, groupedRows.length);
    const visibleRows = groupedRows.slice(0, limit);
    const cards = visibleRows.map(row => renderMapCategoryCard(row, category)).join('');
    const moreCount = groupedRows.length - visibleRows.length;
    const more = moreCount > 0
      ? `<div class="bkpm-map-list-more">
          <span>Показано ${visibleRows.length} из ${groupedRows.length}</span>
          <button type="button" data-action="category-more" data-category="${escapeAttr(category)}">Показать еще ${Math.min(CATEGORY_LIST_STEP, moreCount)}</button>
        </div>`
      : '';
    return `<div class="bkpm-map-list-head">
      <span>${escapeHtml(summary)}</span>
    </div>
    <div class="bkpm-map-list">${cards}</div>${more}`;
  }

  function getCategoryListLimitKey(category) {
    const map = getCurrentMap();
    return map ? `${map.dungeonId}:${map.floorId}:${category}` : String(category || '');
  }

  function getCategoryListLimit(category, total) {
    const key = getCategoryListLimitKey(category);
    const saved = Number(runtime.categoryListLimits[key]) || CATEGORY_LIST_INITIAL;
    return clamp(Math.max(CATEGORY_LIST_INITIAL, saved), 1, Math.max(1, total));
  }

  function getMapCategoryRows(map, guide, category) {
    const cells = Array.from(map.cells.values()).sort((a, b) => a.row - b.row || a.col - b.col);
    const result = [];
    for (const cell of cells) {
      const meta = getCellMeta(cell, guide);
      if (!cellMatchesMapCategory(cell, meta, category)) continue;
      const cleared = category === 'monsters' && isClearedMonsterCell(map, cell.coord);
      result.push({
        cell,
        meta,
        cleared,
        title: getCategoryCellTitle(cell),
        image: cell.image || ((meta.dropItems || []).find(item => item && item.image) || {}).image || '',
        dropItems: meta.dropItems || []
      });
    }
    return result;
  }

  function groupMapCategoryRows(rows, category) {
    const groups = new Map();
    for (const row of rows) {
      const key = getMapCategoryGroupKey(row, category);
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, Object.assign({}, row, {
          count: 1,
          clearedCount: row.cleared ? 1 : 0,
          coords: [row.cell.coord],
          labels: [row.cell.label || row.cell.coord],
          dropItems: row.dropItems || []
        }));
        continue;
      }
      const wasAllCleared = existing.clearedCount >= existing.count;
      existing.count += 1;
      if (row.cleared) existing.clearedCount += 1;
      existing.coords.push(row.cell.coord);
      existing.labels.push(row.cell.label || row.cell.coord);
      if (!existing.image && row.image) existing.image = row.image;
      existing.dropItems = mergeDropItems(existing.dropItems || [], row.dropItems || []);
      if (wasAllCleared && !row.cleared) existing.cell = row.cell;
      existing.cleared = existing.clearedCount >= existing.count;
    }
    return Array.from(groups.values()).sort((a, b) => {
      const byTitle = String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      if (byTitle) return byTitle;
      return String((a.labels || [])[0] || '').localeCompare(String((b.labels || [])[0] || ''), 'ru');
    });
  }

  function getMapCategoryGroupKey(row, category) {
    const title = canonicalName(row && row.title ? row.title : '');
    if (title) return `${category}:${title}`;
    const image = row && row.image ? imageFingerprint(row.image) : '';
    if (image) return `${category}:image:${image}`;
    return `${category}:cell:${row && row.cell ? row.cell.coord : ''}`;
  }

  function cellMatchesMapCategory(cell, meta, category) {
    if (!cell) return false;
    if (category === 'monsters') return isMonsterListCell(cell, meta);
    if (category === 'npcs') return cell.kind === 'npc' && !isCacheLikeCell(cell) && !isMonsterListCell(cell, meta);
    if (category === 'caches') {
      if (cell.kind === 'monster') return false;
      return isCacheLikeCell(cell) || Boolean(meta && meta.hasDrops && cell.kind !== 'npc');
    }
    return false;
  }

  function isMonsterListCell(cell, meta) {
    if (!cell) return false;
    if (cell.kind === 'monster') return true;
    if (cell.kind !== 'npc' || isCacheLikeCell(cell)) return false;
    const text = normalizeName((cell.names || []).join(' '));
    if (/поведение|нападает|урон|бота/.test(text) && !(text.includes('тип бота') && !text.includes('поведение'))) return true;
    return Boolean(meta && Array.isArray(meta.matches) && meta.matches.some(entry => entry && entry.type === 'monster'));
  }

  function isCacheLikeCell(cell) {
    const text = normalizeName(`${cell && cell.kind ? cell.kind : ''} ${cell && cell.names ? cell.names.join(' ') : ''} ${cell && cell.image ? imageFingerprint(cell.image) : ''}`);
    return /сундук|тайник|схрон|клад|ларец|ящик|короб|шкатул|cache|chest|box|lockbox/.test(text);
  }

  function isClearedMonsterCell(map, coord) {
    return Boolean(map && coord && runtime.state.clearedMonsters && runtime.state.clearedMonsters[`${map.dungeonId}:${map.floorId}:${coord}`]);
  }

  function getCategoryCellTitle(cell) {
    const names = Array.isArray(cell && cell.names) ? cell.names.filter(Boolean) : [];
    return names.length ? names.slice(0, 3).join(', ') : cell ? cell.label || cell.coord : '';
  }

  function renderMapCategoryCard(row, category) {
    const cell = row.cell;
    const image = row.image ? `<img class="bkpm-list-image" src="${escapeAttr(row.image)}" alt="" loading="lazy" decoding="async">` : '<span class="bkpm-list-image is-empty"></span>';
    const drops = row.dropItems && row.dropItems.length
      ? category === 'caches' ? renderFullDropItems(row.dropItems) : renderCompactDropItems(row.dropItems)
      : '<div class="bkpm-muted small">Дроп не указан.</div>';
    const classes = [
      'bkpm-map-list-card',
      `is-${category}`,
      row.cleared ? 'is-cleared' : '',
      runtime.state.selectedCoord === cell.coord ? 'is-selected' : ''
    ].filter(Boolean).join(' ');
    const count = Number(row.count) || 1;
    const countBadge = count > 1 ? `<span class="bkpm-map-list-count">x${count}</span>` : '';
    const state = category === 'monsters' && row.clearedCount
      ? `<span class="bkpm-map-list-state">${row.clearedCount >= count ? 'убит' : `убито ${row.clearedCount}/${count}`}</span>`
      : '';
    const locations = formatGroupedLocations(row);
    return `<article class="${classes}">
      <button type="button" class="bkpm-map-list-main" data-action="select-coord" data-coord="${escapeAttr(cell.coord)}" aria-label="Показать клетку ${escapeAttr(cell.coord)}">
        ${image}
        <span class="bkpm-map-list-text">
          <b>${escapeHtml(row.title)}${countBadge}</b>
          <small>${escapeHtml(locations)}</small>
        </span>
        ${state}
      </button>
      ${drops}
    </article>`;
  }

  function renderFullDropItems(items) {
    const list = getDisplayDropItems(items);
    if (!list.length) return '';
    const body = list.map(item => {
      if (!item || !item.name) return '';
      const image = item.image ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" decoding="async">` : '';
      const name = escapeHtml(item.name);
      return item.href
        ? `<a class="bkpm-drop-item" href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer">${image}<span>${name}</span></a>`
        : `<span class="bkpm-drop-item">${image}<span>${name}</span></span>`;
    }).filter(Boolean).join('');
    return `<div class="bkpm-drop-list full">${body}</div>`;
  }

  function renderCompactDropItems(items) {
    const list = getDisplayDropItems(items);
    if (!list.length) return '';
    const visible = list.slice(0, 5).map(item => {
      if (!item || !item.name) return '';
      const image = item.image ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" decoding="async">` : '';
      const name = escapeHtml(item.name);
      return item.href
        ? `<a class="bkpm-drop-item" href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer">${image}<span>${name}</span></a>`
        : `<span class="bkpm-drop-item">${image}<span>${name}</span></span>`;
    }).filter(Boolean).join('');
    const hidden = list.length - 5;
    const more = hidden > 0 ? `<span class="bkpm-drop-more">+${hidden}</span>` : '';
    return `<div class="bkpm-drop-list compact">${visible}${more}</div>`;
  }

  function formatGroupedLocations(row) {
    const labels = Array.from(new Set((row.labels || []).filter(Boolean)));
    if (!labels.length && row.cell) return row.cell.label || row.cell.coord;
    const visible = labels.slice(0, 5).join(', ');
    const hidden = labels.length - 5;
    return hidden > 0 ? `${visible} +${hidden}` : visible;
  }

  function renderCellDetails(map, guide) {
    if (!map) return '<div class="bkpm-muted">Карта еще не загружена.</div>';
    const coord = runtime.state.selectedCoord || runtime.state.targetCoord || getCurrentCoord() || map.startCoord;
    const cell = coord ? map.cells.get(coord) : null;
    if (!cell) {
      return '<div class="bkpm-muted">Кликни по клетке, чтобы увидеть объект, дроп и маршрут.</div>';
    }

    const meta = getCellMeta(cell, guide);
    const matches = meta.matches;
    const matchedDropItems = meta.dropItems;
    const names = cell.names.length ? cell.names.join(', ') : '';
    const ownDropEntry = matchedDropItems.length && !matches.length ? [{
      type: cell.kind,
      name: names || cell.label || cell.coord,
      image: cell.image || '',
      locations: cell.label || cell.coord,
      dropItems: matchedDropItems,
      drops: [],
      sourceUrl: map.url || ''
    }] : [];
    const allEntries = ownDropEntry.concat(matches);
    const dropHtml = allEntries.length ? allEntries.map(entry => {
      return renderCellEventCard(entry, cell);
    }).join('') : '';

    if (dropHtml) return dropHtml;
    const image = cell.image ? `<img class="bkpm-entry-image" src="${escapeAttr(cell.image)}" alt="" loading="lazy" decoding="async">` : '';
    return `<article class="bkpm-guide-entry bkpm-cell-event-card">
      <div class="bkpm-entry-main">
        ${image}
        <div>
          <div class="bkpm-entry-head"><b>${escapeHtml(names || cell.label || cell.coord)}</b></div>
        </div>
      </div>
    </article>`;
  }

  function renderRouteDetails(map) {
    if (!map) return '<div class="bkpm-muted">Карта еще не загружена.</div>';
    const route = runtime.state.route || [];
    if (!route.length) {
      return '<div class="bkpm-muted">Кликни по клетке для маршрута до нее или нажми «Маршрут этажа».</div>';
    }
    const target = getRouteTargetLabel(map);
    const chunks = route.slice(0, 80).map((coord, index) => {
      const cell = map.cells.get(coord);
      const label = cell && cell.names[0] ? ` - ${shortLabel(cell.names[0])}` : '';
      return `<span><b>${index + 1}</b><i>${escapeHtml(cell ? cell.label || coord : coord)}</i>${escapeHtml(label)}</span>`;
    }).join('');
    const tail = route.length > 80 ? `<div class="bkpm-muted">Показано 80 из ${route.length} шагов.</div>` : '';
    return `<div class="bkpm-route-target">${escapeHtml(target)}</div><div class="bkpm-route-list">${chunks}</div>${tail}`;
  }

  function getRouteTargetLabel(map) {
    if (!runtime.state.targetCoord) return 'Обход этажа';
    const selected = runtime.state.selectedCoord;
    if (selected && selected !== runtime.state.targetCoord && map && map.cells && map.cells.has(selected)) {
      const keyCoord = findKeyRouteTarget(map, runtime.state.routeStartCoord, selected);
      if (keyCoord === runtime.state.targetCoord) return `Ключ для ${selected}: ${runtime.state.targetCoord}`;
    }
    return `Цель: ${runtime.state.targetCoord}`;
  }

  function renderGuideEntryCard(entry) {
    const image = entry.image ? `<img class="bkpm-entry-image" src="${escapeAttr(entry.image)}" alt="" loading="lazy" decoding="async">` : '';
    return `<article class="bkpm-guide-entry">
      <div class="bkpm-entry-head">
        <b>${escapeHtml(entry.name)}</b>
        <em>${escapeHtml(labelGuideType(entry.type))}</em>
      </div>
      <div class="bkpm-entry-main">
        ${image}
        <div>
          ${entry.locations ? `<div class="bkpm-chip-row">${renderChips(entry.locations.split(/\s*,\s*/), 'loc')}</div>` : ''}
          ${renderDropItems(entry)}
        </div>
      </div>
    </article>`;
  }

  function renderCellEventCard(entry, cell) {
    const name = entry && entry.name ? entry.name : cell && cell.names && cell.names[0] ? cell.names[0] : cell ? cell.label || cell.coord : '';
    const imageUrl = entry && entry.image ? entry.image : cell && cell.image ? cell.image : '';
    const image = imageUrl ? `<img class="bkpm-entry-image" src="${escapeAttr(imageUrl)}" alt="" loading="lazy" decoding="async">` : '';
    const drops = renderDropItems(entry);
    return `<article class="bkpm-guide-entry bkpm-cell-event-card">
      <div class="bkpm-entry-main">
        ${image}
        <div>
          <div class="bkpm-entry-head"><b>${escapeHtml(name)}</b></div>
          ${drops || ''}
        </div>
      </div>
    </article>`;
  }

  function renderDropItems(entry) {
    const items = getDisplayDropItems(entry && Array.isArray(entry.dropItems) ? entry.dropItems : [], 12);
    if (items.length) {
      return `<div class="bkpm-drop-list">${items.map(item => {
        const image = item.image ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" decoding="async">` : '';
        const name = escapeHtml(item.name);
        return item.href
          ? `<a class="bkpm-drop-item" href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer">${image}<span>${name}</span></a>`
          : `<span class="bkpm-drop-item">${image}<span>${name}</span></span>`;
      }).join('')}</div>`;
    }
    const drops = entry && Array.isArray(entry.drops) ? entry.drops : [];
    if (!drops.length) {
      return '';
    }
    return `<div class="bkpm-chip-row">${renderChips(drops, 'drop')}</div>`;
  }

  function renderChips(values, kind) {
    return values
      .map(value => cleanText(value))
      .filter(Boolean)
      .slice(0, 14)
      .map(value => `<span class="bkpm-chip ${kind}">${escapeHtml(value)}</span>`)
      .join('');
  }

  function getDisplayDropItems(items, limit) {
    const source = Array.isArray(items) ? items : [];
    const result = [];
    const seen = new Set();
    for (const item of source) {
      if (!item || !item.name || isDropLinkNoise(item.name, item.href)) continue;
      const key = `${canonicalName(item.name)}|${String(item.href || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (limit && result.length >= limit) break;
    }
    return result;
  }

  function isDropLinkNoise(name, href) {
    const text = normalizeName(name);
    if (!text) return true;
    if (/^(каталог предметов|предметы из подземья потерянных|экипировка из подземья потерянных)$/i.test(text)) return true;
    if (/^(каталог|раздел|список предметов|все предметы)$/i.test(text)) return true;
    const url = String(href || '').toLowerCase();
    if (/\/items\/?(?:[#?].*)?$/.test(url)) return true;
    if (/\/items\/(?:catalog|category|section|sets?)\b/.test(url)) return true;
    return false;
  }

  function updateInfoTabs() {
    if (!runtime.root) return;
    for (const button of Array.from(runtime.root.querySelectorAll('.bkpm-info-tabs [data-action]'))) {
      const action = button.getAttribute('data-action');
      const active =
        runtime.state.drawerOpen &&
        ((action === 'show-cell' && runtime.state.drawerView === 'cell') ||
          (action === 'show-route' && runtime.state.drawerView === 'route') ||
          (action === 'show-guide' && runtime.state.drawerView === 'guide') ||
          (action === 'show-loot' && runtime.state.drawerView === 'loot'));
      button.classList.toggle('is-active', active);
    }
    for (const button of Array.from(runtime.root.querySelectorAll('.bkpm-event-rail [data-view]'))) {
      const view = button.getAttribute('data-view');
      const active = runtime.state.drawerOpen && view && runtime.state.drawerView === view;
      button.classList.toggle('is-active', active);
    }
  }

  function getAutoCellSize(map) {
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (!wrap || !map || !map.maxCol || !map.maxRow) return 38;
    const horizontalReserve = 76;
    const verticalReserve = 54;
    const gap = 2;
    const width = Math.max(240, wrap.clientWidth - horizontalReserve);
    const height = Math.max(240, wrap.clientHeight - verticalReserve);
    const byWidth = Math.floor((width - Math.max(0, map.maxCol - 1) * gap) / map.maxCol);
    const byHeight = Math.floor((height - Math.max(0, map.maxRow - 1) * gap) / map.maxRow);
    return clamp(Math.min(byWidth, byHeight), CELL_SIZE_MIN, CELL_SIZE_MAX);
  }

  function getPlayerCloseZoomValue(map) {
    if (!map) return 3;
    const base = Math.max(1, getAutoCellSize(map));
    return clamp(CELL_SIZE_MAX / base, 0.45, 3);
  }

  function getFitMapZoomValue(map) {
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (!wrap || !map || !map.maxCol || !map.maxRow) return 0.65;
    const mapEl = runtime.root.querySelector('[data-role="map"]');
    const metrics = getMapLayoutMetrics(mapEl);
    const base = Math.max(1, getAutoCellSize(map));
    const horizontal = Math.max(1, wrap.clientWidth - metrics.paddingLeft - metrics.paddingRight - metrics.gap * Math.max(0, map.maxCol - 1) - 12);
    const vertical = Math.max(1, wrap.clientHeight - metrics.paddingTop - metrics.paddingBottom - metrics.gap * Math.max(0, map.maxRow - 1) - 12);
    const targetCell = Math.min(horizontal / map.maxCol, vertical / map.maxRow);
    return clamp(targetCell / base, 0.45, 3);
  }

  function getMapLayoutMetrics(mapEl) {
    const fallbackTop = getMapHudOffset() + 34;
    const fallback = {
      gap: 2,
      paddingTop: fallbackTop,
      paddingRight: 62,
      paddingBottom: 54,
      paddingLeft: 62
    };
    if (!mapEl || typeof getComputedStyle !== 'function') return fallback;
    const style = getComputedStyle(mapEl);
    const number = value => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      gap: number(style.columnGap || style.gap) || fallback.gap,
      paddingTop: number(style.paddingTop) || fallback.paddingTop,
      paddingRight: number(style.paddingRight) || fallback.paddingRight,
      paddingBottom: number(style.paddingBottom) || fallback.paddingBottom,
      paddingLeft: number(style.paddingLeft) || fallback.paddingLeft
    };
  }

  function centerMapView(coord) {
    const map = getCurrentMap();
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    if (!wrap || !map) return;
    if (coord && map.cells.has(coord)) {
      centerOnCoord(coord, 'auto');
      return;
    }
    const mapEl = runtime.root.querySelector('[data-role="map"]');
    if (!mapEl) return;
    const left = Math.max(0, (mapEl.scrollWidth - wrap.clientWidth) / 2);
    const hudOffset = getMapHudOffset();
    const top = Math.max(0, (mapEl.scrollHeight - wrap.clientHeight + hudOffset) / 2);
    wrap.scrollTo({ left, top, behavior: 'auto' });
  }

  function fitMapToView(behavior) {
    const wrap = runtime.root && runtime.root.querySelector('[data-role="mapWrap"]');
    const mapEl = runtime.root && runtime.root.querySelector('[data-role="map"]');
    if (!wrap || !mapEl) return;
    const left = Math.max(0, (mapEl.scrollWidth - wrap.clientWidth) / 2);
    wrap.scrollTo({ left, top: 0, behavior: behavior || 'smooth' });
  }

  function getPrimaryDescentCoord(map) {
    if (!map || !map.cells) return '';
    for (const cell of Array.from(map.cells.values()).sort((a, b) => a.row - b.row || a.col - b.col)) {
      if (isDescentCell(cell)) return cell.coord;
    }
    return '';
  }

  function updateStatusLine() {
    const map = getCurrentMap();
    const status = runtime.root.querySelector('[data-role="status"]');
    const game = runtime.game;
    const raw = game && game.rawCoord ? `игра ${formatCoordLabel(game.rawCoord)}` : 'игра: нет';
    const mapped = runtime.playerMapCoord ? `карта ${runtime.playerMapCoord}` : 'карта: ищу';
    const coord = `${raw} · ${mapped}${game && game.syncMode ? ` · ${game.syncMode}` : ''}`;
    const direction = game && game.direction ? game.direction : 'нет направления';
    const mapText = map ? `${map.dungeonTitle} • ${map.floorTitle} • ${map.cells.size} клеток` : 'карта не загружена';
    status.innerHTML = `<span>${escapeHtml(mapText)}</span><b>${escapeHtml(coord)}</b><span>${escapeHtml(direction)}</span>`;
  }

  function queueRender(status) {
    if (status) setStatus(status, false);
    if (!runtime.state.visible) return;
    if (runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(render);
  }

  function setStatus(text, renderNow = true) {
    runtime.lastStatus = text;
    if (renderNow && runtime.root) updateStatusLine();
  }

  function getZoomValue() {
    return Math.round(clamp(Number(runtime.state.zoom) || 1, 0.45, 3) * 100) / 100;
  }

  function setZoomValue(value) {
    runtime.state.zoom = Math.round(clamp(Number(value) || 1, 0.45, 3) * 100) / 100;
  }

  function updateZoomControl(root, zoom) {
    const button = root && root.querySelector('[data-action="zoom-reset"]');
    if (!button) return;
    const percent = `${Math.round((Number(zoom) || 1) * 100)}%`;
    button.textContent = percent;
    button.setAttribute('aria-label', `Масштаб ${percent}. Нажми, чтобы вернуть 100%`);
    button.removeAttribute('title');
  }

  function canFastMapUpdate(map) {
    if (!map || !runtime.root || runtime.state.drawerOpen || runtime.state.targetCoord || runtime.state.route.length) return false;
    if (runtime.renderedMapKey !== mapKey(map.dungeonId, map.floorId)) return false;
    const mapEl = runtime.root.querySelector('[data-role="map"]');
    return Boolean(mapEl && mapEl.querySelector('.bkpm-cell[data-coord]'));
  }

  function applyFastMapUpdate() {
    const map = getCurrentMap();
    if (!canFastMapUpdate(map)) return false;
    const mapEl = runtime.root.querySelector('[data-role="map"]');
    const coord = runtime.playerMapCoord && map.cells.has(runtime.playerMapCoord) ? runtime.playerMapCoord : '';
    if (!coord) return false;

    const previousCoord = runtime.renderedCoord || '';
    if (previousCoord && previousCoord !== coord) {
      const previous = mapEl.querySelector(`.bkpm-cell[data-coord="${cssEscape(previousCoord)}"]`);
      if (previous) {
        previous.classList.remove('is-current');
        previous.classList.add('is-visited');
        appendClearedCrossIfNeeded(previous, map, previousCoord);
      }
    }

    const current = mapEl.querySelector(`.bkpm-cell[data-coord="${cssEscape(coord)}"]`);
    if (current) {
      current.classList.add('is-current', 'is-visited');
      appendClearedCrossIfNeeded(current, map, coord);
    }

    const playerCell = map.cells.get(coord);
    const direction = directionInfo(runtime.game && runtime.game.direction);
    let pin = mapEl.querySelector('.bkpm-player-pin');
    if (pin && playerCell) {
      pin.style.gridColumn = String(playerCell.col);
      pin.style.gridRow = String(playerCell.row);
      pin.setAttribute('aria-label', `Игрок ${playerCell.label || playerCell.coord}, смотрит на ${direction.name}`);
      if (pin.dataset.direction !== direction.side || pin.dataset.marker !== runtime.state.marker) {
        pin.innerHTML = renderPlayerMarker(direction);
        pin.dataset.direction = direction.side;
        pin.dataset.marker = runtime.state.marker;
      }
    } else {
      if (pin) pin.remove();
      mapEl.insertAdjacentHTML('beforeend', renderPlayerOverlay(map, coord));
      pin = mapEl.querySelector('.bkpm-player-pin');
      if (pin) {
        pin.dataset.direction = direction.side;
        pin.dataset.marker = runtime.state.marker;
      }
    }
    runtime.renderedCoord = coord;
    updateStatusLine();
    return true;
  }

  function appendClearedCrossIfNeeded(cellButton, map, coord) {
    const cell = map && map.cells ? map.cells.get(coord) : null;
    if (!cell || cell.kind !== 'monster') return;
    const key = `${map.dungeonId}:${map.floorId}:${coord}`;
    if (!runtime.state.clearedMonsters[key]) return;
    cellButton.classList.add('is-cleared-monster');
    if (!cellButton.querySelector('.bkpm-clear-cross')) {
      cellButton.insertAdjacentHTML('beforeend', '<span class="bkpm-clear-cross" aria-label="Зачищено"></span>');
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function parseStylePixel(value) {
    const number = Number.parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(number) ? number : null;
  }

  function extractDungeonMinimap(doc) {
    const root = doc && doc.querySelector ? doc.querySelector('#DungMap') : null;
    if (!root) return null;
    const tiles = [];
    for (const image of Array.from(root.querySelectorAll('img[src*="/i/sprites/map/"]'))) {
      if (image.classList && image.classList.contains('DungMap_users')) continue;
      const pathMatch = String(image.getAttribute('src') || image.src || '').match(/\/sprites\/map\/d([1357]*)\.(?:gif|png|webp)/i);
      if (!pathMatch) continue;
      const left = parseStylePixel(image.style.left);
      const top = parseStylePixel(image.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
      tiles.push({
        x: Math.round((left - DUNGMAP_TILE_OFFSET) / DUNGMAP_CELL_SIZE),
        y: Math.round((top - DUNGMAP_TILE_OFFSET) / DUNGMAP_CELL_SIZE),
        path: pathMatch[1] || ''
      });
    }

    const user = root.querySelector('.DungMap_users');
    if (!user) return tiles.length ? { x: null, y: null, tiles } : null;
    const userLeft = parseStylePixel(user.style.left);
    const userTop = parseStylePixel(user.style.top);
    if (!Number.isFinite(userLeft) || !Number.isFinite(userTop)) return tiles.length ? { x: null, y: null, tiles } : null;
    return {
      x: Math.round((userLeft - DUNGMAP_USER_OFFSET) / DUNGMAP_CELL_SIZE),
      y: Math.round((userTop - DUNGMAP_USER_OFFSET) / DUNGMAP_CELL_SIZE),
      tiles
    };
  }

  function readVisibleMinimap() {
    for (const context of getAccessibleContexts()) {
      const minimap = extractDungeonMinimap(context.doc);
      if (minimap && minimap.tiles && minimap.tiles.length) return minimap;
    }
    return null;
  }

  function hasMinimapTiles(game) {
    return Boolean(game && game.minimap && Array.isArray(game.minimap.tiles) && game.minimap.tiles.length);
  }

  function shouldReadSceneForGameState() {
    const map = getCurrentMap();
    return !(map && runtime.playerMapCoord && map.cells && map.cells.has(runtime.playerMapCoord));
  }

  function extractDungeonScene(doc) {
    const root = doc && doc.querySelector ? doc.querySelector('#brodilka .Dungeon, .Dungeon') : null;
    if (!root) return null;
    const counts = {};
    for (const image of Array.from(root.querySelectorAll('img[src]'))) {
      const src = String(image.getAttribute('src') || image.src || '');
      if (!isDungeonSceneImage(src)) continue;
      const key = imageFingerprint(src);
      if (!key || key === '1x1') continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    const images = Object.keys(counts);
    return images.length ? { images, counts } : null;
  }

  function readVisibleScene() {
    for (const context of getAccessibleContexts()) {
      const scene = extractDungeonScene(context.doc);
      if (scene && scene.images && scene.images.length) return scene;
    }
    return null;
  }

  function isDungeonSceneImage(src) {
    const value = String(src || '').toLowerCase().replace(/\\/g, '/');
    if (!value || /\/i\/1x1\.gif/i.test(value)) return false;
    if (/\/i\/sprites\/|\/i\/move\/|\/i\/buttons\//i.test(value)) return false;
    return /\/i\/(?:objects|chars|monsters)\//i.test(value) || /items_db\/map_images\//i.test(value);
  }

  function minimapSignature(minimap) {
    if (!minimap || !Array.isArray(minimap.tiles)) return '';
    return minimap.tiles
      .filter(tile => Number.isFinite(tile.x) && Number.isFinite(tile.y))
      .map(tile => `${tile.x},${tile.y}:${tile.path || ''}`)
      .sort()
      .join('|');
  }

  function minimapModeById(id) {
    return MINIMAP_WALL_MODES.find(mode => mode.id === id) || MINIMAP_WALL_MODES[0];
  }

  function wallsFromMinimapPath(path, mode) {
    const walls = {
      n: Boolean(mode.digitsAreOpen),
      e: Boolean(mode.digitsAreOpen),
      s: Boolean(mode.digitsAreOpen),
      w: Boolean(mode.digitsAreOpen)
    };
    const digits = new Set(String(path || '').split(''));
    for (const digit of ['1', '3', '5', '7']) {
      const side = mode.sideByDigit[digit];
      if (!side) continue;
      walls[side] = mode.digitsAreOpen ? !digits.has(digit) : digits.has(digit);
    }
    return walls;
  }

  function scoreMinimapAlignment(minimap, map, dx, dy, mode) {
    if (!minimap || !map || !map.cells || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    const playerCoord = Number.isFinite(minimap.x) && Number.isFinite(minimap.y)
      ? coordFromGrid(minimap.x + dx, minimap.y + dy)
      : '';
    if (playerCoord && !map.cells.has(playerCoord)) return null;

    let score = playerCoord ? 25 : 0;
    let matches = 0;
    let compared = 0;
    const tileSet = new Set((minimap.tiles || [])
      .filter(tile => Number.isFinite(tile.x) && Number.isFinite(tile.y))
      .map(tile => `${tile.x},${tile.y}`));
    for (const tile of minimap.tiles || []) {
      if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      const coord = coordFromGrid(tile.x + dx, tile.y + dy);
      const cell = coord ? map.cells.get(coord) : null;
      if (!cell) {
        score -= 8;
        continue;
      }
      matches++;
      score += 10;
      for (const [side, sideDx, sideDy] of [
        ['n', 0, -1],
        ['e', 1, 0],
        ['s', 0, 1],
        ['w', -1, 0]
      ]) {
        const hasMinimapNeighbor = tileSet.has(`${tile.x + sideDx},${tile.y + sideDy}`);
        const neighborCoord = coordFromGrid(tile.x + dx + sideDx, tile.y + dy + sideDy);
        const hasMapNeighbor = Boolean(neighborCoord && map.cells.has(neighborCoord));
        score += hasMinimapNeighbor === hasMapNeighbor ? 2 : -2;
      }
      const walls = wallsFromMinimapPath(tile.path, mode);
      for (const side of ['n', 'e', 's', 'w']) {
        compared++;
        score += Boolean(cell.walls && cell.walls[side]) === Boolean(walls[side]) ? 2 : -3;
      }
    }

    return {
      coord: playerCoord,
      dx,
      dy,
      mode: mode.id,
      score,
      matches,
      compared
    };
  }

  function isReliableMinimapCoord(candidate, minimap, second) {
    if (!candidate || !candidate.coord) return false;
    const tileCount = minimap && Array.isArray(minimap.tiles) ? minimap.tiles.length : 0;
    const minMatches = Math.max(6, Math.min(14, Math.floor(tileCount * 0.35)));
    const minScore = Math.max(45, minMatches * 5);
    if (candidate.matches < minMatches || candidate.score < minScore) return false;
    const margin = second && Number.isFinite(second.score) ? candidate.score - second.score : candidate.score;
    if (candidate.sceneAnchors > 0) return candidate.sceneMatches > 0 && margin >= 6;
    return margin >= 18 || candidate.score >= minScore + 70;
  }

  function resolveGameCoordByMinimap(game, map) {
    const minimap = game && game.minimap;
    if (!minimap || !map || map.source === 'live' || !map.cells || !Number.isFinite(minimap.x) || !Number.isFinite(minimap.y)) return null;
    const calibrationKey = `${map.dungeonId}:${map.floorId}`;
    const known = runtime.minimapCalibration[calibrationKey];
    const preferredMode = known && known.mode ? minimapModeById(known.mode) : null;
    const modes = preferredMode
      ? [preferredMode].concat(MINIMAP_WALL_MODES.filter(mode => mode.id !== preferredMode.id))
      : MINIMAP_WALL_MODES;

    let best = null;
    let second = null;
    const hasScene = Boolean(game && game.scene && Array.isArray(game.scene.images) && game.scene.images.length);
    const sceneIndex = hasScene ? getMapImageIndex(map) : null;
    const consider = candidate => {
      if (!candidate) return;
      if (!best || candidate.score > best.score) {
        second = best;
        best = candidate;
      } else if (!second || candidate.score > second.score) {
        second = candidate;
      }
    };
    for (const cell of map.cells.values()) {
      if (!cell || !Number.isFinite(cell.col) || !Number.isFinite(cell.row)) continue;
      const dx = cell.col - minimap.x;
      const dy = cell.row - minimap.y;
      for (const mode of modes) {
        const candidate = scoreMinimapAlignment(minimap, map, dx, dy, mode);
        if (!candidate) continue;
        candidate.wallMode = mode.id;
        if (preferredMode && mode.id === preferredMode.id) candidate.score += 5;
        if (hasScene) {
          const sceneScore = scoreSceneCandidate(game.scene, map, candidate.coord, sceneIndex);
          candidate.score += sceneScore.score;
          candidate.sceneMatches = sceneScore.matches;
          candidate.sceneAnchors = sceneScore.anchors;
        } else {
          candidate.sceneMatches = 0;
          candidate.sceneAnchors = 0;
        }
        consider(candidate);
      }
    }

    if (!isReliableMinimapCoord(best, minimap, second)) return null;
    runtime.minimapCalibration[calibrationKey] = {
      mode: best.wallMode || best.mode,
      score: best.score,
      matches: best.matches,
      sceneMatches: best.sceneMatches || 0
    };
    delete runtime.coordCalibration[calibrationKey];
    best.mode = best.sceneMatches ? 'minimap-scene' : 'minimap';
    return best;
  }

  function getMinimapPatternDelta(current, previous) {
    if (!current || !previous || !Array.isArray(current.tiles) || !Array.isArray(previous.tiles)) return null;
    const previousTiles = new Map();
    for (const tile of previous.tiles) {
      if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      previousTiles.set(`${tile.x},${tile.y}`, String(tile.path || ''));
    }
    if (!previousTiles.size) return null;

    const candidates = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ];
    let best = null;
    for (const candidate of candidates) {
      let score = 0;
      let matches = 0;
      for (const tile of current.tiles) {
        if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
        const previousPath = previousTiles.get(`${tile.x + candidate.dx},${tile.y + candidate.dy}`);
        if (previousPath === undefined) {
          score -= 1;
          continue;
        }
        matches++;
        score += previousPath === String(tile.path || '') ? 5 : 1;
      }
      const item = Object.assign({ score, matches }, candidate);
      if (!best || item.score > best.score) best = item;
    }

    if (!best || !best.matches) return null;
    const stationary = candidates[0];
    let stationaryScore = 0;
    let stationaryMatches = 0;
    for (const tile of current.tiles) {
      if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      const previousPath = previousTiles.get(`${tile.x + stationary.dx},${tile.y + stationary.dy}`);
      if (previousPath === undefined) {
        stationaryScore -= 1;
        continue;
      }
      stationaryMatches++;
      stationaryScore += previousPath === String(tile.path || '') ? 5 : 1;
    }

    const moved = Math.abs(best.dx) + Math.abs(best.dy) === 1;
    const minMatches = Math.max(8, Math.min(18, Math.floor(Math.min(current.tiles.length, previous.tiles.length) * 0.35)));
    if (!moved || best.matches < minMatches || best.score < stationaryScore + 10) return null;
    return best;
  }

  function resolveGameCoordByMinimapDelta(game, map, previousGame, previousCoord) {
    const current = game && game.minimap;
    const previous = previousGame && previousGame.minimap;
    if (!current || !previous || !map || map.source === 'live' || !previousCoord) return null;
    if (!map.cells || !map.cells.has(previousCoord)) return null;
    if (Number.isFinite(game.floorNumber) && Number.isFinite(previousGame.floorNumber) && game.floorNumber !== previousGame.floorNumber) return null;

    const delta = getMinimapPatternDelta(current, previous);
    if (!delta) return null;
    const dx = delta.dx;
    const dy = delta.dy;

    const previousCell = map.cells.get(previousCoord);
    if (!previousCell || !Number.isFinite(previousCell.col) || !Number.isFinite(previousCell.row)) return null;
    const coord = coordFromGrid(previousCell.col + dx, previousCell.row + dy);
    if (!coord || !map.cells.has(coord)) return null;

    return {
      coord,
      mode: 'minimap-delta',
      score: 1200 + delta.score,
      matches: delta.matches
    };
  }

  function resolveInitialGameCoord(game, map) {
    if (!game || !map) return null;
    return resolveGameCoordByMinimap(game, map) || resolveGameCoord(game, map);
  }

  function beginConfirmedDungeonMove(token) {
    if (!token || !/^m[1357]$|^r[lr]$/.test(token)) return;
    const map = getCurrentMap();
    const coord = map
      ? (runtime.playerMapCoord && map.cells.has(runtime.playerMapCoord)
        ? runtime.playerMapCoord
        : (!hasMinimapTiles(runtime.game) ? getStoredPlayerCoordForMap(map) : ''))
      : '';
    runtime.pendingMove = {
      token,
      coord,
      direction: getEffectiveDirection(),
      rawCoord: runtime.game && runtime.game.rawCoord ? runtime.game.rawCoord : '',
      x: runtime.game && Number.isFinite(runtime.game.x) ? runtime.game.x : null,
      y: runtime.game && Number.isFinite(runtime.game.y) ? runtime.game.y : null,
      minimap: readVisibleMinimap(),
      at: Date.now()
    };
    runtime.pendingMove.signature = minimapSignature(runtime.pendingMove.minimap);
  }

  function resolvePendingConfirmedMove(game, map) {
    const pending = runtime.pendingMove;
    if (!pending || !map || !map.cells) return null;
    const now = Date.now();
    const age = now - (pending.at || now);
    const currentCoord = pending.coord && map.cells.has(pending.coord)
      ? pending.coord
      : (runtime.playerMapCoord && map.cells.has(runtime.playerMapCoord) ? runtime.playerMapCoord : '');
    if (!currentCoord || !map.cells.has(currentCoord)) {
      runtime.pendingMove = null;
      return null;
    }

    const currentMinimap = game && game.minimap ? game.minimap : readVisibleMinimap();
    const currentSignature = minimapSignature(currentMinimap);
    const minimapChanged = Boolean(pending.signature && currentSignature && pending.signature !== currentSignature);
    const rawChanged = Boolean(pending.rawCoord && game && game.rawCoord && pending.rawCoord !== game.rawCoord);
    const rawDelta = game && Number.isFinite(game.x) && Number.isFinite(game.y) && Number.isFinite(pending.x) && Number.isFinite(pending.y)
      ? { dx: game.x - pending.x, dy: game.y - pending.y }
      : null;

    if (pending.token === 'rl' || pending.token === 'rr') {
      if (minimapChanged || rawChanged || age >= 700) runtime.pendingMove = null;
      const direction = getExactGameDirection(game) ||
        strictNormalizeGameDirection(runtime.optimisticMove && runtime.optimisticMove.token === pending.token ? runtime.optimisticMove.direction : '') ||
        strictNormalizeGameDirection(pending.direction);
      return {
        coord: currentCoord,
        direction,
        mode: 'turn-confirmed',
        score: minimapChanged || rawChanged ? 900 : 0,
        matches: 1,
        done: true
      };
    }

    let target = '';
    let mode = '';
    let score = 0;
    let matches = 0;
    const patternDelta = currentMinimap && pending.minimap ? getMinimapPatternDelta(currentMinimap, pending.minimap) : null;
    if (patternDelta) {
      const cell = map.cells.get(currentCoord);
      target = cell ? coordFromGrid(cell.col + patternDelta.dx, cell.row + patternDelta.dy) : '';
      mode = 'minimap-confirmed';
      score = 1200 + patternDelta.score;
      matches = patternDelta.matches;
    }

    if ((!target || !map.cells.has(target)) && rawDelta && Math.abs(rawDelta.dx) + Math.abs(rawDelta.dy) === 1) {
      const cell = map.cells.get(currentCoord);
      target = cell ? coordFromGrid(cell.col + rawDelta.dx, cell.row + rawDelta.dy) : '';
      mode = 'raw-confirmed';
      score = 1000;
      matches = 1;
    }

    if ((!target || !map.cells.has(target)) && minimapChanged) {
      target = getMoveTargetCoord(map, currentCoord, pending.token, pending.direction, true);
      mode = 'token-confirmed';
      score = 700;
      matches = 1;
    }

    if (target && map.cells.has(target)) {
      runtime.pendingMove = null;
      return {
        coord: target,
        direction: game && game.direction ? game.direction : pending.direction,
        mode,
        score,
        matches,
        done: true
      };
    }

    if (age < 1600 && !minimapChanged && !rawChanged) {
      return {
        coord: currentCoord,
        direction: game && game.direction ? game.direction : pending.direction,
        mode: 'pending',
        score: 0,
        matches: 0,
        done: false
      };
    }

    runtime.pendingMove = null;
    return {
      coord: currentCoord,
      direction: game && game.direction ? game.direction : pending.direction,
      mode: 'blocked',
      score: 0,
      matches: 0,
      done: true
    };
  }

  function resolveGameCoordByDelta(game, map, previousGame, previousCoord) {
    if (!game || !map || map.source === 'live' || !previousGame || !previousCoord) return null;
    if (!map.cells || !map.cells.has(previousCoord)) return null;
    if (game.coordSource === 'minimap' || previousGame.coordSource === 'minimap') return null;
    if (!Number.isFinite(game.x) || !Number.isFinite(game.y)) return null;
    if (!Number.isFinite(previousGame.x) || !Number.isFinite(previousGame.y)) return null;
    if (Number.isFinite(game.floorNumber) && Number.isFinite(previousGame.floorNumber) && game.floorNumber !== previousGame.floorNumber) return null;

    const dx = game.x - previousGame.x;
    const dy = game.y - previousGame.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;

    const previousCell = map.cells.get(previousCoord);
    if (!previousCell || !Number.isFinite(previousCell.col) || !Number.isFinite(previousCell.row)) return null;
    const coord = coordFromGrid(previousCell.col + dx, previousCell.row + dy);
    if (!coord || !map.cells.has(coord)) return null;

    return {
      coord,
      mode: 'delta',
      score: 1000,
      matches: 1
    };
  }

  function resolveGameCoordCheap(game, map) {
    if (!game || !map || !Number.isFinite(game.x) || !Number.isFinite(game.y)) {
      return game && game.coord && map && map.cells && map.cells.has(game.coord)
        ? { coord: game.coord, mode: 'raw', score: 0, matches: 0 }
        : null;
    }
    if (map.source === 'live') {
      const coord = liveCoordKey(game.x, game.y);
      if (!map.cells.has(coord)) return null;
      return {
        coord,
        mode: 'live',
        score: game.matrix ? game.matrix.length : 1,
        matches: game.matrix ? game.matrix.length : 1
      };
    }
    if (game.coordSource === 'minimap') return null;

    const calibrationKey = `${map.dungeonId}:${map.floorId}`;
    const known = runtime.coordCalibration[calibrationKey];
    const candidates = [];
    if (known && Number.isFinite(known.dx) && Number.isFinite(known.dy)) {
      candidates.push({ dx: known.dx, dy: known.dy, mode: 'calibrated', bias: 4 });
    }
    candidates.push(
      { dx: 0, dy: 0, mode: 'direct' },
      { dx: 1, dy: 1, mode: 'shift+1' },
      { dx: -1, dy: -1, mode: 'shift-1' }
    );

    let best = null;
    const seen = new Set();
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.dx) || !Number.isFinite(candidate.dy)) continue;
      const key = `${candidate.dx},${candidate.dy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const coord = coordFromGrid(game.x + candidate.dx, game.y + candidate.dy);
      if (!map.cells.has(coord)) continue;
      const score = scoreGameOffset(game, map, candidate.dx, candidate.dy);
      const item = {
        coord,
        mode: candidate.mode,
        dx: candidate.dx,
        dy: candidate.dy,
        score: score.score + (candidate.bias || 0),
        matches: score.matches
      };
      if (!best || item.score > best.score) best = item;
    }

    if (best && isReliableResolvedCoord(best, game)) return best;
    return game.coord && map.cells.has(game.coord)
      ? { coord: game.coord, mode: 'raw', score: 0, matches: 0 }
      : null;
  }

  function resolveOptimisticMove(game, map, optimistic) {
    const token = optimistic.token || '';
    const isMove = /^m/.test(token);
    const now = Date.now();
    const startedAt = optimistic.startedAt || now;
    const age = Math.max(0, now - startedAt);
    const grace = isMove ? OPTIMISTIC_MOVE_GRACE_MS : OPTIMISTIC_TURN_GRACE_MS;
    const bridgeIsOlderThanMove = game && game.source === 'bridge' && game.capturedAt && game.capturedAt < startedAt;
    const actual = bridgeIsOlderThanMove ? null : resolveGameCoordCheap(game, map);

    if (actual && actual.coord) {
      const confirmed = actual.coord === optimistic.coord;
      const leftSourceCell = isMove && optimistic.fromCoord && actual.coord !== optimistic.fromCoord;
      if (confirmed || leftSourceCell || age >= grace) {
        const direction = isMove
          ? (game.direction || optimistic.direction)
          : (getExactGameDirection(game) ||
            strictNormalizeGameDirection(optimistic.direction) ||
            strictNormalizeGameDirection(optimistic.sourceDirection));
        return {
          coord: actual.coord,
          direction,
          mode: confirmed ? actual.mode : (actual.mode || 'authoritative'),
          score: actual.score,
          matches: actual.matches,
          done: true
        };
      }
    }

    const rawChanged = Boolean(game && optimistic.rawCoord && game.rawCoord && game.rawCoord !== optimistic.rawCoord);
    if (rawChanged && map.cells.has(optimistic.coord)) {
      const direction = isMove
        ? (game.direction || optimistic.direction)
        : (getExactGameDirection(game) ||
          strictNormalizeGameDirection(optimistic.direction) ||
          strictNormalizeGameDirection(optimistic.sourceDirection));
      return {
        coord: optimistic.coord,
        direction,
        mode: isMove ? 'move-confirmed' : 'turn-confirmed',
        score: 998,
        matches: 1,
        done: true
      };
    }

    if (isMove && age >= grace && optimistic.fromCoord && map.cells.has(optimistic.fromCoord)) {
      return {
        coord: optimistic.fromCoord,
        direction: game.direction || optimistic.direction,
        mode: 'hold',
        score: 0,
        matches: 0,
        done: true
      };
    }

    return {
      coord: optimistic.coord,
      direction: optimistic.direction || (game && game.direction),
      mode: isMove ? 'move' : 'turn',
      score: 999,
      matches: 1,
      done: false
    };
  }

  function syncGameState() {
    const game = detectGameState();
    const previousSignature = runtime.gameSignature || '';
    const previousGame = runtime.game;
    const previousCoord = runtime.playerMapCoord;
    const previousLiveMap = runtime.liveMap;
    const currentMapBeforeSync = getCurrentMap();
    const storedCoord = getStoredPlayerCoordForMap(currentMapBeforeSync);
    runtime.game = game;
    if (!game) {
      if (runtime.optimisticMove && runtime.optimisticMove.until > Date.now() && runtime.optimisticMove.coord) {
        runtime.playerMapCoord = runtime.optimisticMove.coord;
        runtime.game = {
          coord: runtime.optimisticMove.coord,
          direction: runtime.optimisticMove.direction,
          syncMode: runtime.optimisticMove.token && /^m/.test(runtime.optimisticMove.token) ? 'move' : 'turn'
        };
        return false;
      }
      const holdCoord = previousCoord || storedCoord;
      if (holdCoord && currentMapBeforeSync && currentMapBeforeSync.cells.has(holdCoord)) {
        runtime.playerMapCoord = holdCoord;
        runtime.liveMap = previousLiveMap;
        markVisited(currentMapBeforeSync, holdCoord);
        runtime.state.selectedCoord = holdCoord;
        runtime.game = Object.assign({}, previousGame || {}, {
          coord: holdCoord,
          direction: previousGame && previousGame.direction ? previousGame.direction : (runtime.state.lastPlayer && runtime.state.lastPlayer.direction) || 'север',
          syncMode: isBattlePageActive() ? 'battle' : 'hold'
        });
        const battleSignature = [
          runtime.game.room || '',
          runtime.game.floorNumber || '',
          runtime.playerMapCoord,
          runtime.game.rawCoord || '',
          runtime.game.direction || '',
          runtime.game.syncMode
        ].join('|');
        runtime.gameSignature = battleSignature;
        persistLastPlayer(currentMapBeforeSync, holdCoord, runtime.game.direction, runtime.game.syncMode);
        saveStateSoon();
        return battleSignature !== previousSignature;
      }
      runtime.gameSignature = '';
      runtime.liveMap = null;
      runtime.playerMapCoord = '';
      return previousSignature !== '';
    }

    const recoveredFromBattle = Boolean((previousGame && previousGame.syncMode === 'battle') ||
      (runtime.lastBattleSeenAt && Date.now() - runtime.lastBattleSeenAt < 15000));
    if (recoveredFromBattle) {
      if (!game.direction) {
        game.direction = (previousGame && previousGame.direction) ||
          (runtime.state.lastPlayer && runtime.state.lastPlayer.direction) ||
          '';
      }
    } else {
      applyRecentTurnDirection(game, previousGame);
    }

    const matchedDungeon = detectDungeonByGame(game);
    let changed = false;
    let fullRenderNeeded = false;
    if (recoveredFromBattle) {
      runtime.pendingMove = null;
      runtime.optimisticMove = null;
      runtime.contextCache = null;
      runtime.lastObserverBind = 0;
      bindGameObservers();
      requestBridgeState(true);
      changed = true;
      fullRenderNeeded = true;
    }
    if (matchedDungeon && matchedDungeon.id !== runtime.state.dungeonId) {
      runtime.state.dungeonId = matchedDungeon.id;
      runtime.state.floorId = matchedDungeon.floors[0] ? matchedDungeon.floors[0].id : runtime.state.floorId;
      runtime.playerMapCoord = '';
      runtime.pendingMove = null;
      runtime.optimisticMove = null;
      runtime.lastCenteredCoord = '';
      updateDungeonControls();
      scheduleMapLoad(false);
      changed = true;
      fullRenderNeeded = true;
    }

    const dungeon = getCurrentDungeon();
    if (dungeon && Number.isFinite(game.floorNumber)) {
      const floor = dungeon.floors.find(item => String(item.title).includes(String(game.floorNumber)));
      if (floor && floor.id !== runtime.state.floorId) {
        runtime.state.floorId = floor.id;
        runtime.playerMapCoord = '';
        runtime.pendingMove = null;
        runtime.optimisticMove = null;
        runtime.lastCenteredCoord = '';
        updateDungeonControls();
        scheduleMapLoad(false);
        changed = true;
        fullRenderNeeded = true;
      }
    }

    const map = getCurrentMap();
    if (map) {
      const optimistic = runtime.optimisticMove && runtime.optimisticMove.until > Date.now()
        ? runtime.optimisticMove
        : null;
      const pendingConfirmed = resolvePendingConfirmedMove(game, map);
      if (pendingConfirmed && pendingConfirmed.coord) {
        game.coord = pendingConfirmed.coord;
        runtime.playerMapCoord = pendingConfirmed.coord;
        game.direction = pendingConfirmed.direction || game.direction;
        game.syncMode = pendingConfirmed.mode;
        game.syncScore = pendingConfirmed.score;
        game.syncMatches = pendingConfirmed.matches;
      } else if (optimistic && map.cells.has(optimistic.coord)) {
        const resolvedOptimistic = resolveOptimisticMove(game, map, optimistic);
        game.coord = resolvedOptimistic.coord;
        runtime.playerMapCoord = resolvedOptimistic.coord;
        game.direction = resolvedOptimistic.direction || game.direction;
        game.syncMode = resolvedOptimistic.mode;
        game.syncScore = resolvedOptimistic.score;
        game.syncMatches = resolvedOptimistic.matches;
        if (resolvedOptimistic.done) runtime.optimisticMove = null;
      } else {
        if (runtime.optimisticMove && runtime.optimisticMove.until <= Date.now()) runtime.optimisticMove = null;
        const holdCoord = !recoveredFromBattle && previousCoord && map.cells.has(previousCoord)
          ? previousCoord
          : '';
        const storedFallback = !holdCoord && !hasMinimapTiles(game)
          ? getStoredPlayerCoordForMap(map)
          : '';
        const resolved = resolveGameCoordByMinimapDelta(game, map, previousGame, previousCoord) ||
          resolveGameCoordByDelta(game, map, previousGame, previousCoord) ||
          (!holdCoord ? resolveInitialGameCoord(game, map) : null);
        if (resolved && resolved.coord) {
          game.coord = resolved.coord;
          runtime.playerMapCoord = resolved.coord;
          game.syncMode = resolved.mode;
          game.syncScore = resolved.score;
          game.syncMatches = resolved.matches;
        } else if (holdCoord && map.cells.has(holdCoord)) {
          runtime.playerMapCoord = holdCoord;
          game.coord = holdCoord;
          game.syncMode = game.syncMode || 'hold';
          game.syncScore = 0;
          game.syncMatches = 0;
        } else if (storedFallback && map.cells.has(storedFallback)) {
          runtime.playerMapCoord = storedFallback;
          game.coord = storedFallback;
          game.syncMode = game.syncMode || 'stored';
          game.syncScore = 0;
          game.syncMatches = 0;
        } else {
          runtime.playerMapCoord = '';
          game.syncMode = 'search';
        }
      }
    }

    if (!getCurrentMap() && Array.isArray(game.matrix) && game.matrix.length) {
      runtime.liveMap = buildLiveMap(game);
    }

    const signature = [game.room, game.floorNumber, runtime.playerMapCoord, game.rawCoord, game.direction, game.syncMode].join('|');
    if (signature !== previousSignature) {
      runtime.gameSignature = signature;
      changed = true;
    }

    const activeMap = getCurrentMap();
    if (runtime.playerMapCoord) {
      if (activeMap && activeMap.cells.has(runtime.playerMapCoord)) {
        if (previousCoord && previousCoord !== runtime.playerMapCoord && activeMap.cells.has(previousCoord)) {
          markVisited(activeMap, previousCoord);
        }
        markVisited(activeMap, runtime.playerMapCoord);
        persistLastPlayer(activeMap, runtime.playerMapCoord, game.direction, game.syncMode);
        if (runtime.lastCenteredCoord !== runtime.playerMapCoord) {
          runtime.lastCenteredCoord = runtime.playerMapCoord;
          setTimeout(() => centerOnCoord(runtime.playerMapCoord, 'auto'), 80);
          changed = true;
        }
        if (runtime.state.targetCoord) {
          updateRouteFromStart(activeMap, runtime.playerMapCoord);
          changed = true;
          fullRenderNeeded = true;
        }
        if (recoveredFromBattle) {
          runtime.lastBattleSeenAt = 0;
          requestBridgeState(true);
        }
      }
    }
    if (changed) saveStateSoon();
    if (changed && !fullRenderNeeded && canFastMapUpdate(activeMap)) return 'fast';
    return changed;
  }

  function detectGameState() {
    const battleActive = isBattlePageActive();
    if (battleActive) {
      runtime.lastBattleSeenAt = Date.now();
      runtime.bridgeData = null;
      runtime.bridgeAt = 0;
      runtime.pendingMove = null;
      runtime.optimisticMove = null;
    }
    if (!battleActive && runtime.bridgeData && Date.now() - runtime.bridgeAt < 6000) {
      const context = {
        win: window,
        doc: document,
        href: runtime.bridgeData.href || location.href,
        depth: runtime.bridgeData.depth || 0
      };
      const bridgeMoveTextDirection = strictNormalizeGameDirection(runtime.bridgeData.movetextDirection);
      const visibleDirectionText = bridgeMoveTextDirection ? '' : readVisibleDirectionText();
      const bridgeDirectionText = bridgeMoveTextDirection ? `смотрим на ${bridgeMoveTextDirection}` : '';
      const text = `${runtime.bridgeData.room || ''} ${visibleDirectionText || bridgeDirectionText}`;
      const state = buildGameState(context, runtime.bridgeData, text, 500 + (runtime.bridgeData.score || 0));
      state.source = 'bridge';
      state.capturedAt = runtime.bridgeData.capturedAt || runtime.bridgeAt;
      return state;
    }

    const contexts = getAccessibleContexts();
    let best = null;
    for (const context of contexts) {
      const data = extractJsonData(context.doc);
      let text = '';
      let score = 0;
      const moveTextDirection = readMoveTextDirectionFromDoc(context.doc);
      if (data && data.movemenu) score += 100;
      if (data && data.movemenu && data.movemenu.walls2) score += 100;
      if (moveTextDirection) {
        text = `смотрим на ${moveTextDirection}`;
        score += 40;
      }
      if (/смотрим\s+на[:\s]+(север|юг|запад|восток)/i.test(text)) score += 20;
      if (context.doc.querySelector('#MoveMap,.Dungeon,#DungMap')) score += 30;
      if (!score) continue;

      const state = buildGameState(context, data, text, score);
      state.source = 'dom';
      state.capturedAt = Date.now();
      if (!best || state.score > best.score) best = state;
    }
    return best;
  }

  function readVisibleDirectionText() {
    for (const context of getAccessibleContexts()) {
      const doc = context.doc;
      if (!doc) continue;
      const direction = readMoveTextDirectionFromDoc(doc);
      if (direction) return `смотрим на ${direction}`;
    }
    return '';
  }

  function readMoveTextDirectionFromDoc(doc) {
    const node = doc && doc.querySelector ? doc.querySelector('#movetext') : null;
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
        direction = extractDirectionFromMoveText(text);
      } catch (error) {
        direction = '';
      }
      if (direction) return direction;
    }
    return '';
  }

  function extractDirectionFromMoveText(value) {
    const text = cleanText(value);
    const match = text.match(/смотрим\s+на[:\s]+(север|юг|запад|восток)/i);
    if (match) return strictNormalizeGameDirection(match[1]);
    const loose = normalizeName(text).match(/(север|юг|запад|восток|north|south|east|west|^n$|^s$|^e$|^w$)/i);
    return strictNormalizeGameDirection(loose ? loose[1] : text);
  }

  function isBattlePageActive() {
    for (const context of getAccessibleContexts()) {
      const doc = context.doc;
      if (!doc) continue;
      if (doc.querySelector('.UserBattleMethod,.UserBattleMethodDisabled,button[data-cmd^="skill "],form[action*="battle"],input[name*="battle"]')) return true;
      const text = normalizeName(getBodyText(doc).slice(0, 5000));
      const hasAttackZones = /удар в голову|удар в грудь|удар в живот|удар в пояс|удар по ногам/.test(text);
      const hasDefenseZones = /блок головы|блок груди|блок живота|блок пояса|блок ног/.test(text);
      const hasOpponent = /против|соперник|противник/.test(text);
      if (hasAttackZones && hasDefenseZones && hasOpponent) return true;
      if (/нанести удар|вперед|размен/.test(text) && hasOpponent) return true;
    }
    return false;
  }

  function buildGameState(context, data, text, score) {
    const move = data && data.movemenu ? data.movemenu : {};
    const user = data && Array.isArray(data.users2) ? data.users2.find(item => item && item.i_am) : null;
    const minimap = extractDungeonMinimap(context.doc) || (context.depth === 0 ? readVisibleMinimap() : null);
    const scene = shouldReadSceneForGameState()
      ? (extractDungeonScene(context.doc) || (context.depth === 0 ? readVisibleScene() : null))
      : null;
    const hasUserCoord = user && Number.isFinite(Number(user.x)) && Number.isFinite(Number(user.y));
    const x = hasUserCoord ? Number(user.x) : (minimap && Number.isFinite(minimap.x) ? minimap.x : null);
    const y = hasUserCoord ? Number(user.y) : (minimap && Number.isFinite(minimap.y) ? minimap.y : null);
    const coord = Number.isFinite(x) && Number.isFinite(y) ? liveCoordKey(x, y) : '';
    const matrix = extractGameMatrix(move);
    const room = data && data.room ? String(data.room) : cleanText(context.doc.querySelector('#roomname') ? context.doc.querySelector('#roomname').textContent : '');
    const direction = extractDirectionFromMoveText(text) ||
      strictNormalizeGameDirection(data && data.movetextDirection);
    const floorMatch = `${room} ${move.m1name || ''} ${move.m3name || ''} ${move.m5name || ''} ${move.m7name || ''}`.match(/этаж\s+(\d+)/i);
    return {
      score,
      href: context.href,
      room,
      direction,
      directionSource: direction ? 'movetext' : '',
      coord,
      rawCoord: coord,
      coordSource: hasUserCoord ? 'user' : (minimap && Number.isFinite(minimap.x) && Number.isFinite(minimap.y) ? 'minimap' : ''),
      x,
      y,
      matrix,
      minimap,
      scene,
      floorNumber: floorMatch ? Number(floorMatch[1]) : null
    };
  }

  function extractGameMatrix(move) {
    const matrix = move && move.walls2 && move.walls2.matrix;
    if (!matrix || typeof matrix !== 'object') return [];
    const result = [];
    for (const xKey of Object.keys(matrix)) {
      const col = Number(xKey);
      if (!Number.isFinite(col)) continue;
      const column = matrix[xKey];
      if (!column || typeof column !== 'object') continue;
      for (const yKey of Object.keys(column)) {
        const row = Number(yKey);
        const room = column[yKey];
        if (!Number.isFinite(row) || !room || typeof room !== 'object') continue;
        const objectEntities = extractGameMatrixEntities(room.obj, 'object');
        const userEntities = extractGameMatrixEntities(room.users, 'user');
        result.push({
          x: col,
          y: row,
          walls: parseGameWalls(room.walls),
          path: room.path || '',
          name: cleanText(room.name || ''),
          objects: objectEntities.map(item => item.name).filter(Boolean),
          users: userEntities.map(item => item.name).filter(Boolean),
          objectEntities,
          userEntities
        });
      }
    }
    return result;
  }

  function extractGameMatrixNames(items) {
    return extractGameMatrixEntities(items, '').map(item => item.name).filter(Boolean);
  }

  function extractGameMatrixEntities(items, kind) {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
      const name = cleanObjectName(item && item.name ? item.name : '');
      if (!name) return null;
      return {
        name,
        image: normalizeGameEntityImage(item, kind),
        action: item && item.action ? String(item.action) : ''
      };
    }).filter(Boolean);
  }

  function normalizeGameEntityImage(item, kind) {
    if (!item || typeof item !== 'object') return '';
    const raw = String(item.image || item.img || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:');
    const clean = raw.replace(/^\/+/, '').replace(/\.(png|gif|jpe?g)$/i, '');
    if (!clean) return '';
    if (kind === 'user') return `https://img.combats.com/i/chars/d/${clean}.png`;
    if (kind === 'object') {
      const prefix = item.zoom_image ? `${String(item.zoom_image).replace(/^\/+|\/+$/g, '')}/` : '';
      const ext = item.anim ? 'gif' : 'png';
      return `https://img.combats.com/i/objects/${prefix}${clean}.${ext}`;
    }
    return '';
  }

  function parseGameWalls(value) {
    const parts = String(value || '').trim().split(/\s+/).map(Number);
    return {
      n: Number.isFinite(parts[0]) && parts[0] !== 0,
      e: Number.isFinite(parts[1]) && parts[1] !== 0,
      s: Number.isFinite(parts[2]) && parts[2] !== 0,
      w: Number.isFinite(parts[3]) && parts[3] !== 0
    };
  }

  function getAccessibleContexts() {
    const now = Date.now();
    if (runtime.contextCache && now - runtime.contextCache.at < 120 && Array.isArray(runtime.contextCache.contexts)) {
      return runtime.contextCache.contexts;
    }
    const result = [];
    const seen = new Set();
    function walk(win, depth) {
      if (!win || depth > 4) return;
      let doc;
      let href = '';
      try {
        doc = win.document;
        href = String(win.location && win.location.href ? win.location.href : '');
      } catch (error) {
        return;
      }
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      result.push({ win, doc, href, depth });
      let frames = [];
      try {
        frames = Array.from(win.frames || []);
      } catch (error) {
        frames = [];
      }
      for (const frame of frames) walk(frame, depth + 1);
    }
    walk(window, 0);
    runtime.contextCache = { at: now, contexts: result };
    return result;
  }

  function extractJsonData(doc) {
    try {
      const live = doc && doc.defaultView && doc.defaultView.jsondata;
      if (live && typeof live === 'object' && live.movemenu) return live;
    } catch (error) {
      // The frame can be inaccessible during reload; the script fallback below will try next.
    }

    const scripts = Array.from(doc.scripts || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      const index = text.indexOf('var jsondata=');
      if (index < 0) continue;
      const start = text.indexOf('{', index);
      if (start < 0) continue;
      const end = findBalancedObjectEnd(text, start);
      if (end < 0) continue;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (error) {
        console.warn('[BKPM] jsondata найден, но не распарсен', error);
      }
    }
    return null;
  }

  function findBalancedObjectEnd(text, start) {
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = '';
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function detectDungeonByGame(game) {
    const rawHaystack = `${game.room || ''} ${game.href || ''}`;
    const haystack = normalizeName(rawHaystack);
    if (!haystack) return null;
    let best = null;
    for (const dungeon of DUNGEONS) {
      const score = scoreDungeonMatch(dungeon, haystack, rawHaystack);
      if (score > 0 && (!best || score > best.score)) {
        best = { dungeon, score };
      }
    }
    return best ? best.dungeon : null;
  }

  function scoreDungeonMatch(dungeon, haystack, rawHaystack) {
    const title = normalizeName(dungeon.title || '');
    const aliases = [dungeon.title, ...(dungeon.aliases || [])];
    let best = scoreDungeonUrlMatch(dungeon, haystack, rawHaystack);
    for (const alias of aliases) {
      const value = normalizeName(alias);
      if (!value || isGenericDungeonAlias(value) || !containsDungeonAlias(haystack, value)) continue;
      const wordCount = value.split(/\s+/).filter(Boolean).length;
      let score = value.length;
      if (value === title) score += 100;
      if (wordCount > 1) score += 20;
      if (value.length <= 4) score -= 5;
      best = Math.max(best, score);
    }
    return best;
  }

  function scoreDungeonUrlMatch(dungeon, haystack, rawHaystack) {
    const raw = String(rawHaystack || '').toLowerCase();
    let best = 0;
    for (const alias of dungeon.urlAliases || []) {
      const direct = String(alias || '').trim().toLowerCase();
      const normalized = normalizeName(alias);
      if (direct && raw.includes(direct)) best = Math.max(best, 260 + direct.length);
      if (normalized && containsDungeonAlias(haystack, normalized)) best = Math.max(best, 220 + normalized.length);
    }
    return best;
  }

  function containsDungeonAlias(haystack, alias) {
    const pattern = escapeRegExp(alias).replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`, 'i').test(haystack);
  }

  function isGenericDungeonAlias(value) {
    return /^этаж\s+\d+\s*-?$/.test(value) || /^этап\s+\d+\s*-?$/.test(value);
  }

  function getCurrentDungeon() {
    return DUNGEONS.find(dungeon => dungeon.id === runtime.state.dungeonId) || DUNGEONS[0] || null;
  }

  function getCurrentFloor() {
    const dungeon = getCurrentDungeon();
    return dungeon ? dungeon.floors.find(floor => floor.id === runtime.state.floorId) || dungeon.floors[0] : null;
  }

  function getCurrentMap() {
    const dungeon = getCurrentDungeon();
    const floor = getCurrentFloor();
    if (!dungeon || !floor) return null;
    return runtime.mapByKey.get(mapKey(dungeon.id, floor.id)) || null;
  }

  function getCurrentMapKey() {
    const dungeon = getCurrentDungeon();
    const floor = getCurrentFloor();
    return dungeon && floor ? mapKey(dungeon.id, floor.id) : '';
  }

  function pruneMapCacheToCurrent() {
    const currentKey = getCurrentMapKey();
    if (!currentKey) return;
    let changed = false;
    for (const key of Array.from(runtime.mapByKey.keys())) {
      if (key === currentKey) continue;
      runtime.mapByKey.delete(key);
      changed = true;
    }
    if (changed) invalidateCellCaches();
  }

  function mapKey(dungeonId, floorId) {
    return `${dungeonId}:${floorId}`;
  }

  function getCurrentCoord() {
    const map = getCurrentMap();
    if (!map) return '';
    if (runtime.playerMapCoord && map.cells.has(runtime.playerMapCoord)) return runtime.playerMapCoord;
    if (runtime.game) {
      const resolved = resolveInitialGameCoord(runtime.game, map);
      if (resolved && resolved.coord && map.cells.has(resolved.coord)) {
        runtime.playerMapCoord = resolved.coord;
        runtime.game.coord = resolved.coord;
        runtime.game.syncMode = resolved.mode;
        runtime.game.syncScore = resolved.score;
        runtime.game.syncMatches = resolved.matches;
        return resolved.coord;
      }
      if (!isBattlePageActive() || hasMinimapTiles(runtime.game)) return '';
    }
    const stored = getStoredPlayerCoordForMap(map);
    if (stored) {
      runtime.playerMapCoord = stored;
      return stored;
    }
    return '';
  }

  function getRouteStartCoord(map) {
    const current = getCurrentCoord();
    if (current && map.cells.has(current)) return current;
    const stored = !hasMinimapTiles(runtime.game) ? getStoredPlayerCoordForMap(map) : '';
    if (stored && map.cells.has(stored)) return stored;
    if (runtime.playerMapCoord && map.cells.has(runtime.playerMapCoord)) return runtime.playerMapCoord;
    return map.startCoord || firstCellCoord(map);
  }

  function bindMapClickIfNeeded() {
    if (bindMapClickIfNeeded.done) return;
    if (!runtime.root) return;
    bindMapClickIfNeeded.done = true;
    runtime.root.addEventListener('click', event => {
      if (runtime.mapDrag && runtime.mapDrag.suppressClickUntil > Date.now()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const cellButton = event.target.closest('.bkpm-cell[data-coord]');
      if (!cellButton) return;
      const coord = cellButton.getAttribute('data-coord');
      if (runtime.mapCellClickGuard && runtime.mapCellClickGuard.coord === coord && runtime.mapCellClickGuard.until > Date.now()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (document.activeElement && runtime.root.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      selectMapCell(coord, { openDrawer: true });
    });
  }

  function selectMapCell(coord, options = {}) {
    const map = getCurrentMap();
    if (!coord || !map || !map.cells.has(coord)) return null;
    const start = getRouteStartCoord(map);
    const info = setRouteToSelection(map, start, coord);
    if (options.openDrawer) {
      runtime.state.drawerView = 'cell';
      runtime.state.drawerOpen = true;
    }
    saveStateSoon();
    if (options.center) centerOnCoord((info && info.targetCoord) || coord);
    queueRender(formatRouteStatus(info, coord));
    return info;
  }

  function setRouteToSelection(map, startCoord, selectedCoord) {
    const info = buildRouteInfo(map, startCoord, selectedCoord);
    runtime.state.selectedCoord = selectedCoord;
    runtime.state.targetCoord = info.targetCoord;
    runtime.state.routeStartCoord = startCoord;
    runtime.state.route = info.route;
    runtime.state.routeBlocked = info.blocked;
    return info;
  }

  function updateRouteFromStart(map, startCoord) {
    if (!map || !startCoord || !runtime.state.targetCoord) return null;
    let selected = runtime.state.targetCoord;
    if (runtime.state.selectedCoord && runtime.state.selectedCoord !== startCoord && map.cells.has(runtime.state.selectedCoord)) {
      const keyCoord = findKeyRouteTarget(map, startCoord, runtime.state.selectedCoord);
      selected = keyCoord && keyCoord === runtime.state.targetCoord ? runtime.state.selectedCoord : runtime.state.targetCoord;
    }
    const info = buildRouteInfo(map, startCoord, selected);
    runtime.state.targetCoord = info.targetCoord;
    runtime.state.routeStartCoord = startCoord;
    runtime.state.route = info.route;
    runtime.state.routeBlocked = info.blocked;
    return info;
  }

  function buildRouteInfo(map, startCoord, selectedCoord) {
    const resolved = resolveRouteTarget(map, startCoord, selectedCoord);
    const targetCoord = resolved.targetCoord || selectedCoord;
    let route = buildShortestRoute(map, startCoord, targetCoord);
    const blocked = !route.length || route[route.length - 1] !== targetCoord;
    if (blocked) route = [startCoord, targetCoord].filter(Boolean);
    return {
      selectedCoord,
      targetCoord,
      route,
      blocked,
      keyForCoord: resolved.keyForCoord || ''
    };
  }

  function resolveRouteTarget(map, startCoord, selectedCoord) {
    if (!map || !selectedCoord || !map.cells.has(selectedCoord)) {
      return { targetCoord: selectedCoord || '', keyForCoord: '' };
    }
    const keyCoord = findKeyRouteTarget(map, startCoord, selectedCoord);
    return keyCoord ? { targetCoord: keyCoord, keyForCoord: selectedCoord } : { targetCoord: selectedCoord, keyForCoord: '' };
  }

  function formatRouteStatus(info, selectedCoord) {
    const data = info || {
      targetCoord: runtime.state.targetCoord,
      route: runtime.state.route,
      keyForCoord: ''
    };
    if (data.keyForCoord) {
      return `Маршрут к ключу ${data.targetCoord} для ${data.keyForCoord}: ${(data.route || []).length} шагов`;
    }
    return `Маршрут до ${selectedCoord || data.targetCoord}: ${(data.route || []).length} шагов`;
  }

  function findKeyRouteTarget(map, startCoord, selectedCoord) {
    const selected = map.cells.get(selectedCoord);
    if (!selected || !isLockedRouteTargetCell(selected)) return '';
    const refs = extractCellCoordRefs(selected).filter(coord => coord !== selectedCoord && map.cells.has(coord));
    const keyRefs = refs.filter(coord => isKeyProviderCell(map.cells.get(coord)));
    if (keyRefs.length) return chooseNearestCoord(map, startCoord, keyRefs) || keyRefs[0];

    const keyNames = extractKeyNamesFromCell(selected);
    if (!keyNames.length) return '';
    const candidates = [];
    for (const cell of map.cells.values()) {
      if (!cell || cell.coord === selectedCoord) continue;
      if (keyNames.some(name => cellProvidesKeyName(cell, name))) candidates.push(cell.coord);
    }
    return chooseNearestCoord(map, startCoord, candidates);
  }

  function isLockedRouteTargetCell(cell) {
    if (!cell) return false;
    const refs = extractCellCoordRefs(cell);
    const keys = extractKeyNamesFromCell(cell);
    if (!refs.length && !keys.length) return false;
    return hasLockedDoorName(cell);
  }

  function hasLockedDoorName(cell) {
    const names = Array.isArray(cell && cell.names) ? cell.names : [];
    for (const name of names) {
      const text = normalizeName(name);
      if (!text || isKeyNameText(text) || /^можно\s+получить/.test(text) || /поведение/.test(text)) continue;
      if (/двер|замок|закрыт|люк|проход|тоннел|тонел|отсек|помещ|администрац|распредел|опасн|хозяйствен/.test(text)) return true;
    }
    return false;
  }

  function isKeyProviderCell(cell) {
    return extractKeyNamesFromCell(cell).length > 0;
  }

  function extractKeyNamesFromCell(cell) {
    if (!cell) return [];
    const values = []
      .concat(Array.isArray(cell.dropItems) ? cell.dropItems.map(item => item && item.name) : [])
      .concat(Array.isArray(cell.names) ? cell.names : []);
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const text = normalizeName(value);
      if (!text || !isKeyNameText(text)) continue;
      const clean = text
        .replace(/\bможно\s+получить\b/g, ' ')
        .replace(/\bповедение\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      result.push(clean);
    }
    return result;
  }

  function isKeyNameText(text) {
    return /ключ|отмыч|жвал|пропуск|вентил/.test(text);
  }

  function cellProvidesKeyName(cell, keyName) {
    if (!cell || !keyName) return false;
    return extractKeyNamesFromCell(cell).some(name => name === keyName || name.includes(keyName) || keyName.includes(name));
  }

  function chooseNearestCoord(map, startCoord, coords) {
    if (!map || !coords || !coords.length) return '';
    const start = startCoord && map.cells.get(startCoord);
    let best = '';
    let bestScore = Infinity;
    for (const coord of coords) {
      const cell = map.cells.get(coord);
      if (!cell) continue;
      const score = start ? Math.abs(cell.col - start.col) + Math.abs(cell.row - start.row) : 0;
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    }
    return best;
  }

  function buildShortestRoute(map, startCoord, targetCoord) {
    if (!startCoord || !targetCoord || !map.cells.has(startCoord) || !map.cells.has(targetCoord)) return [];
    if (startCoord === targetCoord) return [startCoord];
    const queue = [startCoord];
    const visited = new Set([startCoord]);
    const parent = new Map();

    while (queue.length) {
      const coord = queue.shift();
      if (coord === targetCoord) break;
      for (const next of getNeighbors(map, coord)) {
        if (visited.has(next)) continue;
        visited.add(next);
        parent.set(next, coord);
        queue.push(next);
      }
    }

    if (!visited.has(targetCoord)) return [startCoord];
    const path = [targetCoord];
    let current = targetCoord;
    while (current !== startCoord) {
      current = parent.get(current);
      if (!current) return [startCoord];
      path.push(current);
    }
    return path.reverse();
  }

  function buildCoverageRoute(map, startCoord) {
    if (!startCoord || !map.cells.has(startCoord)) startCoord = firstCellCoord(map);
    if (!startCoord) return [];

    const remaining = new Set(Array.from(map.cells.keys()));
    const route = [startCoord];
    remaining.delete(startCoord);
    let current = startCoord;
    let guard = map.cells.size * 12;

    while (remaining.size && guard-- > 0 && route.length < 1600) {
      const nearest = nearestRemainingPath(map, current, remaining);
      if (!nearest || nearest.length < 2) {
        const fallback = nearestRemainingCoordByGrid(map, current, remaining);
        if (!fallback) break;
        route.push(fallback);
        remaining.delete(fallback);
        current = fallback;
        continue;
      }
      for (const coord of nearest.slice(1)) {
        route.push(coord);
        remaining.delete(coord);
      }
      current = route[route.length - 1];
    }
    return route;
  }

  function nearestRemainingCoordByGrid(map, startCoord, remaining) {
    const start = map && map.cells ? map.cells.get(startCoord) : null;
    if (!start || !remaining || !remaining.size) return '';
    let best = '';
    let bestScore = Infinity;
    for (const coord of remaining) {
      const cell = map.cells.get(coord);
      if (!cell) continue;
      const score = Math.abs(cell.col - start.col) + Math.abs(cell.row - start.row);
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    }
    return best;
  }

  function nearestRemainingPath(map, startCoord, remaining) {
    const queue = [startCoord];
    const visited = new Set([startCoord]);
    const parent = new Map();
    let found = '';
    while (queue.length) {
      const coord = queue.shift();
      if (remaining.has(coord)) {
        found = coord;
        break;
      }
      for (const next of getNeighbors(map, coord)) {
        if (visited.has(next)) continue;
        visited.add(next);
        parent.set(next, coord);
        queue.push(next);
      }
    }
    if (!found) return null;
    const path = [found];
    let current = found;
    while (current !== startCoord) {
      current = parent.get(current);
      if (!current) return null;
      path.push(current);
    }
    return path.reverse();
  }

  function getRouteSpecialLinks(map) {
    if (!map || !map.cells) return new Map();
    if (map.__bkpmRouteSpecialLinks) return map.__bkpmRouteSpecialLinks;
    const links = new Map();
    const cells = Array.from(map.cells.values());
    const portalGroups = new Map();
    const unnamedPortals = [];

    function addLink(a, b) {
      if (!a || !b || a === b || !map.cells.has(a) || !map.cells.has(b)) return;
      if (!links.has(a)) links.set(a, new Set());
      if (!links.has(b)) links.set(b, new Set());
      links.get(a).add(b);
      links.get(b).add(a);
    }

    for (const cell of cells) {
      if (!cell) continue;
      if (isRouteTeleportCell(cell)) {
        for (const ref of extractCellCoordRefs(cell)) {
          if (map.cells.has(ref) && !isLockedRouteTargetCell(cell)) addLink(cell.coord, ref);
        }
      }
      if (isRoutePortalCell(cell) && !isLockedRouteTargetCell(cell)) {
        const group = getPortalGroupName(cell);
        if (group) {
          if (!portalGroups.has(group)) portalGroups.set(group, []);
          portalGroups.get(group).push(cell);
        } else {
          unnamedPortals.push(cell);
        }
      }
    }

    for (const group of portalGroups.values()) {
      if (group.length < 2 || group.length > 16) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) addLink(group[i].coord, group[j].coord);
      }
    }

    const namedPortals = Array.from(portalGroups.values()).flat();
    for (const cell of unnamedPortals) {
      const nearest = nearestPortalCell(cell, namedPortals.concat(unnamedPortals.filter(item => item.coord !== cell.coord)), 2);
      if (nearest) addLink(cell.coord, nearest.coord);
    }

    map.__bkpmRouteSpecialLinks = links;
    return links;
  }

  function nearestPortalCell(cell, candidates, maxDistance) {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (!candidate || candidate.coord === cell.coord) continue;
      const distance = Math.abs(candidate.col - cell.col) + Math.abs(candidate.row - cell.row);
      if (distance <= maxDistance && distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  function isRouteTeleportCell(cell) {
    if (!cell) return false;
    if (isRoutePortalCell(cell)) return true;
    if (cell.kind === 'portal') return false;
    const text = getRouteCellText(cell);
    return /телеп|утилизатор|слив|светляч|дорога\s+в|таинственный\s+круг|начало\s+пути|невидим[а-я\s]*переход|портал/.test(text);
  }

  function isRoutePortalCell(cell) {
    return Boolean(cell && cell.kind === 'portal' && !isRouteBlockedPortalCell(cell));
  }

  function isRouteBlockedPortalCell(cell) {
    const text = getRouteCellText(cell);
    return /баррикад/.test(text);
  }

  function getPortalGroupName(cell) {
    if (!isRoutePortalCell(cell)) return '';
    const names = Array.isArray(cell.names) ? cell.names : [];
    for (const name of names) {
      let value = normalizeName(name).replace(/\b[a-z]+\d+\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!value || /поведение|тип\s+бота|альт\s+обозначения/.test(value)) continue;
      return value;
    }
    return '';
  }

  function extractCellCoordRefs(cell) {
    const text = [
      Array.isArray(cell && cell.names) ? cell.names.join(' ') : '',
      cell && cell.html ? cell.html : ''
    ].join(' ');
    const result = [];
    const seen = new Set();
    const pattern = /\b([A-Z]{1,3}\d{1,2})\b/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const coord = String(match[1] || '').toUpperCase();
      if (seen.has(coord)) continue;
      seen.add(coord);
      result.push(coord);
    }
    return result;
  }

  function getRouteCellText(cell) {
    return normalizeName([
      cell && cell.kind,
      cell && cell.className,
      cell && Array.isArray(cell.names) ? cell.names.join(' ') : '',
      cell && Array.isArray(cell.dropItems) ? cell.dropItems.map(item => item && item.name).join(' ') : ''
    ].join(' '));
  }

  function getNeighbors(map, coord) {
    const cell = map.cells.get(coord);
    if (!cell) return [];
    const special = getRouteSpecialLinks(map).get(coord);
    if (map.source === 'live' || Number.isFinite(cell.gameX)) {
      const result = [
        ['n', cell.gameX, cell.gameY - 1, 's'],
        ['e', cell.gameX + 1, cell.gameY, 'w'],
        ['s', cell.gameX, cell.gameY + 1, 'n'],
        ['w', cell.gameX - 1, cell.gameY, 'e']
      ].map(([side, x, y, opposite]) => {
        if (cell.walls && cell.walls[side]) return '';
        const nextCoord = liveCoordKey(x, y);
        const next = map.cells.get(nextCoord);
        if (!next || (next.walls && next.walls[opposite])) return '';
        return nextCoord;
      }).filter(Boolean);
      if (special) {
        for (const next of special) if (!result.includes(next)) result.push(next);
      }
      return result;
    }
    const result = [];
    const candidates = [
      ['n', cell.col, cell.row - 1, 's'],
      ['e', cell.col + 1, cell.row, 'w'],
      ['s', cell.col, cell.row + 1, 'n'],
      ['w', cell.col - 1, cell.row, 'e']
    ];
    for (const [side, col, row, opposite] of candidates) {
      if (cell.walls[side]) continue;
      const nextCoord = `${numberToColumn(col)}${row}`;
      const next = map.cells.get(nextCoord);
      if (!next || next.walls[opposite]) continue;
      result.push(nextCoord);
    }
    if (special) {
      for (const next of special) if (!result.includes(next)) result.push(next);
    }
    return result;
  }

  function markVisited(map, coord) {
    const key = `${map.dungeonId}:${map.floorId}:${coord}`;
    runtime.state.visited[key] = true;
    const cell = map.cells.get(coord);
    if (isClearingMonsterCell(cell)) {
      runtime.state.clearedMonsters[key] = true;
    }
  }

  function isClearingMonsterCell(cell) {
    if (!cell) return false;
    if (cell.kind === 'monster') return true;
    if (cell.kind !== 'npc' || isCacheLikeCell(cell)) return false;
    const text = normalizeName((cell.names || []).join(' '));
    return /поведение|нападает|урон/.test(text);
  }

  function isVisited(map, coord) {
    if (!map || !coord) return false;
    return Boolean(runtime.state.visited[`${map.dungeonId}:${map.floorId}:${coord}`]);
  }

  function getClearedMonsterSet(map) {
    const prefix = `${map.dungeonId}:${map.floorId}:`;
    const result = new Set();
    for (const key of Object.keys(runtime.state.clearedMonsters || {})) {
      if (key.startsWith(prefix)) result.add(key.slice(prefix.length));
    }
    return result;
  }

  function buildLiveMap(game) {
    const dungeon = getCurrentDungeon();
    const floor = getCurrentFloor();
    const cells = new Map();
    const matrix = Array.isArray(game.matrix) ? game.matrix : [];
    const minX = Math.min(...matrix.map(cell => cell.x));
    const minY = Math.min(...matrix.map(cell => cell.y));
    let maxCol = 0;
    let maxRow = 0;

    for (const gameCell of matrix) {
      const col = gameCell.x - minX + 1;
      const row = gameCell.y - minY + 1;
      const coord = liveCoordKey(gameCell.x, gameCell.y);
      const objectEntities = Array.isArray(gameCell.objectEntities) ? gameCell.objectEntities : [];
      const userEntities = Array.isArray(gameCell.userEntities) ? gameCell.userEntities : [];
      const names = [...(gameCell.objects || []), ...(gameCell.users || [])].filter(Boolean);
      const hasUser = userEntities.length || (gameCell.users && gameCell.users.length);
      const hasAttack = userEntities.some(item => /attack=1|напасть/i.test(item.action || ''));
      const hasDialog = userEntities.some(item => /dialog=|поговорить/i.test(item.action || ''));
      const image = (userEntities.find(item => item.image) || objectEntities.find(item => item.image) || {}).image || '';
      const cell = {
        coord,
        label: `${gameCell.x},${gameCell.y}`,
        col,
        row,
        gameX: gameCell.x,
        gameY: gameCell.y,
        className: 'live',
        walls: gameCell.walls || { n: false, e: false, s: false, w: false },
        names,
        roomName: gameCell.name || '',
        path: gameCell.path || '',
        dropItems: [],
        image,
        kind: hasUser ? (hasDialog && !hasAttack ? 'npc' : 'monster') : gameCell.objects && gameCell.objects.length ? 'object' : 'room',
        html: ''
      };
      cells.set(coord, cell);
      maxCol = Math.max(maxCol, col);
      maxRow = Math.max(maxRow, row);
    }

    return {
      dungeonId: dungeon ? dungeon.id : runtime.state.dungeonId,
      dungeonTitle: dungeon ? dungeon.title : 'Грибница',
      floorId: floor ? floor.id : runtime.state.floorId,
      floorTitle: floor ? floor.title : (Number.isFinite(game.floorNumber) ? `${game.floorNumber} этаж` : 'этаж'),
      url: '',
      source: 'live',
      cells,
      maxCol,
      maxRow,
      startCoord: liveCoordKey(game.x, game.y),
      loadedAt: new Date().toISOString()
    };
  }

  function liveCoordKey(x, y) {
    return `${Number(x)}:${Number(y)}`;
  }

  function formatCoordLabel(coord) {
    return String(coord || '').replace(':', ',');
  }

  function resolveGameCoord(game, map) {
    if (!game || !map || !Number.isFinite(game.x) || !Number.isFinite(game.y)) {
      return game && game.coord ? { coord: game.coord, mode: 'raw', score: 0, matches: 0 } : null;
    }
    if (map.source === 'live') {
      return { coord: liveCoordKey(game.x, game.y), mode: 'live', score: game.matrix ? game.matrix.length : 1, matches: game.matrix ? game.matrix.length : 1 };
    }
    if (game.coordSource === 'minimap') return null;

    const calibrationKey = `${map.dungeonId}:${map.floorId}`;
    const known = runtime.coordCalibration[calibrationKey];
    const candidates = [];

    const directCandidates = [
      { dx: 0, dy: 0, mode: 'direct' },
      { dx: 1, dy: 1, mode: 'shift+1' },
      { dx: -1, dy: -1, mode: 'shift-1' }
    ];

    if (known && Number.isFinite(known.dx) && Number.isFinite(known.dy)) {
      candidates.push({ dx: known.dx, dy: known.dy, mode: 'calibrated', bias: 4 });
    }

    const anchorCandidates = findAnchorOffsets(game, map);
    for (const candidate of anchorCandidates.concat(directCandidates)) {
      candidates.push(candidate);
    }

    if (Array.isArray(game.matrix) && game.matrix.length) {
      for (const cell of map.cells.values()) {
        candidates.push({
          dx: cell.col - game.x,
          dy: cell.row - game.y,
          mode: 'matrix'
        });
      }
    }

    let best = null;
    const seen = new Set();
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.dx) || !Number.isFinite(candidate.dy)) continue;
      const key = `${candidate.dx},${candidate.dy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const coord = coordFromGrid(game.x + candidate.dx, game.y + candidate.dy);
      if (!map.cells.has(coord)) continue;
      const score = scoreGameOffset(game, map, candidate.dx, candidate.dy);
      const item = {
        coord,
        mode: candidate.mode,
        dx: candidate.dx,
        dy: candidate.dy,
        score: score.score + (candidate.anchors || 0) * 90 + (candidate.bias || 0),
        matches: score.matches + (candidate.anchors || 0)
      };
      if (!best || item.score > best.score) best = item;
    }

    if (best && map.cells.has(best.coord) && isReliableResolvedCoord(best, game)) {
      if (best.matches >= 2 || best.score >= 32) {
        runtime.coordCalibration[calibrationKey] = {
          dx: best.dx,
          dy: best.dy,
          score: best.score,
          matches: best.matches
        };
      }
      return best;
    }

    if (known && best && !isReliableResolvedCoord(best, game)) delete runtime.coordCalibration[calibrationKey];
    return game.coord && map.cells.has(game.coord)
      ? { coord: game.coord, mode: 'raw', score: 0, matches: 0 }
      : null;
  }

  function isReliableResolvedCoord(candidate, game) {
    if (!candidate) return false;
    const matrixSize = Array.isArray(game && game.matrix) ? game.matrix.length : 0;
    if (!matrixSize) return candidate.score >= 12 && candidate.matches >= 1;
    const minMatches = Math.max(4, Math.min(14, Math.floor(matrixSize * 0.08)));
    const minScore = Math.max(28, minMatches * 8);
    return candidate.matches >= minMatches && candidate.score >= minScore;
  }

  function findAnchorOffsets(game, map) {
    if (!Array.isArray(game.matrix) || !game.matrix.length || !map || !map.cells) return [];
    const offsets = new Map();
    const mapCells = Array.from(map.cells.values()).filter(cell => cell.names && cell.names.length);

    for (const gameCell of game.matrix) {
      const gameNames = [...(gameCell.objects || []), ...(gameCell.users || [])]
        .map(canonicalName)
        .filter(Boolean);
      if (!gameNames.length) continue;

      for (const mapCell of mapCells) {
        const mapNames = mapCell.names.map(canonicalName).filter(Boolean);
        if (!mapNames.length) continue;
        const matched = gameNames.some(name => mapNames.some(mapName => namesMatch(name, mapName)));
        if (!matched) continue;

        const dx = mapCell.col - gameCell.x;
        const dy = mapCell.row - gameCell.y;
        const key = `${dx},${dy}`;
        const old = offsets.get(key) || { dx, dy, anchors: 0, mode: 'anchor' };
        old.anchors++;
        offsets.set(key, old);
      }
    }

    return Array.from(offsets.values()).sort((a, b) => b.anchors - a.anchors).slice(0, 12);
  }

  function namesMatch(a, b) {
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  function scoreGameOffset(game, map, dx, dy) {
    let score = 0;
    let matches = 0;
    const gameCells = Array.isArray(game.matrix) && game.matrix.length
      ? game.matrix
      : [{ x: game.x, y: game.y, walls: null, objects: [], users: [] }];

    for (const gameCell of gameCells) {
      const coord = coordFromGrid(gameCell.x + dx, gameCell.y + dy);
      const mapCell = map.cells.get(coord);
      if (!mapCell) {
        score -= 6;
        continue;
      }
      matches++;
      score += coord === coordFromGrid(game.x + dx, game.y + dy) ? 18 : 4;
      if (gameCell.walls) score += compareWalls(gameCell.walls, mapCell.walls);

      const names = [...(gameCell.objects || []), ...(gameCell.users || [])].map(canonicalName);
      const mapNames = (mapCell.names || []).map(canonicalName);
      if (names.length && mapNames.length) {
        score += names.some(name => mapNames.some(mapName => namesMatch(name, mapName))) ? 8 : -2;
      }
    }

    return { score, matches };
  }

  function compareWalls(a, b) {
    let score = 0;
    for (const side of ['n', 'e', 's', 'w']) {
      score += Boolean(a[side]) === Boolean(b[side]) ? 4 : -5;
    }
    return score;
  }

  function coordFromGrid(col, row) {
    if (!Number.isFinite(col) || !Number.isFinite(row) || col < 1 || row < 1) return '';
    return `${numberToColumn(col)}${row}`;
  }

  function getVisitedSet(map) {
    const prefix = `${map.dungeonId}:${map.floorId}:`;
    const result = new Set();
    for (const key of Object.keys(runtime.state.visited || {})) {
      if (key.startsWith(prefix)) result.add(key.slice(prefix.length));
    }
    return result;
  }

  function findStartCoord(map) {
    const special = Array.from(map.cells.values()).find(cell => /enter/i.test(cell.className) || /вход|старт/i.test(cell.names.join(' ')));
    return special ? special.coord : firstCellCoord(map);
  }

  function firstCellCoord(map) {
    const first = Array.from(map.cells.values()).sort((a, b) => a.row - b.row || a.col - b.col)[0];
    return first ? first.coord : '';
  }

  function matchGuideEntries(cell, entries) {
    if (!cell || !entries || !entries.length) return [];
    const names = cell.names.map(normalizeName).filter(Boolean);
    const matches = [];
    for (const entry of entries) {
      const entryName = entry.normalized || normalizeName(entry.name);
      if (entryLocationMatchesCell(cell, entry)) {
        matches.push(entry);
        continue;
      }
      if (!entryName || !names.length) continue;
      if (names.some(name => name === entryName || name.includes(entryName) || entryName.includes(name))) {
        matches.push(entry);
      }
    }
    return dedupeGuideEntries(matches).slice(0, 6);
  }

  function matchGuideEntriesIndexed(cell, entries) {
    if (!cell || !entries || !entries.length) return [];
    const index = getGuideIndex(entries);
    const found = [];
    const seen = new Set();
    function add(entry) {
      if (!entry) return;
      const key = `${entry.type}|${entry.normalized || normalizeName(entry.name)}|${entry.locations || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push(entry);
    }

    const coordKey = normalizeName(cell.label || cell.coord);
    for (const entry of index.byCoord.get(coordKey) || []) {
      if (entryLocationMatchesCell(cell, entry)) add(entry);
    }

    for (const name of cell.names || []) {
      for (const key of guideLookupKeys(name)) {
        for (const entry of index.byName.get(key) || []) add(entry);
      }
    }

    return found.slice(0, 8);
  }

  function getGuideIndex(entries) {
    const scope = `${runtime.state.dungeonId}|${entries.length}|${runtime.cacheStamp}`;
    if (runtime.guideIndex && runtime.guideIndexScope === scope) return runtime.guideIndex;
    const byName = new Map();
    const byCoord = new Map();
    function push(map, key, entry) {
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }

    for (const entry of entries) {
      for (const key of guideLookupKeys(entry.name || entry.normalized || '')) push(byName, key, entry);
      const locations = String(entry.locations || '');
      const coords = locations.match(/[A-ZА-ЯЁ]+\d+/gi) || [];
      for (const coord of coords) push(byCoord, normalizeName(coord), entry);
    }

    runtime.guideIndexScope = scope;
    runtime.guideIndex = { byName, byCoord };
    return runtime.guideIndex;
  }

  function guideLookupKeys(value) {
    const normalized = normalizeName(value);
    if (!normalized) return [];
    const withoutLevel = normalized
      .replace(/\s+\d+$/g, '')
      .replace(/\s+\d+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const withoutCount = withoutLevel.replace(/\s+\d+$/g, '').trim();
    return Array.from(new Set([normalized, withoutLevel, withoutCount].filter(Boolean)));
  }

  function entryLocationMatchesCell(cell, entry) {
    if (!cell || !entry || !entry.locations) return false;
    const locations = normalizeName(entry.locations);
    const coord = normalizeName(cell.label || cell.coord);
    if (!coord || !locations.includes(coord)) return false;
    const floor = normalizeName(cell.floorTitle || '');
    if (!floor) return true;
    return !/этаж/i.test(entry.locations) || locations.includes(floor);
  }

  function buildCellTitle(cell, matches) {
    const lines = [cell.coord, labelCellKind(cell.kind)];
    if (cell.names.length) lines.push(cell.names.join(', '));
    for (const entry of matches.slice(0, 2)) {
      lines.push(`${entry.name}: ${entry.drops && entry.drops.length ? entry.drops.join(', ') : compactText(entry.details || entry.text, 120)}`);
    }
    return lines.join('\n');
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

  function cleanObjectName(value) {
    const text = cleanText(value)
      .replace(/^id\d+\s*/i, '')
      .replace(/\[[^\]]*]/g, '')
      .trim();
    if (!text || text.length < 3) return '';
    if (/^(id\d+|img|table|font|small)$/i.test(text)) return '';
    return text.slice(0, 90);
  }

  function cleanGuideName(value) {
    return cleanText(value)
      .replace(/\s+\d+\s*ур\.?.*$/i, '')
      .replace(/\s+\[[^\]]*]$/g, '')
      .trim();
  }

  function extractDrops(text) {
    const source = cleanText(text);
    const match = source.match(/можно\s+найти\s*:?\s*(.+?)(?:\s+Автор:|\s+Опубликовано:|$)/i);
    if (!match) return [];
    return match[1]
      .split(/\s{2,}|,|;|\s+\/\s+|\s+-->\s+/)
      .map(item => cleanText(item).replace(/\b(VF|F|P|EF|R|VR|ER|U|L)\b/g, '').trim())
      .filter(item => item.length >= 3)
      .slice(0, 12);
  }

  function extractDropItems(html, baseUrl) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const items = [];
    const seen = new Set();
    for (const link of Array.from(doc.querySelectorAll('a[href*="/items/"], a[class*="guide_link"]'))) {
      const name = cleanText(link.textContent);
      if (!name || name.length < 3) continue;
      const row = link.closest('tr, nobr, table, div') || link.parentElement;
      const img = row ? row.querySelector('img[src]') : null;
      const href = absolutizeUrl(link.getAttribute('href') || '', baseUrl);
      if (isDropLinkNoise(name, href)) continue;
      const image = img ? absolutizeUrl(img.getAttribute('src') || '', baseUrl) : '';
      const key = normalizeName(name) + '|' + href;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, href, image });
      if (items.length >= 18) break;
    }
    return items;
  }

  function absolutizeUrl(url, baseUrl) {
    const value = String(url || '').trim();
    if (!value) return '';
    try {
      return new URL(value, baseUrl || 'https://lib.paladins.ru/').href;
    } catch (error) {
      return value;
    }
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

  function labelCellKind(kind) {
    return {
      enter: 'вход',
      portal: 'переход/портал',
      npc: 'NPC',
      danger: 'опасная клетка',
      monster: 'монстр',
      object: 'объект или бот',
      room: 'проход'
    }[kind] || 'клетка';
  }

  function labelGuideType(type) {
    return {
      intro: 'введение',
      floor: 'этаж',
      npc: 'NPC',
      object: 'тайник',
      monster: 'бот'
    }[type] || 'данные';
  }

  function directionArrow(direction) {
    return directionInfo(direction).arrow;
  }

  function directionInfo(direction) {
    const value = normalizeGameDirection(direction);
    if (value === 'восток') return { name: 'восток', side: 'e', angle: 90, arrow: '→' };
    if (value === 'юг') return { name: 'юг', side: 's', angle: 180, arrow: '↓' };
    if (value === 'запад') return { name: 'запад', side: 'w', angle: 270, arrow: '←' };
    return { name: 'север', side: 'n', angle: 0, arrow: '↑' };
  }

  function normalizeGameDirection(direction) {
    return strictNormalizeGameDirection(direction) || 'север';
  }

  function strictNormalizeGameDirection(direction) {
    const value = normalizeName(direction);
    if (/север|north|^n$/.test(value)) return 'север';
    if (/восток|east|^e$/.test(value)) return 'восток';
    if (/юг|south|^s$/.test(value)) return 'юг';
    if (/запад|west|^w$/.test(value)) return 'запад';
    return '';
  }

  function parseCoord(coord) {
    const match = String(coord || '').match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    return { col: columnToNumber(match[1]), row: Number(match[2]) };
  }

  function columnToNumber(value) {
    let result = 0;
    for (const char of String(value || '').toUpperCase()) {
      const code = char.charCodeAt(0);
      if (code < 65 || code > 90) return 0;
      result = result * 26 + (code - 64);
    }
    return result;
  }

  function numberToColumn(value) {
    let num = Number(value);
    if (!Number.isFinite(num) || num < 1) return '';
    let result = '';
    while (num > 0) {
      num--;
      result = String.fromCharCode(65 + (num % 26)) + result;
      num = Math.floor(num / 26);
    }
    return result;
  }

  function centerOnCoord(coord, behavior) {
    if (!coord) return;
    const wrap = runtime.root.querySelector('[data-role="mapWrap"]');
    const button = runtime.root.querySelector(`.bkpm-cell[data-coord="${CSS.escape(coord)}"]`);
    if (!wrap || !button) return;
    const hudOffset = getMapHudOffset();
    const visibleHeight = Math.max(140, wrap.clientHeight - hudOffset);
    const targetY = hudOffset + visibleHeight / 2;
    const left = button.offsetLeft - wrap.clientWidth / 2 + button.clientWidth / 2;
    const top = button.offsetTop - targetY + button.clientHeight / 2;
    wrap.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: behavior || 'smooth' });
  }

  function getMapHudOffset() {
    const hud = runtime.root && runtime.root.querySelector('.bkpm-map-hud');
    if (!hud) return 0;
    const height = hud.getBoundingClientRect ? hud.getBoundingClientRect().height : 0;
    return Math.ceil(Math.max(0, height) + 18);
  }

  function getBodyText(doc) {
    return doc && doc.body ? String(doc.body.innerText || doc.body.textContent || '') : '';
  }

  function nextElementAfter(node) {
    let current = node.nextSibling;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE) return current;
      if (current.nodeType === Node.TEXT_NODE && cleanText(current.nodeValue)) return null;
      current = current.nextSibling;
    }
    return null;
  }

  function decodeHtml(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function cleanText(value) {
    return decodeHtml(value).replace(/\s+/g, ' ').trim();
  }

  function compactText(value, limit) {
    const text = cleanText(value);
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
  }

  function normalizeName(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonicalName(value) {
    return normalizeName(value)
      .replace(/\s+\d+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hashText(value) {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  function shortLabel(value) {
    const text = cleanText(value);
    if (text.length <= 12) return text;
    return text.split(/\s+/).map(part => part[0]).join('').slice(0, 4).toUpperCase() || text.slice(0, 4);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
  }

  function formatError(error) {
    return error && error.message ? error.message : String(error);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/`/g, '&#096;');
  }
})();
