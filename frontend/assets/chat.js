if (!session.token) location.replace("/login");

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const input = $("input");
const sendBtn = $("send");
const micBtn = $("mic");
const jumpBtn = $("jump");
const touch = window.matchMedia("(pointer: coarse)").matches;

let busy = false;
let controller = null;
let lastPrompt = null;

// If the session ends mid-request, the question is sent again after logging in
onExpire = () => { if (lastPrompt) sessionStorage.setItem("pending", lastPrompt); };

// Conversations live on the server; this is just what the page is showing
const sideEl = $("side");
const scrimEl = $("scrim");
const convosEl = $("convos");
const titleEl = $("chat-title");
const LAST_KEY = "chat:last:" + session.username;

let convos = [];      // [{ id, title, updated_at }], newest first
let activeId = null;  // null = a fresh chat, created on the first message
let loadSeq = 0;      // so a slow load can't overwrite a newer one

$("who").textContent = session.username;
$("logout").onclick = logout;

// ---------- Scrolling ----------
// The page only auto-follows a streaming reply while you are at the bottom.
// Scroll up even a little and it stays put until you come back down
// (or tap "Latest").
let follow = true;
let lastTop = 0;

const dist = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
const atBottom = () => dist() < 24;
const scrollDown = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };
const updateJump = () => { jumpBtn.hidden = atBottom() || !messagesEl.querySelector(".msg"); };

messagesEl.addEventListener("scroll", () => {
  const top = messagesEl.scrollTop;
  if (atBottom()) follow = true;           // back at the bottom: follow again
  else if (top < lastTop - 1) follow = false; // moved up: stop following
  lastTop = top;
  closeMenu();
  updateJump();
}, { passive: true });

jumpBtn.onclick = () => {
  follow = true;
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
};

// ---------- Keep the layout above the on-screen keyboard ----------
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const root = document.documentElement.style;
    root.setProperty("--vvh", vv.height + "px");
    root.setProperty("--vvt", vv.offsetTop + "px");
    if (document.activeElement === input && follow) scrollDown();
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  fit();
}

// ---------- Empty state ----------
const SUGGESTIONS = ["Explain something simply", "Help me write a message", "Plan my week", "Give me a quick idea"];

function showEmpty() {
  messagesEl.innerHTML = "";
  const d = document.createElement("div");
  d.className = "empty";
  d.id = "empty";
  d.innerHTML = "<h2>What can I help with?</h2><p>Type a message below to start.</p>";

  const chips = document.createElement("div");
  chips.className = "chips";
  SUGGESTIONS.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = t;
    b.onclick = () => send(t);
    chips.appendChild(b);
  });
  d.appendChild(chips);
  messagesEl.appendChild(d);
  jumpBtn.hidden = true;
}

// ---------- Markdown (so replies show real bold, lists and tables) ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  s = esc(s);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + codes[i] + "</code>");
}

