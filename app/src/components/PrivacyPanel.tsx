import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CaptureConsentChoicesForm,
  type CaptureConsentChoices,
} from "./CaptureConsentChoices";
import { usePrivacySettings } from "../hooks/usePrivacySettings";
import { useProviderStatus } from "../hooks/useProviderStatus";
import { useAnalytics } from "../hooks/useAnalytics";

interface PauseDurationOption {
  label: string;
  durationMinutes: number | null;
}

const PAUSE_DURATION_OPTIONS: PauseDurationOption[] = [
  { label: "15 minutes",      durationMinutes: 15   },
  { label: "1 hour",          durationMinutes: 60   },
  { label: "Until I resume",  durationMinutes: null },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
      {children}
    </h3>
  );
}

function BrowserExtensionSection({ createCode, revoke }: { createCode: () => Promise<string>; revoke: () => Promise<void> }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="flex flex-col gap-2"><SectionHeading>Browser Extension</SectionHeading>
    <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed">Pair the Orbit extension explicitly. The code expires in five minutes and grants capture-only access. Incognito remains off unless enabled in Chrome.</p>
    {code ? <code className="rounded-lg bg-zinc-100 dark:bg-zinc-900 px-3 py-2 text-xs break-all select-all">{code}</code> : null}
    <div className="flex gap-2"><button onClick={async () => { try { setError(null); setCode(await createCode()); } catch { setError("Could not create a pairing code."); } }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-950">Generate code</button>
      <button onClick={async () => { try { await revoke(); setCode(null); } catch { setError("Could not revoke pairing."); } }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-900">Revoke extension</button></div>
    {error ? <p className="text-xs text-red-500">{error}</p> : null}</div>;
}

// ─── Inline Confirm Dialog ───────────────────────────────────────────────────
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-black rounded-xl shadow-2xl p-5 max-w-[280px] w-full animate-in zoom-in-95 duration-200">
        <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-1">{title}</h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed font-light">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] rounded-lg text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-semibold cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Section 0 — On-Screen Content ───────────────────────────────────────────
interface ScreenContentSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

function ScreenContentSection({ enabled, onToggle }: ScreenContentSectionProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(): Promise<void> {
    setActionError(null);
    try {
      await onToggle(!enabled);
    } catch {
      setActionError("Could not update on-screen content setting.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>On-Screen Content</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        This lets Orbit understand what you're actually working on — the document
        you're writing, the code you're editing, the conversation you're having —
        not just which app is open. Orbit never reads password fields, and you can
        exclude any app below.
      </p>

      <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-50/20 dark:bg-zinc-900/10 rounded-2xl">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          Read on-screen text
        </span>
        <button
          onClick={handleToggle}
          aria-pressed={enabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 ${
            enabled ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-zinc-950 shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed px-1">
        To block specific apps, add them to{" "}
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">
          Excluded Apps
        </span>{" "}
        below.
      </p>

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 1 — Capture Status ──────────────────────────────────────────────
interface CaptureStatusSectionProps {
  isCapturing: boolean;
  pausedUntil: number | null;
  onPause: (durationMinutes: number | null) => Promise<void>;
  onResume: () => Promise<void>;
}

function CaptureStatusSection({
  isCapturing,
  pausedUntil,
  onPause,
  onResume,
}: CaptureStatusSectionProps) {
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { captureEvent } = useAnalytics();

  async function handlePauseOptionClick(
    durationMinutes: number | null
  ): Promise<void> {
    setActionError(null);
    try {
      await onPause(durationMinutes);
      captureEvent("capture_paused");
      setShowDurationPicker(false);
    } catch {
      setActionError("Could not pause capture.");
    }
  }

  async function handleResumeClick(): Promise<void> {
    setActionError(null);
    try {
      await onResume();
    } catch {
      setActionError("Could not resume capture.");
    }
  }

  function formatPausedUntil(timestampMs: number | null): string {
    if (timestampMs === null) return "paused indefinitely";
    const resumeTime = new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `paused until ${resumeTime}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>Capture Status</SectionHeading>

      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50/20 dark:bg-zinc-900/10">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span className="relative flex h-2.5 w-2.5">
            {isCapturing && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isCapturing ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
          </span>
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {isCapturing ? "Orbit is watching" : "Paused"}
            </p>
            {!isCapturing && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5 font-medium leading-none">
                {formatPausedUntil(pausedUntil)}
              </p>
            )}
          </div>
        </div>

        {isCapturing ? (
          <button
            onClick={() => setShowDurationPicker((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={handleResumeClick}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 transition-colors cursor-pointer"
          >
            Resume
          </button>
        )}
      </div>

      {/* Slide-down pause duration selector */}
      {showDurationPicker && (
        <div className="p-3 bg-zinc-50 dark:bg-black rounded-xl flex flex-col gap-1.5 animate-in slide-in-from-top-2 duration-200">
          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Select Duration</p>
          <div className="flex flex-col gap-1">
            {PAUSE_DURATION_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => handlePauseOptionClick(option.durationMinutes)}
                className="text-left text-xs px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-zinc-900 hover:shadow-sm dark:hover:shadow-none text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer transition-all"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Capture Consent Review ──────────────────────────────────────────────────
interface CaptureConsentSectionProps {
  accepted: boolean;
  choices: CaptureConsentChoices;
  onSave: (choices: CaptureConsentChoices) => Promise<void>;
  onSkip: () => Promise<void>;
}

function CaptureConsentSection({
  accepted,
  choices,
  onSave,
  onSkip,
}: CaptureConsentSectionProps) {
  const [draft, setDraft] = useState<CaptureConsentChoices>(choices);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => setDraft(choices), [choices]);

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setActionError(null);
    try {
      await onSave(draft);
    } catch {
      setActionError("Could not save capture choices.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSkip(): Promise<void> {
    setIsSaving(true);
    setActionError(null);
    try {
      await onSkip();
    } catch {
      setActionError("Could not keep capture disabled.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading>Capture Consent</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed">
        {accepted
          ? "Review or change each source whenever you want. Saving an empty selection keeps capture off."
          : "Capture is currently off. Choose only the sources you want, or keep using Orbit without activity capture."}
      </p>
      <CaptureConsentChoicesForm
        value={draft}
        onChange={setDraft}
        disabled={isSaving}
      />
      <div className="flex flex-col gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSaving ? "Saving…" : "Save capture choices"}
        </button>
        <button
          onClick={() => void handleSkip()}
          disabled={isSaving}
          className="w-full py-2 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl disabled:opacity-50 transition-colors"
        >
          Keep all capture off
        </button>
      </div>
      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 2 — Excluded Apps ───────────────────────────────────────────────
interface ExcludedAppsSectionProps {
  excludedApps: string[];
  onAdd: (appName: string) => Promise<void>;
  onRemove: (appName: string) => Promise<void>;
}

function ExcludedAppsSection({
  excludedApps,
  onAdd,
  onRemove,
}: ExcludedAppsSectionProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAddApp(): Promise<void> {
    const trimmedName = inputValue.trim();
    if (!trimmedName) return;

    setIsAdding(true);
    setActionError(null);
    try {
      await onAdd(trimmedName);
      setInputValue("");
    } catch {
      setActionError("Could not exclude app.");
    } finally {
      setIsAdding(false);
    }
  }

  function handleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ): void {
    if (event.key === "Enter") handleAddApp();
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>Excluded Apps</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Activities from these apps are ignored at capture-time and never written to memory.
      </p>

      {/* Grid of exclusions */}
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-2">
        {excludedApps.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 italic py-2 px-1">No applications excluded.</p>
        )}
        {excludedApps.map((appName) => (
          <div
            key={appName}
            className="flex items-center justify-between px-3.5 py-2 bg-zinc-50/50 dark:bg-zinc-900/10 rounded-xl"
          >
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{appName}</span>
            <button
              onClick={() => onRemove(appName)}
              aria-label={`Remove ${appName}`}
              className="text-zinc-400 hover:text-red-500 transition-colors p-1 hover:bg-red-500/10 rounded-lg cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Form adder */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="App name (e.g. 1Password)"
          className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-400/20 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-0"
        />
        <button
          onClick={handleAddApp}
          disabled={!inputValue.trim() || isAdding}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
        >
          Exclude
        </button>
      </div>

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 3 — Excluded Websites ───────────────────────────────────────────
interface ExcludedWebsitesSectionProps {
  excludedDomains: string[];
  onAdd: (domain: string) => Promise<void>;
  onRemove: (domain: string) => Promise<void>;
}

function ExcludedWebsitesSection({
  excludedDomains,
  onAdd,
  onRemove,
}: ExcludedWebsitesSectionProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAddDomain(): Promise<void> {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput) return;

    setIsAdding(true);
    setActionError(null);
    try {
      await onAdd(trimmedInput);
      setInputValue("");
    } catch {
      setActionError("Could not exclude site.");
    } finally {
      setIsAdding(false);
    }
  }

  function handleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ): void {
    if (event.key === "Enter") handleAddDomain();
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>Excluded Websites</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Content from these sites is never captured.
      </p>

      {/* List of excluded domains */}
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-2">
        {excludedDomains.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 italic py-2 px-1">No websites excluded.</p>
        )}
        {excludedDomains.map((domain) => (
          <div
            key={domain}
            className="flex items-center justify-between px-3.5 py-2 bg-zinc-50/50 dark:bg-zinc-900/10 rounded-xl"
          >
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{domain}</span>
            <button
              onClick={() => onRemove(domain)}
              aria-label={`Remove ${domain}`}
              className="text-zinc-400 hover:text-red-500 transition-colors p-1 hover:bg-red-500/10 rounded-lg cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Form adder */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="e.g. mail.google.com"
          className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-400/20 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-0"
        />
        <button
          onClick={handleAddDomain}
          disabled={!inputValue.trim() || isAdding}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
        >
          Exclude
        </button>
      </div>

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 4 — Custom Redaction Phrases ────────────────────────────────────
interface RedactionPattern {
  id: string;
  pattern: string;
}

interface RedactionPatternsSectionProps {
  patterns: RedactionPattern[];
  onAdd: (pattern: string) => Promise<void>;
  onRemove: (patternId: string) => Promise<void>;
}

function RedactionPatternsSection({
  patterns,
  onAdd,
  onRemove,
}: RedactionPatternsSectionProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAddPattern(): Promise<void> {
    const pattern = inputValue.trim();
    if (!pattern) return;

    setIsAdding(true);
    setActionError(null);
    try {
      await onAdd(pattern);
      setInputValue("");
    } catch {
      setActionError("Could not save redaction phrase.");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>Custom Redaction Phrases</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Add an exact phrase that Orbit should replace before it writes captured
        text, titles, URLs, or file paths to local memory. These phrases are
        stored locally so they can be matched; do not use this as a secret vault.
      </p>

      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto mb-2">
        {patterns.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 italic py-2 px-1">
            No custom redaction phrases.
          </p>
        )}
        {patterns.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between px-3.5 py-2 bg-zinc-50/50 dark:bg-zinc-900/10 rounded-xl"
          >
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
              {item.pattern}
            </span>
            <button
              onClick={() => onRemove(item.id)}
              aria-label="Remove redaction phrase"
              className="ml-2 flex-shrink-0 text-zinc-400 hover:text-red-500 transition-colors p-1 hover:bg-red-500/10 rounded-lg cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleAddPattern();
          }}
          maxLength={256}
          placeholder="Exact phrase to redact"
          className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-400/20 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-0"
        />
        <button
          onClick={() => void handleAddPattern()}
          disabled={!inputValue.trim() || isAdding}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
        >
          Redact
        </button>
      </div>

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 5 — Browser Tracking ────────────────────────────────────────────
interface BrowserTrackingSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

function BrowserTrackingSection({
  enabled,
  onToggle,
}: BrowserTrackingSectionProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(): Promise<void> {
    setActionError(null);
    try {
      await onToggle(!enabled);
    } catch {
      setActionError("Could not update browser tracking setting.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>Browser Tracking</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Captures the page address and title from Chrome, Safari, Arc, Brave,
        and Edge — no extension needed. Add the extension for deeper memory
        (article content and search queries).
      </p>

      {/* Enable / disable toggle */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-50/20 dark:bg-zinc-900/10 rounded-2xl">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          Track browser tabs
        </span>
        <button
          onClick={handleToggle}
          aria-pressed={enabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 ${
            enabled ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-zinc-950 shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Supported browser pills */}
      {enabled && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {["Chrome", "Safari", "Arc", "Brave", "Edge"].map((browser) => (
            <span
              key={browser}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400"
            >
              {browser}
            </span>
          ))}
        </div>
      )}

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed px-1">
        To block specific sites, add them to{" "}
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">
          Excluded Websites
        </span>{" "}
        above.
      </p>

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 5 — File Activity ───────────────────────────────────────────────
interface FileActivitySectionProps {
  enabled: boolean;
  watchedFolders: string[];
  onToggle: (enabled: boolean) => Promise<void>;
  onAddFolder: (folder: string) => Promise<void>;
  onRemoveFolder: (folder: string) => Promise<void>;
}

function FileActivitySection({
  enabled,
  watchedFolders,
  onToggle,
  onAddFolder,
  onRemoveFolder,
}: FileActivitySectionProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(): Promise<void> {
    setActionError(null);
    try {
      await onToggle(!enabled);
    } catch {
      setActionError("Could not update file tracking setting.");
    }
  }

  async function handlePickFolder(): Promise<void> {
    setActionError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await onAddFolder(selected);
      }
    } catch {
      setActionError("Could not add folder.");
    }
  }

  async function handleRemoveFolder(folder: string): Promise<void> {
    setActionError(null);
    try {
      await onRemoveFolder(folder);
    } catch {
      setActionError("Could not remove folder.");
    }
  }

  // Show just the last two path components so long paths stay readable.
  function shortenPath(absolutePath: string): string {
    const parts = absolutePath.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length <= 2 ? absolutePath : `…/${parts.slice(-2).join("/")}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>File Activity</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Orbit records which files you open and edit — never their contents.
      </p>

      {/* Enable / disable toggle */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-50/20 dark:bg-zinc-900/10 rounded-2xl">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          Track file activity
        </span>
        <button
          onClick={handleToggle}
          aria-pressed={enabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 ${
            enabled ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-zinc-950 shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Watched folders list */}
      {enabled && (
        <>
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
            {watchedFolders.length === 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic py-2 px-1">
                No folders being watched.
              </p>
            )}
            {watchedFolders.map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between px-3.5 py-2 bg-zinc-50/50 dark:bg-zinc-900/10 rounded-xl"
              >
                <span
                  className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate"
                  title={folder}
                >
                  {shortenPath(folder)}
                </span>
                <button
                  onClick={() => handleRemoveFolder(folder)}
                  aria-label={`Stop watching ${folder}`}
                  className="ml-2 flex-shrink-0 text-zinc-400 hover:text-red-500 transition-colors p-1 hover:bg-red-500/10 rounded-lg cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handlePickFolder}
            className="self-start px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            + Add folder
          </button>
        </>
      )}

      {actionError && (
        <p className="text-xs text-red-500 font-medium px-1 mt-1">{actionError}</p>
      )}
    </div>
  );
}

// ─── Section 6 — AI Provider ─────────────────────────────────────────────────
function ProviderStatusRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-50/20 dark:bg-zinc-900/10 rounded-2xl">
      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{label}</span>
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
          }`}
        />
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {enabled ? "Active" : "Disabled"}
        </span>
      </div>
    </div>
  );
}

function AiProviderSection() {
  const { claudeEnabled, geminiEnabled, groqEnabled, isLoading } = useProviderStatus();

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading>AI Provider</SectionHeading>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mb-1">
        Orbit's AI features run through one of the providers below. This is
        managed centrally — there's nothing for you to configure here.
      </p>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-10 bg-zinc-100/50 dark:bg-zinc-900/20 rounded-2xl animate-pulse" />
          <div className="h-10 bg-zinc-100/50 dark:bg-zinc-900/20 rounded-2xl animate-pulse" />
          <div className="h-10 bg-zinc-100/50 dark:bg-zinc-900/20 rounded-2xl animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <ProviderStatusRow label="Claude" enabled={claudeEnabled} />
          <ProviderStatusRow label="Gemini" enabled={geminiEnabled} />
          <ProviderStatusRow label="Groq" enabled={groqEnabled} />
        </div>
      )}
    </div>
  );
}

// ─── Section 7 — Danger Zone ─────────────────────────────────────────────────
interface DangerZoneSectionProps {
  isWiping: boolean;
  onWipe: () => Promise<void>;
}

function DangerZoneSection({ isWiping, onWipe }: DangerZoneSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);
  const { captureEvent } = useAnalytics();

  async function handleConfirmWipe(): Promise<void> {
    setShowConfirmDialog(false);
    setWipeError(null);
    try {
      await onWipe();
      captureEvent("all_memory_wiped");
      setWiped(true);
    } catch {
      setWipeError("Wipe failed.");
    }
  }

  return (
    <>
      <div className="rounded-2xl p-4 bg-red-500/5 flex flex-col gap-2">
        <h4 className="text-[10px] font-bold text-red-500 uppercase tracking-wider leading-none">Danger Zone</h4>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Wipe All Memory</p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-light leading-relaxed mt-0.5">
              Permanently deletes everything Orbit has learned — your captured activity, all summaries, and your search history. This cannot be undone.
            </p>
          </div>

          {wiped ? (
            <span className="text-xs text-emerald-500 font-bold whitespace-nowrap">
              ✓ Memory wiped
            </span>
          ) : (
            <button
              onClick={() => setShowConfirmDialog(true)}
              disabled={isWiping}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shadow-sm"
            >
              {isWiping ? "Wiping…" : "Wipe Memory"}
            </button>
          )}
        </div>

        {wipeError && (
          <p className="text-xs text-red-500 font-medium px-1 mt-1">{wipeError}</p>
        )}
      </div>

      <ConfirmDialog
        isOpen={showConfirmDialog}
        title="Wipe all memory?"
        description="This will permanently delete all captured events, sessions, and memories. This cannot be undone."
        confirmLabel="Yes, wipe everything"
        onConfirm={handleConfirmWipe}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </>
  );
}

// ─── PrivacyPanel Root ────────────────────────────────────────────────────────
export function PrivacyPanel() {
  const {
    isCapturing,
    pausedUntil,
    excludedApps,
    excludedDomains,
    redactionPatterns,
    captureConsent,
    nativeBrowserEnabled,
    fileWatchEnabled,
    screenContentEnabled,
    watchedFolders,
    isWiping,
    isLoading,
    error,
    addExcludedApp,
    removeExcludedApp,
    addExcludedDomain,
    removeExcludedDomain,
    addRedactionPattern,
    removeRedactionPattern,
    saveCaptureConsent,
    skipCaptureConsent,
    setNativeBrowserEnabled,
    setFileWatchEnabled,
    setScreenContentEnabled,
    addWatchedFolder,
    removeWatchedFolder,
    pauseCapture,
    resumeCapture,
    wipeAllMemory,
    createExtensionPairingCode,
    revokeExtensionPairings,
  } = usePrivacySettings();

  if (isLoading) {
    return (
      <p className="text-xs text-zinc-400 dark:text-zinc-500 italic py-4 text-center">Loading privacy settings…</p>
    );
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg bg-red-500/5 text-xs text-red-500 leading-normal">
        ⚠️ {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 bg-transparent">
      <CaptureConsentSection
        accepted={captureConsent.accepted}
        choices={captureConsent}
        onSave={saveCaptureConsent}
        onSkip={skipCaptureConsent}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <ScreenContentSection
        enabled={screenContentEnabled}
        onToggle={setScreenContentEnabled}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <CaptureStatusSection
        isCapturing={isCapturing}
        pausedUntil={pausedUntil}
        onPause={pauseCapture}
        onResume={resumeCapture}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <ExcludedAppsSection
        excludedApps={excludedApps}
        onAdd={addExcludedApp}
        onRemove={removeExcludedApp}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <ExcludedWebsitesSection
        excludedDomains={excludedDomains}
        onAdd={addExcludedDomain}
        onRemove={removeExcludedDomain}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <RedactionPatternsSection
        patterns={redactionPatterns}
        onAdd={addRedactionPattern}
        onRemove={removeRedactionPattern}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <BrowserTrackingSection
        enabled={nativeBrowserEnabled}
        onToggle={setNativeBrowserEnabled}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <BrowserExtensionSection createCode={createExtensionPairingCode} revoke={revokeExtensionPairings} />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <FileActivitySection
        enabled={fileWatchEnabled}
        watchedFolders={watchedFolders}
        onToggle={setFileWatchEnabled}
        onAddFolder={addWatchedFolder}
        onRemoveFolder={removeWatchedFolder}
      />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <AiProviderSection />

      <div className="h-px bg-zinc-100/50 dark:bg-zinc-900/20 my-1" />

      <DangerZoneSection isWiping={isWiping} onWipe={wipeAllMemory} />
    </div>
  );
}
