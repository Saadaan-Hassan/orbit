"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { joinWaitlist, WaitlistActionResult } from "@/lib/waitlist-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, User, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

// ─── Submit button ────────────────────────────────────────────────────────────
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="relative w-full h-12 text-sm font-semibold rounded-xl bg-white text-black hover:bg-zinc-100 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2 group overflow-hidden shadow-[0_4px_20px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_25px_rgba(255,255,255,0.18)]"
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Joining the Orbit…</span>
        </>
      ) : (
        <>
          <span>Request Access</span>
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </>
      )}
    </Button>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────
export default function WaitlistForm() {
  const [state, formAction] = useActionState<WaitlistActionResult | null, FormData>(
    joinWaitlist,
    null
  );

  // Success state — replace the form with a premium verification message.
  if (state?.success) {
    return (
      <div className="w-full max-w-md mx-auto text-center p-8 rounded-2xl border border-emerald-500/20 bg-zinc-950/40 backdrop-blur-xl shadow-[0_0_50px_rgba(16,185,129,0.05)] animate-in fade-in zoom-in duration-500">
        <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-4 animate-pulse">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-semibold text-white tracking-tight">
          You&apos;re in.
        </h3>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
          Check your inbox — a confirmation is on its way. We&apos;ll reach out personally when your early access is ready.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl border border-white/5 bg-zinc-950/30 backdrop-blur-xl shadow-[0_0_50px_rgba(0,0,0,0.3)] border-glow-hover">
      <form action={formAction} className="flex flex-col gap-4">
        {/* Name Input */}
        <div className="relative">
          <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            type="text"
            name="name"
            placeholder="Your name (optional)"
            autoComplete="name"
            className="h-12 pl-11 bg-white/5 border-white/10 text-white rounded-xl placeholder:text-zinc-500 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 hover:border-white/15 focus:bg-white/[0.07]"
          />
        </div>

        {/* Email Input */}
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            type="email"
            name="email"
            placeholder="your@email.com"
            required
            autoComplete="email"
            className="h-12 pl-11 bg-white/5 border-white/10 text-white rounded-xl placeholder:text-zinc-500 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 hover:border-white/15 focus:bg-white/[0.07]"
          />
        </div>

        {/* Submit button */}
        <SubmitButton />

        {/* Error message */}
        {state?.success === false && (
          <p className="text-sm text-red-400 text-center font-medium mt-1 animate-shake" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
