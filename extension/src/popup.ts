// Loaded via <script type="module"> in popup.html. The `export {}` below is
// only to make TypeScript treat this file as a module during type-checking
// (so top-level `const status` doesn't collide with the DOM's ambient
// `Window.status` global) — it has no effect on the bundled runtime output.
export {};

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const code = document.querySelector<HTMLInputElement>("#code")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;

async function refresh(): Promise<void> {
  const { orbitPairingState } = await chrome.storage.local.get("orbitPairingState");
  status.textContent = orbitPairingState === "paired" ? "Paired — capture is enabled." : "Not paired — capture is disabled.";
}

pair.addEventListener("click", async () => {
  pair.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "pair", code: code.value.trim() }) as { ok: boolean; error?: string };
  status.textContent = response.ok ? "Paired — capture is enabled." : response.error ?? "Pairing failed.";
  pair.disabled = false;
  if (response.ok) code.value = "";
});

void refresh();
