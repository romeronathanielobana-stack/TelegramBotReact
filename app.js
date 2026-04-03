// ── CONFIG ──────────────────────────────────────────────
const EMOJIS = [
  '👍','👎','❤️','🔥','🎉','🤩','🥰','😁','😱','😢',
  '💯','🤣','😂','🙏','👏','😍','🤔','🤯','😎','🫡',
  '💀','⚡','🌚','🌭','💋','👻','🎃','🎄','🎆','🎇',
  '🦄','🐳','🕊️','🐾','🍓','🍾','🍕','🎸','🎯','🏆'
];

// ── AUTH STATE ──────────────────────────────────────────
let currentUser = null; // username string when logged in

// ── BOT STATE ───────────────────────────────────────────
let tokens          = [];
let selected        = new Set();
let running         = false;
let pollTimer       = null;
let seenMsgs        = new Set();
let updateOffset    = 0;
let stats           = { bots:0, reactions:0, messages:0 };
let tokenIdxCounter = 0;

// ── INIT ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildEmojiGrid();
  refreshUsersHint();

  // Auto-restore session
  const saved = sessionStorage.getItem('tgActiveUser');
  if (saved && getUsers()[saved]) {
    currentUser = saved;
    showApp();
  }
});

// ═══════════════════════════════════════════════════════
//  AUTH HELPERS
// ═══════════════════════════════════════════════════════

/** Simple hash — not cryptographic, just obfuscation for localStorage */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_tgAutoReact_salt');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem('tgAR_users') || '{}'); } catch(_) { return {}; }
}

function saveUsers(users) {
  try { localStorage.setItem('tgAR_users', JSON.stringify(users)); } catch(_) {}
}

function getUserStorageKey(username) {
  return `tgAR_data_${username}`;
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginForm').style.display  = isLogin ? '' : 'none';
  document.getElementById('signupForm').style.display = isLogin ? 'none' : '';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabSignup').classList.toggle('active', !isLogin);
  document.getElementById('loginMsg').className  = 'auth-msg';
  document.getElementById('signupMsg').className = 'auth-msg';
}

function refreshUsersHint() {
  const users  = Object.keys(getUsers());
  const hint   = document.getElementById('usersHint');
  if (users.length > 0) {
    hint.textContent = `${users.length} account(s) registered on this browser`;
  } else {
    hint.textContent = 'No accounts yet — sign up to get started';
  }
}

async function doSignup() {
  const username = document.getElementById('signupUser').value.trim().toLowerCase();
  const pass     = document.getElementById('signupPass').value;
  const pass2    = document.getElementById('signupPass2').value;
  const msgEl    = document.getElementById('signupMsg');

  msgEl.className = 'auth-msg';

  if (!username || username.length < 3) return showAuthMsg(msgEl, 'error', 'Username must be at least 3 characters.');
  if (!/^[a-z0-9_]+$/.test(username))  return showAuthMsg(msgEl, 'error', 'Only letters, numbers and underscores allowed.');
  if (pass.length < 6)                  return showAuthMsg(msgEl, 'error', 'Password must be at least 6 characters.');
  if (pass !== pass2)                   return showAuthMsg(msgEl, 'error', 'Passwords do not match.');

  const users = getUsers();
  if (users[username])                  return showAuthMsg(msgEl, 'error', 'Username already taken.');

  const hash      = await hashPassword(pass);
  users[username] = { hash, createdAt: Date.now() };
  saveUsers(users);

  showAuthMsg(msgEl, 'ok', 'Account created! Logging you in...');
  setTimeout(() => loginAs(username), 700);
  refreshUsersHint();
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass     = document.getElementById('loginPass').value;
  const msgEl    = document.getElementById('loginMsg');

  msgEl.className = 'auth-msg';

  if (!username || !pass) return showAuthMsg(msgEl, 'error', 'Please enter username and password.');

  const users = getUsers();
  if (!users[username])  return showAuthMsg(msgEl, 'error', 'Account not found.');

  const hash = await hashPassword(pass);
  if (users[username].hash !== hash) return showAuthMsg(msgEl, 'error', 'Incorrect password.');

  loginAs(username);
}

function loginAs(username) {
  currentUser = username;
  sessionStorage.setItem('tgActiveUser', username);
  showApp();
}

