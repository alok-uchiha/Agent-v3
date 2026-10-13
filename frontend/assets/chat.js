if (!session.token) location.replace("/");

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const input = $("input");
const sendBtn = $("send");
const micBtn = $("mic");
const jumpBtn = $("jump");
const touch = window.matchMedia("(pointer: coarse)").matches;

let busy = false;
let controller = null;

$("who").textContent = session.username;
$("logout").onclick = logout;
$("new-chat").onclick = () => {
  if (busy) return;
  showEmpty();
  if (!touch) input.focus();
};

// ---------- Scrolling ----------
const dist = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
const nearBottom = (t = 80) => dist() < t;
const scrollDown = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

messagesEl.addEventListener("scroll", () => {
  closeMenu();
  jumpBtn.hidden = nearBottom(160) || !messagesEl.querySelector(".msg");
}, { passive: true });
jumpBtn.onclick = () => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });

// ---------- Keep the layout above the on-screen keyboard ----------
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const root = document.documentElement.style;
    root.setProperty("--vvh", vv.height + "px");
    root.setProperty("--vvt", vv.offsetTop + "px");
    if (document.activeElement === input && nearBottom(200)) scrollDown();
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

function showDots(el) {
  el.innerHTML = '<span class="dots" aria-label="Assistant is typing"><i></i><i></i><i></i></span>';
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
  const text = bot.textContent.trim();

  const retry = () => {
    if (busy) return;
    bot.remove();
    row.remove();
    respondTo(prompt);
  };

  if (failed || !text) {
    // Errors keep a visible Retry, since that is what you need next
    row.append(actionBtn("Retry", retry));
  } else {
    const items = [{ label: "Copy", run: async () => { await copyText(text); buzz(); toast("Copied"); } }];
    if (navigator.share) items.push({ label: "Share", run: () => { navigator.share({ text }).catch(() => {}); } });
    items.push({ label: "Retry", run: retry });

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
  if (nearBottom(160)) scrollDown();
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
  const bot = addMessage("assistant");
  showDots(bot);
  controller = new AbortController();

  let started = false;
  let failed = false;

  try {
    const res = await fetch("/chat/ai/stream?input=" + encodeURIComponent(prompt), {
      method: "POST",
      headers: { Authorization: "Bearer " + session.token },
      signal: controller.signal,
    });
    if (res.status === 401) return logout();
    if (!res.ok || !res.body) throw new Error("The assistant could not be reached.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();

        if (payload === "[DONE]") { finished = true; break; }

        let data;
        try { data = JSON.parse(payload); } catch (_) { continue; }

        if (data.error) throw new Error(data.error);
        if (data.token) {
          const stick = nearBottom();
          if (!started) { bot.textContent = ""; started = true; }
          bot.textContent += data.token;
          if (stick) scrollDown();
        }
      }
    }

    if (!started) {
      failed = true;
      bot.classList.add("error");
      bot.textContent = "No reply came back. Try again.";
    }
  } catch (err) {
    if (err.name === "AbortError") {
      if (!started) { failed = true; bot.textContent = "Stopped."; }
    } else {
      failed = true;
      bot.classList.add("error");
      bot.textContent = err.message || "Something went wrong. Try again.";
    }
  } finally {
    controller = null;
    setBusy(false);
  }

  addActions(bot, prompt, failed);
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  stopListening();
  buzz(8);
  closeMenu();
  messagesEl.querySelectorAll(".actions").forEach((el) => el.remove());
  addMessage("user", text);

  // Save the user's message (best effort, doesn't block the reply)
  request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  }).catch(() => {});

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

// ---------- Start ----------
showEmpty();

// A question typed on the home page is sent straight away
const pending = sessionStorage.getItem("pending");
if (pending) {
  sessionStorage.removeItem("pending");
  input.value = pending;
  $("composer").requestSubmit();
}

if (!touch) input.focus();