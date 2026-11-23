/**
 * LP/HPに貼る埋め込みチャット。
 *
 *   <script src="https://YOUR_APP/widget.js" data-site-key="pk_xxx" async></script>
 *
 * オプション(data属性): data-title, data-greeting, data-color(#RRGGBB), data-position(left|right)
 * 返信テキストはすべて textContent で描画します（XSS対策）。
 */
export const WIDGET_JS = String.raw`(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var siteKey = script.getAttribute('data-site-key');
  if (!siteKey) { console.warn('[lead-widget] data-site-key がありません'); return; }
  var api = new URL(script.src).origin + '/api/inbound/web';
  var title = script.getAttribute('data-title') || 'ご相談チャット';
  var greeting = script.getAttribute('data-greeting') || 'こんにちは！ご質問があればお気軽にどうぞ😊';
  var color = /^#[0-9a-fA-F]{6}$/.test(script.getAttribute('data-color') || '') ? script.getAttribute('data-color') : '#f59e0b';
  var left = script.getAttribute('data-position') === 'left';

  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (e) {}
    return 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var sessionId;
  try {
    sessionId = localStorage.getItem('lead_widget_sid');
    if (!sessionId) { sessionId = uid(); localStorage.setItem('lead_widget_sid', sessionId); }
  } catch (e) { sessionId = uid(); }

  var utm = {};
  try {
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (/^utm_|^ref$|^gclid$|^fbclid$/.test(k)) utm[k] = String(v).slice(0, 100);
    });
  } catch (e) {}

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  var side = left ? 'left:20px;' : 'right:20px;';
  var btn = el('button', 'position:fixed;bottom:20px;' + side + 'z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';color:#111;font-size:26px;box-shadow:0 6px 20px rgba(0,0,0,.3)', '💬');
  btn.setAttribute('aria-label', title);
  var box = el('div', 'position:fixed;bottom:88px;' + side + 'z-index:2147483000;width:min(340px,calc(100vw - 24px));height:min(480px,calc(100vh - 120px));display:none;flex-direction:column;background:#fff;color:#111;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif');
  var head = el('div', 'padding:12px 14px;font-weight:700;background:' + color + ';color:#111', title);
  var list = el('div', 'flex:1;overflow-y:auto;padding:12px;background:#f6f7f9');
  var form = el('form', 'display:flex;gap:6px;padding:8px;border-top:1px solid #e5e7eb;background:#fff');
  var input = el('input', 'flex:1;min-width:0;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px');
  input.type = 'text'; input.maxLength = 1000; input.placeholder = 'メッセージを入力';
  var send = el('button', 'padding:0 14px;border:0;border-radius:8px;background:' + color + ';color:#111;font-weight:700;cursor:pointer', '送信');
  send.type = 'submit';
  form.appendChild(input); form.appendChild(send);
  box.appendChild(head); box.appendChild(list); box.appendChild(form);
  document.body.appendChild(btn); document.body.appendChild(box);

  function bubble(text, mine) {
    var row = el('div', 'display:flex;margin:6px 0;justify-content:' + (mine ? 'flex-end' : 'flex-start'));
    var b = el('div', 'max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;' +
      (mine ? 'background:' + color + ';color:#111' : 'background:#fff;border:1px solid #e5e7eb'), text);
    row.appendChild(b); list.appendChild(row); list.scrollTop = list.scrollHeight;
    return row;
  }

  var opened = false, busy = false;
  btn.addEventListener('click', function () {
    opened = !opened;
    box.style.display = opened ? 'flex' : 'none';
    if (opened && !list.firstChild) bubble(greeting, false);
    if (opened) input.focus();
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = ''; busy = true; send.disabled = true;
    bubble(text, true);
    var typing = bubble('…', false);
    fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKey: siteKey, sessionId: sessionId, message: text, type: 'widget', page: location.href, utm: utm })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        list.removeChild(typing);
        bubble(d.reply || 'ただいま応答できません。時間をおいてお試しください。', false);
      })
      .catch(function () {
        list.removeChild(typing);
        bubble('通信エラーが発生しました。時間をおいてお試しください。', false);
      })
      .then(function () { busy = false; send.disabled = false; });
  });
})();
`;