const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isBlockStart = (l, next) =>
  /^\s*```/.test(l) || /^#{1,6}\s/.test(l) || LIST_RE.test(l) || /^\s*>/.test(l) ||
  /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || (l.includes("|") && next !== undefined && isSep(next));

function renderList(items) {
  let html = "";
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += "</li></" + stack.pop().type + ">";
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) { html += "<" + it.type + "><li>"; stack.push({ indent: it.indent, type: it.type }); }
    else html += "</li><li>";
    html += inline(it.text);
  }
  while (stack.length) html += "</li></" + stack.pop().type + ">";
  return html;
}

function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
      continue;
    }
    if (!line.trim()) { i++; continue; }

    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const lvl = Math.min(m[1].length + 2, 5);
      out.push("<h" + lvl + ">" + inline(m[2]) + "</h" + lvl + ">");
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => "<" + tag + (align[k] ? ' style="text-align:' + align[k] + '"' : "") + ">" + inline(c) + "</" + tag + ">";
      out.push(
        '<div class="tbl"><table><thead><tr>' + head.map((c, k) => cell("th", c, k)).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + head.map((_, k) => cell("td", r[k] || "", k)).join("") + "</tr>").join("") +
        "</tbody></table></div>"
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push("<blockquote>" + renderMarkdown(buf.join("\n")) + "</blockquote>");
      continue;
    }

    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const [, sp, mark, text] = lines[i++].match(LIST_RE);
        items.push({ indent: sp.replace(/\t/g, "  ").length, type: /\d/.test(mark) ? "ol" : "ul", text });
      }
      out.push(renderList(items));
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i], lines[i + 1]))) para.push(lines[i++]);
    out.push("<p>" + para.map(inline).join("<br>") + "</p>");
  }
  return out.join("");
}

// ---------- Messages ----------
function addMessage(role, text = "") {
  const empty = $("empty");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = "msg " + role;
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollDown();
  return el;
}

function showDots(el, slow = false) {
  el.innerHTML = '<span class="dots" aria-label="Assistant is typing"><i></i><i></i><i></i></span>' +
    (slow ? '<span class="thinking">Still thinking...</span>' : "");
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (__) {}
    ta.remove();
  }
}

function actionBtn(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "act";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

// Reply options live behind a small three-dots button
let menuEl = null;

function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function openMenu(btn, items) {
  if (menuEl) { closeMenu(); return; }
  const m = document.createElement("div");
  m.className = "msg-menu glass";
  m.setAttribute("role", "menu");
  items.forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    b.setAttribute("role", "menuitem");
    b.textContent = it.label;
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  menuEl = m;

  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + "px";
  m.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + "px";
}

document.addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("resize", closeMenu);

const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function addActions(bot, prompt, failed) {
  const row = document.createElement("div");
  row.className = "actions";
  const text = (bot.dataset.raw || bot.textContent).trim();

  const retry = () => {
    if (busy) return;
    bot.remove();
    row.remove();
    respondTo(prompt); // the server sees the same question twice and stores it once
  };

  if (failed || !text) {
    // Errors keep a visible Retry, since that is what you need next
    row.append(actionBtn("Retry", retry));
  } else {
    const items = [{ label: "Copy", run: async () => { await copyText(text); buzz(); toast("Copied"); } }];
    if (navigator.share) items.push({ label: "Share", run: () => { navigator.share({ text }).catch(() => {}); } });

    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.setAttribute("aria-label", "More actions");
    more.setAttribute("aria-haspopup", "menu");
    more.innerHTML = DOTS;
    more.onclick = (e) => { e.stopPropagation(); openMenu(more, items); };
    row.append(more);
  }

  bot.after(row);
  if (follow) scrollDown();
}

// ---------- Talking to the assistant ----------
function setBusy(b) {
  busy = b;
  sendBtn.classList.toggle("is-stop", b);
  sendBtn.setAttribute("aria-label", b ? "Stop generating" : "Send message");
  messagesEl.setAttribute("aria-busy", b ? "true" : "false");
}

async function respondTo(prompt) {
  setBusy(true);
  follow = true;
  const bot = addMessage("assistant");
  showDots(bot);
  controller = new AbortController();

  let started = false;
  let failed = false;
  let interrupted = false;
  let raw = "";
  let raf = 0;
  let convoId = null;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0) + "ms";

  // If the session runs out, keep the question so it is sent after logging in again
  lastPrompt = prompt;
  const slowTimer = setTimeout(() => { if (!started) showDots(bot, true); }, 2500);

  const paint = () => {
    raf = 0;
    bot.innerHTML = renderMarkdown(raw);
    bot.dataset.raw = raw;
    if (follow) scrollDown(); else updateJump();
  };

  // One server-sent event can hold several "data:" lines
  const handleEvent = (ev) => {
    const payload = ev.split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;

    let data;
    try { data = JSON.parse(payload); } catch (_) { return false; }

    if (data.type === "done") return true;
    if (data.type === "error" || data.error) throw new Error(data.message || data.error);
    if (data.title && convoId) setConvoTitle(convoId, data.title);
    const token = data.type === "token" ? data.content : data.token;
    if (token) {
      if (!started) {
        started = true;
        bot.textContent = "";
        bot.classList.add("md");
        console.debug("[chat] first token after", ms());
      }
      raw += token;
      if (!raf) raf = requestAnimationFrame(paint);
    }
    return false;
  };

  try {
    // First message of a fresh chat: create the conversation, then stream into it
    if (!activeId) await createConversation(prompt);
    convoId = activeId;

    const res = await fetch("/chat/conversations/" + convoId + "/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
      body: JSON.stringify({ content: prompt }),
      signal: controller.signal,
    });
    console.debug("[chat] server answered after", ms(), "status", res.status);

    if (res.status === 401) return expireSession();
    lastPrompt = null;
    if (!res.ok || !res.body) throw new Error("The assistant could not be reached.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();

      for (const ev of events) {
        if (handleEvent(ev)) { finished = true; break; }
      }
    }

    // The last event may arrive without a blank line after it
    buffer += decoder.decode();
    if (!finished && buffer.trim()) handleEvent(buffer);
    if (finished) { try { reader.cancel(); } catch (_) {} }
    console.debug("[chat] finished after", ms());

    if (!started) {
      failed = true;
      bot.classList.add("error");
      bot.textContent = "No reply came back. Try again.";
    }
  } catch (err) {
    if (err.name === "AbortError") {
      if (!started) { failed = true; bot.textContent = "Stopped."; }
    } else if (started) {
      // Keep what already arrived and say it was cut short
      interrupted = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      bot.innerHTML = renderMarkdown(raw) + '<p class="stream-note">The connection dropped, so this reply may be incomplete.</p>';
      bot.dataset.raw = raw;
    } else {
      failed = true;
      bot.classList.add("error");
      bot.textContent = err.message || "Something went wrong. Try again.";
    }
  } finally {
    clearTimeout(slowTimer);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (started && !failed && !interrupted) paint();
    controller = null;
    setBusy(false);
  }

  if (convoId) touchConvo(convoId);
  addActions(bot, prompt, failed);
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  // Token ran out while the page was open: go to login and keep the message
  if (session.expired) {
    lastPrompt = text;
    expireSession();
    return;
  }

  stopListening();
  buzz(8);
  closeMenu();
  messagesEl.querySelectorAll(".actions").forEach((el) => el.remove());
  follow = true;
  addMessage("user", text);

  await respondTo(text);
}

// ---------- Composer ----------
function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}
input.addEventListener("input", autosize);

// Phones: Enter adds a new line. Desktop: Enter sends. Ctrl/Cmd+Enter always sends.
input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const shouldSend = e.ctrlKey || e.metaKey || (!touch && !e.shiftKey);
  if (!shouldSend) return;
  e.preventDefault();
  if (!busy) $("composer").requestSubmit();
});

// Send button doubles as Stop while the assistant is writing
sendBtn.addEventListener("click", (e) => {
  if (busy) {
    e.preventDefault();
    if (controller) controller.abort();
    buzz(8);
  }
});
// Keep the keyboard open when tapping send
sendBtn.addEventListener("mousedown", (e) => e.preventDefault());

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) return;
  const text = input.value;
  if (!text.trim()) return;
  input.value = "";
  autosize();
  send(text);
});

// ---------- Voice input ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;

function setListening(on) {
  listening = on;
  micBtn.classList.toggle("listening", on);
  micBtn.setAttribute("aria-label", on ? "Stop voice input" : "Voice input");
}

function stopListening() {
  if (rec) { try { rec.stop(); } catch (_) {} }
  setListening(false);
}

function startListening() {
  if (busy) return;
  rec = new SR();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false;

  const base = input.value ? input.value.replace(/\s+$/, "") + " " : "";
  rec.onresult = (e) => {
    let t = "";
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    input.value = base + t;
    autosize();
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("Allow microphone access to use voice.");
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      toast("Voice input stopped.");
    }
  };
  rec.onend = () => setListening(false);

  try {
    rec.start();
    setListening(true);
    buzz(10);
  } catch (_) {
    setListening(false);
  }
}

if (SR) {
  micBtn.hidden = false;
  micBtn.addEventListener("click", () => (listening ? stopListening() : startListening()));
}

// ---------- Conversations ----------
const jsonHeaders = { "Content-Type": "application/json" };

function normalizeConvo(c) {
  return {
    id: c.id ?? c.conversation_id,
    title: c.title || "New chat",
    updated_at: c.updated_at || c.created_at || null,
  };
}

// Servers often send UTC times without a "Z"; treat those as UTC
function toDate(iso) {
  if (!iso) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return isNaN(d) ? null : d;
}

function bucketOf(iso) {
  const d = toDate(iso);
  if (!d) return "Recent";
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

function setLast(id) {
  try {
    if (id) localStorage.setItem(LAST_KEY, String(id));
    else localStorage.removeItem(LAST_KEY);
  } catch (_) {}
  try { window.history.replaceState(null, "", id ? "#" + id : location.pathname); } catch (_) {}
}

function setTitle() {
  const c = convos.find((x) => x.id === activeId);
  titleEl.textContent = c ? c.title : "New chat";
  document.title = c ? c.title + " \u00b7 Agentic AI Studio" : "Assistant \u00b7 Agentic AI Studio";
}

function openSide() {
  sideEl.classList.add("open");
  scrimEl.hidden = false;
  $("menu").setAttribute("aria-expanded", "true");
}
function closeSide() {
  sideEl.classList.remove("open");
  scrimEl.hidden = true;
  $("menu").setAttribute("aria-expanded", "false");
}

function renderConvos() {
  convosEl.innerHTML = "";
  if (!convos.length) {
    const p = document.createElement("p");
    p.className = "side-note";
    p.textContent = "No chats yet. Your conversations will show up here.";
    convosEl.appendChild(p);
    return;
  }

  let group = null;
  convos.forEach((c) => {
    const g = bucketOf(c.updated_at);
    if (g !== group) {
      group = g;
      const h = document.createElement("div");
      h.className = "convo-group";
      h.textContent = g;
      convosEl.appendChild(h);
    }

    const row = document.createElement("div");
    row.className = "convo" + (c.id === activeId ? " active" : "");

    const main = document.createElement("button");
    main.type = "button";
    main.className = "convo-main";
    main.textContent = c.title;
    main.title = c.title;
    if (c.id === activeId) main.setAttribute("aria-current", "true");
    main.onclick = () => { if (c.id !== activeId) openConvo(c.id); else closeSide(); };

    const more = document.createElement("button");
    more.type = "button";
    more.className = "convo-more";
    more.setAttribute("aria-label", "Options for " + c.title);
    more.setAttribute("aria-haspopup", "menu");
    more.innerHTML = DOTS;
    more.onclick = (e) => {
      e.stopPropagation();
      openMenu(more, [
        { label: "Rename", run: () => startRename(c, row) },
        { label: "Delete", run: () => removeConvo(c) },
      ]);
    };

    row.append(main, more);
    convosEl.appendChild(row);
  });
}

async function loadConvos() {
  convosEl.innerHTML = '<p class="side-note">Loading...</p>';
  try {
    const d = await request("/chat/conversations");
    const list = Array.isArray(d) ? d : (d && d.conversations) || [];
    convos = list.map(normalizeConvo).filter((c) => c.id != null);
    renderConvos();
  } catch (err) {
    convos = [];
    convosEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "side-note";
    p.textContent = "Couldn't load your chats.";
    convosEl.append(p, actionBtn("Try again", loadConvos));
  }
}

function touchConvo(id) {
  const i = convos.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = convos.splice(i, 1);
  c.updated_at = new Date().toISOString();
  convos.unshift(c);
  renderConvos();
}

function setConvoTitle(id, title) {
  const c = convos.find((x) => x.id === id);
  if (!c) return;
  c.title = title;
  renderConvos();
  if (id === activeId) setTitle();
}

async function createConversation(firstText) {
  const title = firstText.replace(/\s+/g, " ").trim().slice(0, 48) || "New chat";
  const d = await request("/chat/conversations", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ title }),
  });
  const c = normalizeConvo({ title, updated_at: new Date().toISOString(), ...(d || {}) });
  if (c.id == null) throw new Error("The server did not return a chat id.");
  convos.unshift(c);
  activeId = c.id;
  setLast(c.id);
  renderConvos();
  setTitle();
  return c;
}

function startNew() {
  if (busy) { toast("Wait for the reply, or press stop."); return; }
  loadSeq++;
  activeId = null;
  setLast(null);
  showEmpty();
  renderConvos();
  setTitle();
  closeSide();
  if (!touch) input.focus();
}

async function openConvo(id) {
  if (busy) { toast("Wait for the reply, or press stop."); return; }
  const seq = ++loadSeq;
  activeId = id;
  setLast(id);
  renderConvos();
  setTitle();
  closeSide();

  messagesEl.innerHTML = '<p class="loading">Loading...</p>';
  jumpBtn.hidden = true;

  let data;
  try {
    data = await request("/chat/conversations/" + id);
  } catch (err) {
    if (seq !== loadSeq) return;
    messagesEl.innerHTML = "";
    const box = document.createElement("div");
    box.className = "empty";
    box.innerHTML = "<h2>Couldn't open this chat</h2>";
    const p = document.createElement("p");
    p.textContent = err.message || "Something went wrong.";
    box.append(p, actionBtn("Try again", () => openConvo(id)));
    messagesEl.appendChild(box);
    return;
  }
  if (seq !== loadSeq) return;

  const list = ((data && data.messages) || []).filter((m) => m.role === "user" || m.role === "assistant");
  if (!list.length) { showEmpty(); return; }

  messagesEl.innerHTML = "";
  let lastBot = null;
  list.forEach((m) => {
    const el = addMessage(m.role === "user" ? "user" : "assistant");
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") {
      el.textContent = text;
    } else {
      el.classList.add("md");
      el.innerHTML = renderMarkdown(text);
      el.dataset.raw = text;
      lastBot = el;
    }
  });
  // The newest answer gets its Copy menu back
  const tail = list[list.length - 1];
  if (lastBot && tail.role === "assistant") addActions(lastBot, "", false);

  follow = true;
  scrollDown();
  updateJump();
  if (!touch) input.focus();
}

function startRename(c, row) {
  const main = row.querySelector(".convo-main");
  if (!main) return;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "convo-edit";
  inp.value = c.title;
  inp.maxLength = 80;
  inp.setAttribute("aria-label", "Chat name");
  main.replaceWith(inp);
  inp.focus();
  inp.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const t = inp.value.trim();
    if (!save || !t || t === c.title) { renderConvos(); return; }
    const old = c.title;
    c.title = t;
    renderConvos();
    setTitle();
    try {
      await request("/chat/conversations/" + c.id, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title: t }),
      });
    } catch (_) {
      c.title = old;
      renderConvos();
      setTitle();
      toast("Couldn't rename that chat");
    }
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
}

async function removeConvo(c) {
  if (busy) { toast("Wait for the reply, or press stop."); return; }
  if (!confirm("Delete this chat? This can't be undone.")) return;
  try {
    await request("/chat/conversations/" + c.id, { method: "DELETE" });
  } catch (_) {
    toast("Couldn't delete that chat");
    return;
  }
  convos = convos.filter((x) => x.id !== c.id);
  if (c.id === activeId) startNew();
  else renderConvos();
  buzz(10);
}

$("new-chat").onclick = startNew;
$("new-chat-top").onclick = startNew;
$("menu").onclick = () => (sideEl.classList.contains("open") ? closeSide() : openSide());
$("side-close").onclick = closeSide;
scrimEl.onclick = closeSide;
convosEl.addEventListener("scroll", closeMenu, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSide(); });

// ---------- Start ----------
async function init() {
  showEmpty();
  await loadConvos();
  const wanted = [parseInt(location.hash.slice(1), 10), parseInt(localStorage.getItem(LAST_KEY), 10)];
  const pick = wanted.find((id) => convos.some((c) => c.id === id)) ?? (convos[0] && convos[0].id);
  if (pick != null) await openConvo(pick);
  else { setLast(null); setTitle(); }
}

// A question typed on the home page is sent straight away
init().then(() => {
  const pending = sessionStorage.getItem("pending");
  if (pending) {
    sessionStorage.removeItem("pending");
    input.value = pending;
    $("composer").requestSubmit();
  }
  if (!touch) input.focus();
});