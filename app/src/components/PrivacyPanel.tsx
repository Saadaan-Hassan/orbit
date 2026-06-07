import { useState } from "react";
import { usePrivacySettings } from "../hooks/usePrivacySettings";

// ---------------------------------------------------------------------------
// Pause duration options shown when the user clicks the capture toggle.
// null = pause indefinitely (until manually resumed).
// ---------------------------------------------------------------------------

interface PauseDurationOption {
  label: string;
  durationMinutes: number | null;
}

const PAUSE_DURATION_OPTIONS: PauseDurationOption[] = [
  { label: "15 minutes",      durationMinutes: 15   },
  { label: "1 hour",          durationMinutes: 60   },
  { label: "Until I resume",  durationMinutes: null },
];

// ---------------------------------------------------------------------------
// Small primitives (Tailwind-only — ShadCN not yet installed in the project)
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
      {children}
    </h3>
  );
}

// Inline confirmation dialog rendered as a fixed overlay — replaces ShadCN
// AlertDialog until the library is wired into the project.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h4 className="text-base font-semibold text-gray-900 mb-2">{title}</h4>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">{description}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200
                       text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white
                       hover:bg-red-700 transition-colors font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Capture Status
// ---------------------------------------------------------------------------

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

  async function handlePauseOptionClick(
    durationMinutes: number | null
  ): Promise<void> {
    setActionError(null);
    try {
      await onPause(durationMinutes);
      setShowDurationPicker(false);
    } catch {
      setActionError("Could not pause capture. Is the backend running?");
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
    <div>
      <SectionHeading>Capture Status</SectionHeading>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              isCapturing ? "bg-green-500" : "bg-orange-400"
            }`}
          />
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isCapturing ? "Capturing" : "Paused"}
            </p>
            {!isCapturing && (
              <p className="text-xs text-gray-500">
                {formatPausedUntil(pausedUntil)}
              </p>
            )}
          </div>
        </div>

        {isCapturing ? (
          <button
            onClick={() => setShowDurationPicker((previous) => !previous)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200
                       text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={handleResumeClick}
            className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white
                       hover:bg-green-700 transition-colors font-medium"
          >
            Resume
          </button>
        )}
      </div>

      {/* Pause duration picker — slides in below the toggle row */}
      {showDurationPicker && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 mb-2">Pause for how long?</p>
          <div className="flex flex-col gap-1">
            {PAUSE_DURATION_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => handlePauseOptionClick(option.durationMinutes)}
                className="text-left text-sm px-3 py-2 rounded-md
                           hover:bg-white hover:shadow-sm transition-all
                           text-gray-700 font-medium"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {actionError && (
        <p className="mt-2 text-xs text-red-500">{actionError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Excluded Apps
// ---------------------------------------------------------------------------

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
      setActionError("Could not add app. Is the backend running?");
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
    <div>
      <SectionHeading>Excluded Apps</SectionHeading>
      <p className="text-xs text-gray-500 mb-3">
        Events from these apps are never captured or stored.
      </p>

      {/* Existing excluded apps list */}
      <div className="flex flex-col gap-1 mb-3">
        {excludedApps.length === 0 && (
          <p className="text-sm text-gray-400 italic">No apps excluded.</p>
        )}
        {excludedApps.map((appName) => (
          <div
            key={appName}
            className="flex items-center justify-between px-3 py-2
                       bg-gray-50 rounded-lg border border-gray-100"
          >
            <span className="text-sm text-gray-800">{appName}</span>
            <button
              onClick={() => onRemove(appName)}
              aria-label={`Remove ${appName} from excluded apps`}
              className="text-gray-400 hover:text-red-500 transition-colors
                         text-base leading-none ml-2"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add new app */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="App name (e.g. Slack)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-400
                     bg-white placeholder-gray-400"
        />
        <button
          onClick={handleAddApp}
          disabled={!inputValue.trim() || isAdding}
          className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors whitespace-nowrap"
        >
          Add App
        </button>
      </div>

      {actionError && (
        <p className="mt-2 text-xs text-red-500">{actionError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Danger Zone
// ---------------------------------------------------------------------------

interface DangerZoneSectionProps {
  isWiping: boolean;
  onWipe: () => Promise<void>;
}

function DangerZoneSection({ isWiping, onWipe }: DangerZoneSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  async function handleConfirmWipe(): Promise<void> {
    setShowConfirmDialog(false);
    setWipeError(null);
    try {
      await onWipe();
      setWiped(true);
    } catch {
      setWipeError("Wipe failed. Is the backend running?");
    }
  }

  return (
    <>
      <div className="border border-red-200 rounded-xl p-4 bg-red-50/50">
        <SectionHeading>Danger Zone</SectionHeading>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Wipe All Memory</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Permanently deletes all events, sessions, and memories.
            </p>
          </div>

          {wiped ? (
            <span className="text-sm text-green-600 font-medium">
              ✓ Memory wiped
            </span>
          ) : (
            <button
              onClick={() => setShowConfirmDialog(true)}
              disabled={isWiping}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white
                         hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors font-medium"
            >
              {isWiping ? "Wiping…" : "Wipe All Memory"}
            </button>
          )}
        </div>

        {wipeError && (
          <p className="mt-2 text-xs text-red-600">{wipeError}</p>
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

// ---------------------------------------------------------------------------
// PrivacyPanel — root export
// ---------------------------------------------------------------------------

export function PrivacyPanel() {
  const {
    isCapturing,
    pausedUntil,
    excludedApps,
    isWiping,
    isLoading,
    error,
    addExcludedApp,
    removeExcludedApp,
    pauseCapture,
    resumeCapture,
    wipeAllMemory,
  } = usePrivacySettings();

  if (isLoading) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500">Loading privacy settings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Privacy & Control</h2>

      <CaptureStatusSection
        isCapturing={isCapturing}
        pausedUntil={pausedUntil}
        onPause={pauseCapture}
        onResume={resumeCapture}
      />

      <hr className="border-gray-100" />

      <ExcludedAppsSection
        excludedApps={excludedApps}
        onAdd={addExcludedApp}
        onRemove={removeExcludedApp}
      />

      <hr className="border-gray-100" />

      <DangerZoneSection isWiping={isWiping} onWipe={wipeAllMemory} />
    </div>
  );
}
