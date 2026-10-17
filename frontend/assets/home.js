const $ = (id) => document.getElementById(id);

if (session.token) {
  $("nav-login").hidden = true;
  $("nav-signup").hidden = true;
  $("nav-chat").hidden = false;
  $("hint").textContent = "Signed in as " + session.username + ".";
} else {
  $("hint").textContent = flash.peek() || "New here? You'll make a free account first. It takes under a minute.";
}

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (text) sessionStorage.setItem("pending", text);
  location.href = session.token ? "/chat" : "/signup";
});