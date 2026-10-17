// ---------- Config: change these to match your backend ----------
const CONFIG = {
  loginUrl: "/auth/login",
  signupUrl: "/auth/register",
  // "form" = OAuth2PasswordRequestForm (username + password as form data)
  // "json" = JSON body { username, password }
  loginFormat: "form",
};

// ---------- Session ----------
const EXPIRED_MSG = "Your session expired. Please log in again.";

// Login tokens are JWTs, so we can read their expiry without asking the server
function tokenExpired(t) {
  try {
    const part = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(part)).exp;
    return typeof exp === "number" && exp * 1000 <= Date.now() + 5000;
  } catch (_) {
    return false; // not a JWT, let the server decide
  }
}

const session = {
  get token() { return localStorage.getItem("token"); },
  get expired() { const t = this.token; return !!t && tokenExpired(t); },
  get username() { return localStorage.getItem("username") || ""; },
  save(token, username) {
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);
  },
  clear() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
  },
};

// One-time message shown on the next page (e.g. "session expired")
const flash = {
  set(msg) { try { sessionStorage.setItem("flash", msg); } catch (_) {} },
  peek() { try { return sessionStorage.getItem("flash") || ""; } catch (_) { return ""; } },
  take() { const m = this.peek(); try { sessionStorage.removeItem("flash"); } catch (_) {} return m; },
};

// A stale token would bounce people between pages, so drop it as soon as any page loads
if (session.expired) {
  session.clear();
  flash.set(EXPIRED_MSG);
}

function logout() {
  try { localStorage.removeItem("chat:" + session.username); } catch (_) {}
  session.clear();
  location.href = "/";
}

// Pages can set this to save something (like an unsent message) before we leave
let onExpire = null;

function expireSession() {
  try { if (onExpire) onExpire(); } catch (_) {}
  session.clear();
  flash.set(EXPIRED_MSG);
  location.replace("/login");
}

// ---------- Theme ----------
const THEMES = ["mist", "midnight"]; // mist = light, midnight = dark
const DEFAULT_THEME = "mist";
const THEME_KEY = "studio-theme";

function currentTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return THEMES.includes(t) ? t : DEFAULT_THEME;
}

document.documentElement.dataset.theme = currentTheme();

// Colour of the phone's browser bar follows the theme
const BAR_COLORS = { mist: "#e2e3e2", midnight: "#0b0d0f" };
function applyBarColor() {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
  m.content = BAR_COLORS[document.documentElement.dataset.theme] || BAR_COLORS.mist;
}
applyBarColor();

// Small vibration on supported phones (Android)
function buzz(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
}

// Short message at the bottom of the screen
let toastTimer;
function toast(text) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = text;
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

const SUN = '<svg class="ic ic-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="ic ic-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.className = "switch" + (btn.classList.contains("theme-btn") ? " theme-btn" : "");
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-label", "Dark mode");
    btn.innerHTML = SUN + MOON + '<span class="knob"></span>';

    const sync = () => btn.setAttribute("aria-checked", document.documentElement.dataset.theme === "midnight");
    sync();

    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "midnight" ? "mist" : "midnight";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      applyBarColor();
      buzz(12);
      sync();
    });
  });
});

// ---------- API ----------
function errorText(data, fallback) {
  if (!data || !data.detail) return fallback;
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join(". ");
  return fallback;
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (session.token) headers.Authorization = "Bearer " + session.token;

  const res = await fetch(url, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    if (res.status === 401 && session.token) expireSession();
    const err = new Error(errorText(data, "Something went wrong. Try again."));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function login(username, password) {
  const options = { method: "POST" };
  if (CONFIG.loginFormat === "json") {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ username, password });
  } else {
    options.body = new URLSearchParams({ username, password });
  }
  const data = await request(CONFIG.loginUrl, options);
  const token = data && (data.access_token || data.token);
  if (!token) throw new Error("Login worked, but no token came back.");
  session.save(token, username);
}

async function signup(username, password, email) {
  await request(CONFIG.signupUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, email }),
  });
}