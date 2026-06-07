"use server";

// Server Action: joinWaitlist
//
// Called directly from a React <form action={joinWaitlist}> or via the
// useActionState / useFormStatus hooks. Runs exclusively on the server —
// never sent to the browser bundle.
//
// Steps:
//   1. Validate inputs with Zod
//   2. Insert into Supabase waitlist table
//   3. Send React Email confirmation via Resend
//   4. Return { success: true } | { error: string }

import { z } from "zod";
import { Resend } from "resend";
import { supabase } from "@/lib/supabase";
import WaitlistConfirmation from "@/emails/WaitlistConfirmation";

// ─── Validation schema ────────────────────────────────────────────────────────

const WaitlistSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  name: z
    .string()
    .max(100, "Name must be 100 characters or less")
    .optional()
    .transform((value) => (value?.trim() === "" ? undefined : value?.trim())),
});

// ─── Singleton Resend client ──────────────────────────────────────────────────
// Module-level singleton so we reuse the same instance across hot-reloads
// in development and across invocations in production.

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Return type ─────────────────────────────────────────────────────────────

export type WaitlistActionResult =
  | { success: true }
  | { success: false; error: string };

// ─── Server Action ────────────────────────────────────────────────────────────

// React 19 useActionState passes (prevState, formData) — the prevState is
// ignored here but must appear as the first parameter to satisfy the hook's
// action signature requirement.
export async function joinWaitlist(
  _prevState: WaitlistActionResult | null,
  formData: FormData
): Promise<WaitlistActionResult> {
  // 1. Extract and validate inputs.
  const rawEmail = formData.get("email");
  const rawName = formData.get("name");

  const parsed = WaitlistSchema.safeParse({
    email: typeof rawEmail === "string" ? rawEmail : "",
    name: typeof rawName === "string" ? rawName : undefined,
  });

  if (!parsed.success) {
    // Return the first validation message — safe to expose (no internal detail).
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
    return { success: false, error: firstError };
  }

  const { email, name } = parsed.data;

  // 2. Insert into Supabase.
  // On unique constraint violation (email already registered) we still return
  // success — never confirm to the submitter whether the address was known.
  const { error: dbError } = await supabase.from("waitlist").insert({
    email,
    name: name ?? null,
    source: "landing",
  });

  if (dbError) {
    // Postgres unique violation code is "23505".
    const isDuplicate =
      dbError.code === "23505" ||
      dbError.message.toLowerCase().includes("unique");

    if (isDuplicate) {
      // Treat silently as success (security: don't leak that the email exists).
      return { success: true };
    }

    // Any other DB error — log server-side, return a generic message.
    console.error("[waitlist] Supabase insert error:", dbError);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // 3. Send confirmation email via Resend.
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "hello@tryorbit.app";

  const { error: emailError } = await resend.emails.send({
    from: `Orbit <${fromAddress}>`,
    to: email,
    subject: "You're on the Orbit waitlist 🪐",
    react: WaitlistConfirmation({ name }),
  });

  if (emailError) {
    // Email failure should not surface as a user-facing error — the user is
    // already on the waitlist. Log it server-side for alerting.
    console.error("[waitlist] Resend send error:", emailError);
  }

  return { success: true };
}