function doLogout() {
  if (running) stopBot();
  saveToStorage();
  currentUser = null;
  sessionStorage.removeItem('tgActiveUser');

  // Reset bot state
  tokens = []; selected = new Set(); tokenIdxCounter = 0;
  stats  = { bots:0, reactions:0, messages:0 };
  document.getElementById('statBots').textContent      = '0';
  document.getElementById('statReactions').textContent = '0';
  document.getElementById('statMessages').textContent  = '0';
  document.getElementById('tokenList').innerHTML       = '';
  document.getElementById('logBox').innerHTML = '<div class="log-line"><span class="log-time">00:00:00</span><span class="log-info">// System ready. Configure tokens and press Start Bot.</span></div>';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;

  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  refreshUsersHint();
  // Clear login fields
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  switchTab('login');
}

function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display  = '';
  document.getElementById('userPill').textContent = currentUser;
  buildEmojiGrid();
  loadFromStorage();
}

function showAuthMsg(el, type, msg) {
  el.className = `auth-msg ${type}`;
  el.textContent = msg;
}

// ═══════════════════════════════════════════════════════
//  PER-USER STORAGE
// ═══════════════════════════════════════════════════════

function saveToStorage() {
  if (!currentUser) return;
  const data = {
    tokens:   tokens.map(t => ({...t, valid: null})),
    selected: [...selected],
    chatId:   document.getElementById('chatId').value,
    delay:    document.getElementById('delay').value,
    poll:     document.getElementById('pollInterval').value,
    mode:     document.getElementById('reactionMode').value,
    auto:     document.getElementById('autoToggle').checked,
    autoJoin: document.getElementById('autoJoinToggle').checked,
  };
  try { localStorage.setItem(getUserStorageKey(currentUser), JSON.stringify(data)); } catch(_) {}
}

function loadFromStorage() {
  if (!currentUser) return;
  try {
    const raw = localStorage.getItem(getUserStorageKey(currentUser));
    if (!raw) { addToken(); return; }
    const d = JSON.parse(raw);

    if (d.tokens?.length) {
      document.getElementById('tokenList').innerHTML = '';
      tokens = [];
      d.tokens.forEach(t => addToken(t.token));
    } else {
      addToken();
    }

    if (d.selected) { selected = new Set(d.selected); refreshEmojiGrid(); }
    if (d.chatId)   document.getElementById('chatId').value = d.chatId;
    if (d.delay)    document.getElementById('delay').value  = d.delay;
    if (d.poll)     document.getElementById('pollInterval').value = d.poll;
    if (d.mode)     document.getElementById('reactionMode').value = d.mode;
    if (d.auto !== undefined)     document.getElementById('autoToggle').checked     = d.auto;
    if (d.autoJoin !== undefined) document.getElementById('autoJoinToggle').checked = d.autoJoin;
  } catch(_) { addToken(); }
}

// ═══════════════════════════════════════════════════════
//  TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════

function addToken(prefill = '') {
  const id  = ++tokenIdxCounter;
  const obj = { id, token: prefill, name: `Bot #${id}`, valid: null };
  tokens.push(obj);

  const row = document.createElement('div');
  row.className   = 'token-row';
  row.dataset.id  = id;
  row.innerHTML   = `
    <span class="token-label">BOT TOKEN ${id}</span>
    <input type="text" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
           value="${escHtml(prefill)}"
           oninput="onTokenInput(${id}, this.value)"
           autocomplete="off" spellcheck="false" />
    <span class="status-dot" id="dot-${id}" title="Unknown"></span>
    <button class="btn-icon" onclick="removeToken(${id})" title="Remove">✕</button>
  `;
  document.getElementById('tokenList').appendChild(row);
  updateBotCount();
}

function onTokenInput(id, val) {
  const t = tokens.find(x => x.id === id);
  if (t) { t.token = val.trim(); t.valid = null; }
  const dot = document.getElementById(`dot-${id}`);
  if (dot) { dot.className = 'status-dot'; dot.title = 'Unknown'; }
  updateBotCount();
  saveToStorage();
}

function removeToken(id) {
  tokens = tokens.filter(t => t.id !== id);
  const row = document.querySelector(`.token-row[data-id="${id}"]`);
  if (row) row.remove();
  updateBotCount();
  saveToStorage();
}

function updateBotCount() {
  const valid = tokens.filter(t => t.token && t.valid !== false).length;
  stats.bots  = valid;
  document.getElementById('statBots').textContent = valid;
}

// ═══════════════════════════════════════════════════════
//  EMOJI GRID
// ═══════════════════════════════════════════════════════

