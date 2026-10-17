// Shared by login.html and signup.html (set <body data-mode="login|signup">)
if (session.token) location.replace("/chat");

const $ = (id) => document.getElementById(id);
const mode = document.body.dataset.mode;
const label = mode === "signup" ? "Create account" : "Log in";

// Message left by another page, e.g. "Your session expired"
const note = flash.take();
if (note) {
  const n = document.createElement("p");
  n.className = "notice";
  n.setAttribute("role", "status");
  n.textContent = note + (sessionStorage.getItem("pending") ? " Your message will be sent once you are in." : "");
  $("form").before(n);
}

// Show / hide password
const eye = $("eye");
if (eye) {
  eye.addEventListener("click", () => {
    const field = $("password");
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    eye.classList.toggle("on", show);
    eye.setAttribute("aria-pressed", show);
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    buzz(8);
  });
}

// Keep the focused field visible above the on-screen keyboard
$("form").addEventListener("focusin", (e) => {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("username").value.trim();
  const password = $("password").value;
  const email = $("email") ? $("email").value.trim() : "";

  if (!username || !password) {
    $("error").textContent = "Enter a username and password.";
    return;
  }
  if (mode === "signup" && !email) {
    $("error").textContent = "Enter your email.";
    return;
  }

  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = mode === "signup" ? "Creating account..." : "Logging in...";
  $("error").textContent = "";

  try {
    if (mode === "signup") await signup(username, password, email);
    await login(username, password);
    location.href = "/chat";
  } catch (err) {
    const box = $("error");
    box.textContent = err.message;
    // Point people to the right page if they used the wrong one
    const hint = (text, href, linkText) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = linkText;
      box.append(" " + text + " ", a);
    };
    if (mode === "login" && [400, 401, 404].includes(err.status)) hint("New here?", "/signup", "Create an account");
    if (mode === "signup" && [400, 409].includes(err.status)) hint("Already have one?", "/login", "Log in");
    btn.disabled = false;
    btn.textContent = label;
    buzz([30, 40, 30]);
  }
});