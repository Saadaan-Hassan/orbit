export interface CaptureConsentChoices {
  clipboard: boolean;
  app_window: boolean;
  browser: boolean;
  file_activity: boolean;
  screen_content: boolean;
}

export const NO_CAPTURE_CONSENT: CaptureConsentChoices = {
  clipboard: false,
  app_window: false,
  browser: false,
  file_activity: false,
  screen_content: false,
};

const CAPTURE_CATEGORIES: Array<{
  key: keyof CaptureConsentChoices;
  title: string;
  description: string;
}> = [
  {
    key: "clipboard",
    title: "Clipboard",
    description: "Text you copy. Sensitive patterns are redacted before local storage.",
  },
  {
    key: "app_window",
    title: "Apps and window titles",
    description: "The app in front and its window title; macOS Accessibility may be needed.",
  },
  {
    key: "browser",
    title: "Browser tabs",
    description: "Browser page addresses and titles; macOS Automation may be needed.",
  },
  {
    key: "file_activity",
    title: "File activity",
    description: "Names and paths for changes in folders you choose, never file contents.",
  },
  {
    key: "screen_content",
    title: "On-screen text",
    description: "Visible accessibility text from the active app; macOS Accessibility is needed.",
  },
];

interface CaptureConsentChoicesProps {
  value: CaptureConsentChoices;
  onChange: (value: CaptureConsentChoices) => void;
  disabled?: boolean;
}

export function CaptureConsentChoicesForm({
  value,
  onChange,
  disabled = false,
}: CaptureConsentChoicesProps) {
  function toggle(category: keyof CaptureConsentChoices): void {
    onChange({ ...value, [category]: !value[category] });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 p-3 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        Capture stays on this Mac first. Choosing a source does not configure an
        AI provider or make a cloud request. If you later configure and use an
        AI provider, relevant local context may be sent to that provider to
        provide the feature you requested.
      </div>

      {CAPTURE_CATEGORIES.map((category) => {
        const enabled = value[category.key];
        return (
          <div
            key={category.key}
            className="flex items-center gap-3 rounded-xl bg-zinc-50/60 dark:bg-zinc-900/20 px-3.5 py-3"
          >
            <button
              type="button"
              onClick={() => toggle(category.key)}
              disabled={disabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${category.title} capture`}
              aria-pressed={enabled}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                enabled ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-zinc-950 shadow transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                {category.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {category.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