function buildEmojiGrid() {
  const grid = document.getElementById('emojiGrid');
  if (!grid) return;
  grid.innerHTML = '';
  EMOJIS.forEach((em, i) => {
    const btn       = document.createElement('button');
    btn.className   = 'emoji-btn';
    btn.textContent = em;
    btn.title       = em;
    btn.onclick     = () => toggleEmoji(i, btn);
    btn.id          = `em-${i}`;
    grid.appendChild(btn);
  });
}

function toggleEmoji(i, btn) {
  if (selected.has(i)) { selected.delete(i); btn.classList.remove('selected'); }
  else                  { selected.add(i);    btn.classList.add('selected');    }
  saveToStorage();
}

function refreshEmojiGrid() {
  EMOJIS.forEach((_, i) => {
    const btn = document.getElementById(`em-${i}`);
    if (btn) btn.classList.toggle('selected', selected.has(i));
  });
}

// ═══════════════════════════════════════════════════════
//  TOKEN VALIDATION
// ═══════════════════════════════════════════════════════

async function testTokens() {
  log('Validating tokens...', 'info');
  let ok = 0;
  for (const t of tokens) {
    if (!t.token) continue;
    const dot = document.getElementById(`dot-${t.id}`);
    dot.className = 'status-dot checking';
    dot.title     = 'Checking...';
    try {
      const res = await callApi(t.token, 'getMe', {});
      if (res.ok) {
        t.valid = true;
        t.name  = `@${res.result.username}`;
        dot.className = 'status-dot ok';
        dot.title     = t.name;
        log(`✓ Token #${t.id} valid → ${t.name}`, 'ok');
        ok++;
      } else {
        throw new Error(res.description || 'Unknown error');
      }
    } catch(e) {
      t.valid       = false;
      dot.className = 'status-dot error';
      dot.title     = 'Invalid token';
      log(`✗ Token #${t.id} invalid → ${e.message}`, 'error');
    }
  }
  log(`Validation done: ${ok}/${tokens.filter(x => x.token).length} valid.`, ok > 0 ? 'ok' : 'error');
  updateBotCount();
  return ok;
}

// ═══════════════════════════════════════════════════════
//  AUTO-JOIN BOTS TO CHANNEL
// ═══════════════════════════════════════════════════════

async function ensureBotsJoined(chatId, validToks) {
  if (!document.getElementById('autoJoinToggle').checked) return;
  log('Auto-join: checking bot membership...', 'info');

  for (const tok of validToks) {
    try {
      // Check current membership
      const meRes = await callApi(tok.token, 'getMe', {});
      if (!meRes.ok) continue;
      const botId = meRes.result.id;

      const memberRes = await callApi(tok.token, 'getChatMember', { chat_id: chatId, user_id: botId });

      if (memberRes.ok) {
        const status = memberRes.result.status;
        if (['member', 'administrator', 'creator'].includes(status)) {
          log(`${tok.name} already a member of the channel.`, 'ok');
          continue;
        }
        // If kicked/banned, we cannot auto-join — admin must unban first
        if (status === 'kicked') {
          log(`${tok.name} is banned from the channel. Please unban it first.`, 'error');
          continue;
        }
      }

      // Try to join
      log(`${tok.name} not a member — attempting joinChat...`, 'warn');
      const joinRes = await callApi(tok.token, 'joinChat', { chat_id: chatId });
      if (joinRes.ok) {
        log(`${tok.name} successfully joined the channel! ✓`, 'ok');
      } else {
        log(`${tok.name} failed to join: ${joinRes.description}`, 'error');
        log(`→ Make sure the channel is public or add ${tok.name} as admin manually.`, 'warn');
      }
    } catch(e) {
      log(`${tok.name} join error: ${e.message}`, 'error');
    }
    await sleep(600);
  }
}

// ═══════════════════════════════════════════════════════
//  BOT CORE
// ═══════════════════════════════════════════════════════

async function startBot() {
  const chatId = document.getElementById('chatId').value.trim();
  if (!chatId)                                    { log('Please enter a channel/group username or ID.', 'warn'); return; }
  if (!tokens.filter(t => t.token).length)        { log('Add at least one bot token.', 'warn'); return; }
  if (!selected.size)                             { log('Select at least one reaction emoji.', 'warn'); return; }

  const ok = await testTokens();
  if (!ok) { log('No valid tokens. Bot not started.', 'error'); return; }

  const validToks = tokens.filter(t => t.valid);

  // Auto-join bots if enabled
  await ensureBotsJoined(chatId, validToks);

  // Reset state and flush old pending updates
  updateOffset = 0;
  seenMsgs.clear();
  await flushUpdates(validToks[0].token);

  running = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setProgress(100);

  const pollMs = parseInt(document.getElementById('pollInterval').value, 10) * 1000 || 5000;
  log(`Bot started | ${validToks.length} bot(s) | polling every ${pollMs/1000}s | chat: ${chatId}`, 'ok');

  pollTimer = setInterval(() => pollMessages(chatId, validToks), pollMs);
}

