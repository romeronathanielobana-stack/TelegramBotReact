// ── CONFIG ──────────────────────────────────────────────
const EMOJIS = [
  '👍','👎','❤️','🔥','🎉','🤩','🥰','😁','😱','😢',
  '💯','🤣','😂','🙏','👏','😍','🤔','🤯','😎','🫡',
  '💀','⚡','🌚','🌭','💋','👻','🎃','🎄','🎆','🎇',
  '🦄','🐳','🕊️','🐾','🍓','🍾','🍕','🎸','🎯','🏆'
];

// ── STATE ────────────────────────────────────────────────
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
  addToken();
  loadFromStorage();
});

// ── STORAGE ──────────────────────────────────────────────
function saveToStorage() {
  const data = {
    tokens:   tokens.map(t => ({...t, valid: null})),
    selected: [...selected],
    chatId:   document.getElementById('chatId').value,
    delay:    document.getElementById('delay').value,
    poll:     document.getElementById('pollInterval').value,
    mode:     document.getElementById('reactionMode').value,
    auto:     document.getElementById('autoToggle').checked,
  };
  try { localStorage.setItem('tgAutoReact', JSON.stringify(data)); } catch(_) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('tgAutoReact');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.tokens?.length) {
      document.getElementById('tokenList').innerHTML = '';
      tokens = [];
      d.tokens.forEach(t => addToken(t.token));
    }
    if (d.selected) { selected = new Set(d.selected); refreshEmojiGrid(); }
    if (d.chatId)   document.getElementById('chatId').value = d.chatId;
    if (d.delay)    document.getElementById('delay').value  = d.delay;
    if (d.poll)     document.getElementById('pollInterval').value = d.poll;
    if (d.mode)     document.getElementById('reactionMode').value = d.mode;
    if (d.auto !== undefined) document.getElementById('autoToggle').checked = d.auto;
  } catch(_) {}
}

// ── TOKEN MANAGEMENT ─────────────────────────────────────
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

// ── EMOJI GRID ───────────────────────────────────────────
function buildEmojiGrid() {
  const grid = document.getElementById('emojiGrid');
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

// ── TOKEN VALIDATION ─────────────────────────────────────
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

// ── AUTO-JOIN ─────────────────────────────────────────────
async function checkAndJoinChannel(chatId, validToks) {
  log('Checking bot membership in channel...', 'info');
  let allJoined = true;

  // Normalise: username must have leading @; numeric IDs stay as-is
  const isNumeric = /^-?\d+$/.test(chatId);
  const normChat  = isNumeric ? chatId : (chatId.startsWith('@') ? chatId : '@' + chatId);

  // Step 1: resolve to numeric ID via getChat.
  // getChatMember returns 400 when passed a @username and the bot isn't a member yet.
  let numericChatId = isNumeric ? chatId : null;
  if (!numericChatId) {
    try {
      const chatRes = await callApi(validToks[0].token, 'getChat', { chat_id: normChat });
      if (chatRes.ok) {
        numericChatId = String(chatRes.result.id);
        log(`Resolved "${normChat}" → chat ID ${numericChatId}`, 'info');
      } else {
        log(`Could not resolve chat "${normChat}": ${chatRes.description}`, 'error');
        return false;
      }
    } catch (e) {
      log(`Chat resolution failed: ${e.message}`, 'error');
      return false;
    }
  }

  for (const tok of validToks) {
    try {
      // Get this bot's own user ID
      const meRes = await callApi(tok.token, 'getMe', {});
      if (!meRes.ok) continue;
      const botId = meRes.result.id;

      // getChatMember needs the numeric chat ID (not @username)
      const memberRes = await callApi(tok.token, 'getChatMember', {
        chat_id: numericChatId,
        user_id: botId,
      });

      const status   = memberRes?.result?.status;
      const isActive = ['creator', 'administrator', 'member'].includes(status);

      if (isActive) {
        log(`✓ ${tok.name} is already in the channel (${status}).`, 'ok');
        continue;
      }

      // Not a member — try to join using @username (joinChat needs username for public chats)
      log(`${tok.name} not in channel (status: ${status || 'left/unknown'}). Joining...`, 'warn');
      const joinRes = await callApi(tok.token, 'joinChat', { chat_id: normChat });

      if (joinRes.ok) {
        log(`✓ ${tok.name} successfully joined the channel!`, 'ok');
      } else {
        allJoined = false;
        log(
          `✗ ${tok.name} could not auto-join: ${joinRes.description}. ` +
          `For private channels, add the bot manually as an admin.`,
          'error'
        );
      }
    } catch (e) {
      allJoined = false;
      log(`✗ ${tok.name} join check failed: ${e.message}`, 'error');
    }
  }

  return allJoined;
}

// ── BOT CORE ─────────────────────────────────────────────
async function startBot() {
  const chatId = document.getElementById('chatId').value.trim();
  if (!chatId)                                    { log('Please enter a channel/group username or ID.', 'warn'); return; }
  if (!tokens.filter(t => t.token).length)        { log('Add at least one bot token.', 'warn'); return; }
  if (!selected.size)                             { log('Select at least one reaction emoji.', 'warn'); return; }

  const ok = await testTokens();
  if (!ok) { log('No valid tokens. Bot not started.', 'error'); return; }

  const validToks = tokens.filter(t => t.valid);

  // Auto-join channel for any bots not yet members
  await checkAndJoinChannel(chatId, validToks);

  // Reset state and flush old pending updates so we only react to NEW messages
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
      // Advance offset for every update immediately
      updateOffset = upd.update_id + 1;

      const msg = upd.channel_post || upd.message;
      if (!msg) {
        log(`Update #${upd.update_id} skipped (no message content).`, 'info');
        continue;
      }

      const msgKey = `${msg.chat.id}-${msg.message_id}`;
      if (seenMsgs.has(msgKey)) continue;
      seenMsgs.add(msgKey);

      // Normalize and compare chat ID (handles @username, numeric ID, with/without @)
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

// ── API HELPER ───────────────────────────────────────────
async function callApi(token, method, params) {
  const res = await fetch(`/api/telegram`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── UTILS ────────────────────────────────────────────────
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
