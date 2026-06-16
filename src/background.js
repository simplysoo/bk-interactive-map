/*!
 * Интерактивная карта БК
 * Copyright (c) 2026 simplysoo [12]. All rights reserved.
 * Personal use only. See LICENSE.md.
 */
chrome.action.onClicked.addListener(tab => {
  if (!tab || !tab.id || !isCombatsUrl(tab.url)) return;
  togglePanel(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'bkpmFetchPaladins') return false;

  const url = String(message.url || '');
  if (!/^https:\/\/lib\.paladins\.ru\//i.test(url)) {
    sendResponse({ ok: false, error: 'Разрешены только страницы https://lib.paladins.ru/' });
    return false;
  }

  fetch(url, {
    method: 'GET',
    credentials: 'omit',
    cache: message.noCache ? 'reload' : 'default'
  })
    .then(async response => {
      const text = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        url: response.url,
        text,
        error: response.ok ? '' : `HTTP ${response.status}`
      });
    })
    .catch(error => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });

  return true;
});

function isCombatsUrl(url) {
  return /^https?:\/\/[^/]*combats\.com\//i.test(String(url || ''));
}

function togglePanel(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'bkpmTogglePanel' }, response => {
    if (!chrome.runtime.lastError && response && response.ok) return;
    injectContent(tabId, () => {
      chrome.tabs.sendMessage(tabId, { type: 'bkpmTogglePanel' }, () => {
        chrome.runtime.lastError;
      });
    });
  });
}

function injectContent(tabId, done) {
  chrome.scripting.insertCSS({
    target: { tabId },
    files: ['src/panel.css']
  }, () => {
    chrome.runtime.lastError;
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/dungeons.js', 'src/content.js']
    }, () => {
      chrome.runtime.lastError;
      if (typeof done === 'function') done();
    });
  });
}