async function flushUpdates(token) {
  try {
    log('Flushing old updates (skipping past messages)...', 'info');
    const res = await callApi(token, 'getUpdates', { offset: -1, timeout: 0 });
    if (res.ok && res.result && res.result.length) {
      updateOffset = res.result[res.result.length - 1].update_id + 1;
      log(`Ready. Offset = ${updateOffset}`, 'info');
    } else {
      log('No old updates. Watching for new messages...', 'info');
    }
  } catch(e) {
    log(`Flush warning: ${e.message}`, 'warn');
  }
}

function stopBot() {
  running = false;
  clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setProgress(0);
  log('Bot stopped.', 'warn');
}

async function pollMessages(chatId, validToks) {
  if (!running) return;
  log(`Polling... (offset: ${updateOffset})`, 'info');

  try {
    const res = await callApi(validToks[0].token, 'getUpdates', {
      offset:          updateOffset,
      timeout:         3,
      allowed_updates: ['message', 'channel_post'],
    });

    if (!res.ok) {
      log(`getUpdates failed: ${res.description}`, 'error');
      return;
    }

    const updates = res.result || [];
    log(`Got ${updates.length} update(s).`, 'info');

    for (const upd of updates) {
      updateOffset = upd.update_id + 1;

      const msg = upd.channel_post || upd.message;
      if (!msg) {
        log(`Update #${upd.update_id} skipped (no message content).`, 'info');
        continue;
      }

      const msgKey = `${msg.chat.id}-${msg.message_id}`;
      if (seenMsgs.has(msgKey)) continue;
      seenMsgs.add(msgKey);

      const inputChat   = chatId.replace('@', '').toLowerCase();
      const msgUsername = (msg.chat.username || '').toLowerCase();
      const msgChatId   = String(msg.chat.id);
      const match       = msgUsername === inputChat || msgChatId === inputChat || msgChatId === chatId;

      log(`Message in "${msg.chat.username || msg.chat.id}" | match: ${match}`, 'info');
      if (!match) continue;

      stats.messages++;
      document.getElementById('statMessages').textContent = stats.messages;
      log(`New message #${msg.message_id} in "${msg.chat.title || chatId}"`, 'ok');

      if (document.getElementById('autoToggle').checked) {
        await reactToMessage(msg.chat.id, msg.message_id, validToks);
      }
    }
  } catch(e) {
    log(`Poll error: ${e.message}`, 'error');
  }
}

async function reactToMessage(chatId, msgId, validToks) {
  const mode   = document.getElementById('reactionMode').value;
  const delay  = parseInt(document.getElementById('delay').value, 10) || 1200;
  const emojis = [...selected].map(i => EMOJIS[i]);

  let chosen = [];
  if (mode === 'random')     chosen = [emojis[Math.floor(Math.random() * emojis.length)]];
  else if (mode === 'first') chosen = [emojis[0]];
  else                       chosen = emojis;

  log(`Sending reaction(s): ${chosen.join(' ')} to msg #${msgId}`, 'info');

  for (const tok of validToks) {
    for (const emoji of chosen) {
      try {
        const res = await callApi(tok.token, 'setMessageReaction', {
          chat_id:    chatId,
          message_id: msgId,
          reaction:   [{ type: 'emoji', emoji }],
          is_big:     false,
        });
        if (res.ok) {
          stats.reactions++;
          document.getElementById('statReactions').textContent = stats.reactions;
          log(`${emoji} Reacted to #${msgId} via ${tok.name}`, 'ok');
        } else {
          log(`${tok.name} reaction failed: ${res.description}`, 'error');
        }
      } catch(e) {
        log(`${tok.name} error: ${e.message}`, 'error');
      }
      await sleep(delay);
    }
  }
}

// ═══════════════════════════════════════════════════════
//  API HELPER
// ═══════════════════════════════════════════════════════

async function callApi(token, method, params) {
  const res = await fetch(`/api/telegram`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function log(msg, type = 'info') {
  const box  = document.getElementById('logBox');
  const time = new Date().toTimeString().slice(0,8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${escHtml(msg)}</span>`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  document.getElementById('logBox').innerHTML = '';
  log('Log cleared.', 'info');
}

function setProgress(pct) {
  document.getElementById('progressFill').style.width = pct + '%';
}
