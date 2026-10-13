const $ = (id) => document.getElementById(id);

if (session.token) {
  $("nav-login").hidden = true;
  $("nav-signup").hidden = true;
  $("nav-chat").hidden = false;
  $("hint").textContent = "Signed in as " + session.username + ".";
}

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (text) sessionStorage.setItem("pending", text);
  location.href = session.token ? "/chat" : "/login";
});