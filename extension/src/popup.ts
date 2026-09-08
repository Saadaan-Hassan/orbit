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
