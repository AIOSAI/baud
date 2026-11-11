(() => {
  const MARK = '↳ '; // marks the answer as yours, below the quote
  // Lines survive so multi-line passages stay multi-line; whitespace inside a line collapses.
  const quote = (text, answer) => {
    let q = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (q.length > 600) q = q.slice(0, 599) + '…';
    // Blank line between them: markdown would otherwise fold the answer into the quote.
    return '> ' + q.split('\n').join('\n> ') + '\n\n' + MARK + answer.trim() + '\n\n';
  };
  if (typeof document === 'undefined') { globalThis.__seton = { quote }; return; }

  const SITES = [
    { host: /(^|\.)seedgo\.dev$/, message: '#agent-lines .tr:not(.you):not(.error):not(.tool):not(.working):not(.divider)', composer: '#text' },
    { host: /^claude\.ai$/, message: '[data-is-streaming], .font-claude-message, [data-testid="assistant-message"]', composer: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]' },
    { host: /^chatgpt\.com$/, message: '[data-message-author-role="assistant"]', composer: '#prompt-textarea, div[contenteditable="true"]' },
  ];
  // A host page that embeds Seton (an extension's own panel has no stable hostname) declares its
  // adapter as window.SETON_SITE = { message, composer } before this script runs.
  // test.html, opened as a file or served from localhost, uses the Seed adapter.
  const local = location.hostname === '' || location.hostname === 'localhost';
  const site = window.SETON_SITE || (local ? SITES[0] : SITES.find(s => s.host.test(location.hostname)));
  if (!site) return;

  const make = (tag, cls, props) => Object.assign(document.createElement(tag), { className: cls, hidden: true }, props);
  const chip = make('button', 'seton-chip', { type: 'button', textContent: 'Reply' });
  const box = make('div', 'seton-box');
  const input = make('textarea', 'seton-input', { rows: 1, placeholder: 'Reply…', hidden: false });
  const send = make('button', 'seton-send', { type: 'button', textContent: '↵', title: 'Add to composer', hidden: false });
  const note = make('div', 'seton-note', { hidden: false });
  box.append(input, send, note);
  document.documentElement.append(chip, box);

  const coarse = matchMedia('(pointer: coarse)');
  let picked = '', rect = null, noteTimer, selTimer, press, sx = 0, sy = 0;

  const elOf = n => (n && n.nodeType === 1 ? n : n && n.parentElement);
  const inMessage = n => { const e = elOf(n); return !!(e && e.closest(site.message) && !e.closest(site.composer)); };
  // Try composer selectors in priority order; querySelector on a list would return document order.
  const findComposer = () => site.composer.split(',').map(s => document.querySelector(s)).find(Boolean);

  const place = node => {
    node.hidden = false;
    const maxLeft = scrollX + document.documentElement.clientWidth - node.offsetWidth - 8;
    node.style.left = Math.max(scrollX + 8, Math.min(rect.left + scrollX, maxLeft)) + 'px';
    node.style.top = Math.max(scrollY + 8, rect.top + scrollY - node.offsetHeight - 6) + 'px';
  };

  const check = () => {
    if (off || !box.hidden) return;
    const sel = getSelection();
    if (!sel.rangeCount || !sel.toString().trim() || !inMessage(sel.anchorNode)) { chip.hidden = true; return; }
    picked = sel.toString();
    rect = sel.getRangeAt(0).getBoundingClientRect();
    place(chip);
  };

  const close = () => { box.hidden = true; };

  // The popup's switch and its "is it running here" question; absent on file: pages.
  let off = false;
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('setonOff', v => { off = !!v.setonOff; });
    chrome.storage.onChanged.addListener(ch => { if (ch.setonOff) { off = !!ch.setonOff.newValue; if (off) { chip.hidden = true; close(); } } });
    chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m === 'seton?') reply({ off, host: location.hostname, messages: document.querySelectorAll(site.message).length }); });
  }

  const insert = (c, text) => {
    if (c instanceof HTMLTextAreaElement) {
      // Native setter so React's value tracker sees a change.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(c, c.value + text);
      c.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    c.focus();
    const r = document.createRange();
    r.selectNodeContents(c);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    if (!document.execCommand('insertText', false, text)) {
      c.append(text);
      c.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const submit = () => {
    const answer = input.value;
    if (!answer.trim()) return;
    const c = findComposer();
    if (!c) {
      note.textContent = 'Seton: no composer found on this page';
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { note.textContent = ''; }, 2000);
      return;
    }
    insert(c, quote(picked, answer));
    getSelection().removeAllRanges();
    close();
    if (coarse.matches) c.blur(); else c.focus();
  };

  chip.addEventListener('pointerdown', e => e.preventDefault()); // keep the page selection alive
  chip.addEventListener('click', () => {
    chip.hidden = true;
    input.value = '';
    note.textContent = '';
    place(box);
    input.focus();
  });
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') close();
  });

  document.addEventListener('pointerdown', e => { if (!box.hidden && !box.contains(e.target)) close(); }, true);
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(check, 150); });
  document.addEventListener('mouseup', () => setTimeout(check, 0));
  document.addEventListener('touchend', () => { clearTimeout(press); setTimeout(check, 0); });
  document.addEventListener('touchcancel', () => clearTimeout(press));
  // Chat pages scroll inner containers, so a document-positioned chip would drift; hide it instead.
  document.addEventListener('scroll', () => { chip.hidden = true; }, true);

  document.addEventListener('touchstart', e => {
    clearTimeout(press);
    if (e.touches.length !== 1 || !inMessage(e.target)) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    const target = elOf(e.target);
    press = setTimeout(() => {
      const msg = target.closest(site.message);
      let block = target.closest('p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td');
      if (!block || !msg.contains(block)) block = msg;
      const r = document.createRange();
      r.selectNodeContents(block);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      check();
    }, 500);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(press);
  }, { passive: true });

  setTimeout(() => { if (!document.querySelector(site.message)) console.warn('seton: no messages matched', site.message); }, 10000);
})();
