import { useState, useEffect, useRef } from "react";
import { useOnboarding } from "../hooks/useOnboarding";

// Step indices
const STEP_WELCOME = 0;
const STEP_ACCESSIBILITY = 1;
const STEP_BROWSER_AUTOMATION = 2;
const STEP_EXTENSION = 3;
const STEP_WHAT_TO_EXPECT = 4;
const TOTAL_STEPS = 5;

// ─── Progress Dots ────────────────────────────────────────────────────────────
function ProgressDots({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
        <div
          key={index}
          className={`rounded-full transition-all duration-300 ${
            index === currentStep
              ? "w-4 h-1.5 bg-zinc-900 dark:bg-white"
              : index < currentStep
              ? "w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-600"
              : "w-1.5 h-1.5 bg-zinc-200 dark:bg-zinc-800"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Step 0 — Welcome ─────────────────────────────────────────────────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 px-2">
      <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center shadow-lg overflow-hidden p-2.5">
        <img
          src="/logo.png"
          className="w-full h-full object-contain select-none pointer-events-none"
          draggable="false"
          alt="Orbit Logo"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
          Continue where you left off.
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light max-w-[280px]">
          Orbit remembers your work throughout the day, so you can instantly
          recover context when switching tasks or coming back later.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full text-left bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4">
        <p className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">What Orbit remembers</p>
        {[
          "Apps you've used",
          "Browser tabs and pages you've visited",
          "Clipboard text (sensitive information is automatically filtered)",
          "Your recent activity timeline, searchable in plain English",
        ].map((item) => (
          <div key={item} className="flex items-start gap-2.5">
            <span className="text-emerald-500 mt-0.5 text-xs">✓</span>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{item}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
      >
        Get started
      </button>
    </div>
  );
}

// ─── Step 1 — Accessibility Permission ───────────────────────────────────────
function AccessibilityStep({
  hasPermission,
  onCheckPermission,
  onOpenSettings,
  onNext,
}: {
  hasPermission: boolean;
  onCheckPermission: () => Promise<boolean>;
  onOpenSettings: () => Promise<void>;
  onNext: () => void;
}) {
  const [checking, setChecking] = useState(false);

  async function handleCheckAgain(): Promise<void> {
    setChecking(true);
    await onCheckPermission();
    setChecking(false);
  }

  async function handleOpenSettings(): Promise<void> {
    await onOpenSettings();
  }

  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
          Let Orbit see which app you're using
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
          Orbit needs this permission to know which app you're using and what
          you're working on — so it can help you return to it later.
        </p>
      </div>

      <div
        className={`rounded-2xl p-4 flex items-center gap-4 transition-colors ${
          hasPermission ? "bg-emerald-500/10" : "bg-amber-500/10"
        }`}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            hasPermission ? "bg-emerald-500/20" : "bg-amber-500/20"
          }`}
        >
          {hasPermission ? (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M3 8l3.5 3.5L13 5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M8 4v5M8 11v1" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div>
          <p
            className={`text-xs font-bold ${
              hasPermission ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {hasPermission ? "Permission granted" : "Permission required"}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            {hasPermission
              ? "Orbit can now notice which app you switch to."
              : "Orbit cannot remember your workflow without this permission."}
          </p>
        </div>
      </div>

      {!hasPermission && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">How to grant access:</p>
          <ol className="flex flex-col gap-1.5">
            {[
              'Click "Open System Settings" below',
              'Find "Orbit" in the list and enable the toggle',
              'Return here and click "Check again"',
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-2.5">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-1">
        {hasPermission ? (
          <button
            onClick={onNext}
            className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
          >
            Continue
          </button>
        ) : (
          <>
            <button
              onClick={handleOpenSettings}
              className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
            >
              Open System Settings
            </button>
            <button
              onClick={handleCheckAgain}
              disabled={checking}
              className="w-full py-2.5 rounded-xl text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all cursor-pointer disabled:opacity-50"
            >
              {checking ? "Checking…" : "Check again"}
            </button>
            <button
              onClick={onNext}
              className="w-full py-2 text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors cursor-pointer"
            >
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Step 2 — Browser Automation Permission ───────────────────────────────────
function BrowserAutomationStep({
  isGranted,
  onRequestAccess,
  onNext,
}: {
  isGranted: boolean;
  onRequestAccess: () => Promise<void>;
  onNext: () => void;
}) {
  const [isWaiting, setIsWaiting] = useState(false);

  // Prevents onNext() being called twice if the polling resolves while the user
  // has already clicked Skip.
  const hasAdvanced = useRef(false);

  async function handleAllowAccess(): Promise<void> {
    setIsWaiting(true);
    await onRequestAccess(); // polls internally until granted
    if (!hasAdvanced.current) {
      hasAdvanced.current = true;
      onNext();
    }
  }

  function handleSkip(): void {
    if (!hasAdvanced.current) {
      hasAdvanced.current = true;
      onNext();
    }
  }

  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="flex flex-col gap-1.5">
        <div className="text-2xl mb-0.5">🌐</div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
          Connect your browser
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
          Orbit can see which web pages you visit so it can remember your
          research and reading. This works with Chrome, Safari, Arc, Brave, and
          Edge — across all your profiles, with no extension needed.
        </p>
      </div>

      {/* Status indicator */}
      <div
        className={`rounded-2xl p-4 flex items-center gap-4 transition-colors ${
          isGranted ? "bg-emerald-500/10" : "bg-zinc-100 dark:bg-zinc-900/50"
        }`}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
            isGranted ? "bg-emerald-500/20" : "bg-zinc-200 dark:bg-zinc-800"
          }`}
        >
          {isGranted ? (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M3 8l3.5 3.5L13 5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span>🔴</span>
          )}
        </div>
        <div>
          <p
            className={`text-xs font-bold ${
              isGranted
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {isGranted ? "Connected!" : "Not connected"}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            {isGranted
              ? "Orbit can see your active browser tabs."
              : isWaiting
              ? "Waiting for your approval in the system prompt…"
              : "Tap below to connect your browser."}
          </p>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-2 mt-1">
        {isGranted ? (
          <button
            onClick={onNext}
            className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
          >
            Continue →
          </button>
        ) : (
          <>
            <button
              onClick={handleAllowAccess}
              disabled={isWaiting}
              className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isWaiting ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 3 12 3 12h1z"
                    />
                  </svg>
                  Waiting…
                </>
              ) : (
                "Allow Browser Access"
              )}
            </button>

            {/* Always available so the user isn't blocked if they click
                "Don't Allow" in the macOS dialog */}
            <button
              onClick={handleSkip}
              className="w-full py-2 text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors cursor-pointer"
            >
              Skip for now
            </button>
          </>
        )}
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center leading-relaxed -mt-1">
        Orbit only sees the page address and title — not your passwords or what
        you type.
      </p>
    </div>
  );
}

// ─── Step 3 — Chrome Extension (coming soon) ─────────────────────────────────
function ChromeExtensionStep({ onNext }: { onNext: () => void }) {
  const [showManualInstructions, setShowManualInstructions] = useState(false);

  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
          Browser extension{" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">(coming soon)</span>
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
          For even deeper memory — the content of articles you read and searches
          you do — install the Orbit Chrome extension. We'll notify you when
          it's available on the Web Store.
        </p>
      </div>

      {/* Collapsible manual install instructions for technical users */}
      <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 overflow-hidden">
        <button
          onClick={() => setShowManualInstructions((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <span>Already have it?</span>
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${showManualInstructions ? "rotate-180" : ""}`}
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>

        {showManualInstructions && (
          <div className="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <p className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              Manual install
            </p>
            {[
              "Open Chrome and go to chrome://extensions",
              "Enable Developer Mode (top-right toggle)",
              "Click Load Unpacked and select the Orbit extension folder",
            ].map((step, i) => (
              <div key={step} className="flex items-start gap-2.5">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={onNext}
          className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — What to Expect ──────────────────────────────────────────────────
function WhatToExpectStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
          You're all set
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
          Orbit is now building your memory in the background. The more you
          work, the more helpful it becomes.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Open with Alt + Space */}
        <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50">
          <span className="mt-0.5 shrink-0 text-zinc-500 dark:text-zinc-400">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M7 16h10" />
            </svg>
          </span>
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Open with Alt + Space</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">Ask things like "What was that article I read yesterday?" or "Which repo was I working on this morning?"</p>
          </div>
        </div>

        {/* Your data stays on your Mac */}
        <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50">
          <span className="mt-0.5 shrink-0 text-zinc-500 dark:text-zinc-400">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Your data stays on your Mac</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">Everything is stored locally by default. Nothing is sent to the cloud unless you choose to.</p>
          </div>
        </div>

        {/* Pause capture anytime */}
        <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50">
          <span className="mt-0.5 shrink-0 text-zinc-500 dark:text-zinc-400">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </span>
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Pause anytime</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">Need privacy? Pause memory capture from the menu bar whenever you want.</p>
          </div>
        </div>

        {/* Give it time */}
        <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50">
          <span className="mt-0.5 shrink-0 text-zinc-500 dark:text-zinc-400">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Give it 30 minutes</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">Ask me anything after 30 minutes of normal use — I need time to build your first summary.</p>
          </div>
        </div>
      </div>

      <button
        onClick={onFinish}
        className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer mt-1"
      >
        Start using Orbit
      </button>
    </div>
  );
}

// ─── OnboardingFlow Root ──────────────────────────────────────────────────────
export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(STEP_WELCOME);
  const {
    hasAccessibilityPermission,
    browserAutomationGranted,
    checkAccessibilityPermission,
    openAccessibilitySettings,
    requestBrowserAutomation,
    completeOnboarding,
  } = useOnboarding();

  // Poll for accessibility permission while on that step — updates the granted
  // state so the step card flips to green without the user clicking "Check again".
  useEffect(() => {
    if (currentStep !== STEP_ACCESSIBILITY) return;
    const interval = setInterval(async () => {
      await checkAccessibilityPermission();
    }, 2000);
    return () => clearInterval(interval);
  }, [currentStep, checkAccessibilityPermission]);

  function goToNextStep(): void {
    setCurrentStep((prev) => prev + 1);
  }

  async function handleFinish(): Promise<void> {
    await completeOnboarding();
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-black">
      <div className="w-full max-w-[340px] mx-auto px-4 flex flex-col gap-8">
        {/* Progress dots */}
        <div className="flex justify-center">
          <ProgressDots currentStep={currentStep} />
        </div>

        {/* Step content */}
        <div className="min-h-[380px] flex flex-col justify-center">
          {currentStep === STEP_WELCOME && (
            <WelcomeStep onNext={goToNextStep} />
          )}
          {currentStep === STEP_ACCESSIBILITY && (
            <AccessibilityStep
              hasPermission={hasAccessibilityPermission}
              onCheckPermission={checkAccessibilityPermission}
              onOpenSettings={openAccessibilitySettings}
              onNext={goToNextStep}
            />
          )}
          {currentStep === STEP_BROWSER_AUTOMATION && (
            <BrowserAutomationStep
              isGranted={browserAutomationGranted}
              onRequestAccess={requestBrowserAutomation}
              onNext={goToNextStep}
            />
          )}
          {currentStep === STEP_EXTENSION && (
            <ChromeExtensionStep onNext={goToNextStep} />
          )}
          {currentStep === STEP_WHAT_TO_EXPECT && (
            <WhatToExpectStep onFinish={handleFinish} />
          )}
        </div>
      </div>
    </div>
  );
}
