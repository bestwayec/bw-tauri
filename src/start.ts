// Keep this entry independent of the app graph so startup errors can replace
// the static splash even when an imported module fails during evaluation.
void import("./main").catch((error: unknown) => {
  console.error("Bestway could not start", error);
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("div");
  panel.className = "boot-fallback";
  panel.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.textContent = "Ilova ishga tushmadi / Bestway could not start.";
  const retry = document.createElement("button");
  retry.textContent = "Qayta yuklash / Reload";
  retry.addEventListener("click", () => window.location.reload());
  panel.append(title, retry);
  root.replaceChildren(panel);
});
