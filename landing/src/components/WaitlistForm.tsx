"use client";

// WaitlistForm — client component because it needs useActionState / useFormStatus
// to track submission state and show pending / success / error feedback.
//
// Uses React 19's useActionState (replaces the deprecated useFormState from
// react-dom/server — it now lives in react directly).

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { joinWaitlist, WaitlistActionResult } from "@/lib/waitlist-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Submit button ────────────────────────────────────────────────────────────
// Separated so useFormStatus can read the nearest <form>'s pending state.

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full h-11 text-sm font-semibold bg-white text-black hover:bg-zinc-200 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed transition-colors"
    >
      {pending ? "Joining…" : "Join waitlist"}
    </Button>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export default function WaitlistForm() {
  const [state, formAction] = useActionState<WaitlistActionResult | null, FormData>(
    joinWaitlist,
    null
  );

  // Success state — replace the form with a confirmation message.
  if (state?.success) {
    return (
      <div className="w-full max-w-md mx-auto text-center py-4">
        <p className="text-lg font-semibold text-white">
          🎉 You&apos;re on the list!
        </p>
        <p className="text-sm text-zinc-400 mt-1">
          We&apos;ll be in touch when beta access opens.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="w-full max-w-md mx-auto flex flex-col gap-3"
    >
      <Input
        type="text"
        name="name"
        placeholder="Your name (optional)"
        autoComplete="name"
        className="h-11 bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus-visible:ring-white/30 focus-visible:border-white/30"
      />

      <Input
        type="email"
        name="email"
        placeholder="your@email.com"
        required
        autoComplete="email"
        className="h-11 bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus-visible:ring-white/30 focus-visible:border-white/30"
      />

      <SubmitButton />

      {/* Error message — only shown when success is explicitly false */}
      {state?.success === false && (
        <p className="text-sm text-red-400 text-center" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
