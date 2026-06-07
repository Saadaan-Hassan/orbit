// React Email confirmation template sent when a user joins the waitlist.
//
// All components are imported from "react-email" (the current package —
// not the deprecated @react-email/components).
// React Email automatically generates a plain-text fallback at send time.

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "react-email";
import { CSSProperties } from "react";

interface WaitlistConfirmationProps {
  name?: string;
}

export default function WaitlistConfirmation({
  name,
}: WaitlistConfirmationProps) {
  const greeting = name ? `Hey ${name},` : "Hey,";

  return (
    <Html lang="en" dir="ltr">
      <Head />

      {/* Preview text shown in inbox before the email is opened */}
      <Preview>You're on the Orbit waitlist — we'll be in touch 🪐</Preview>

      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Logo / wordmark */}
          <Text style={logoStyle}>🪐 Orbit</Text>

          <Heading as="h1" style={headingStyle}>
            You're on the list!
          </Heading>

          <Text style={bodyTextStyle}>{greeting}</Text>

          <Text style={bodyTextStyle}>
            Orbit is your AI memory companion — it silently captures what you
            work on and lets you recall any of it instantly through natural
            language.
          </Text>

          <Text style={bodyTextStyle}>
            We'll reach out as soon as beta access opens.
          </Text>

          <Hr style={hrStyle} />

          <Text style={footerTextStyle}>
            🔒 Your data never leaves your machine.
          </Text>

          <Text style={footerTextStyle}>
            — The Orbit team
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Inline styles are required for email clients — CSS classes are stripped by
// most mail clients. Keep values simple (no CSS variables, no shorthand that
// some clients misparse).

const bodyStyle: CSSProperties = {
  backgroundColor: "#0a0a0a",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  margin: "0",
  padding: "0",
};

const containerStyle: CSSProperties = {
  maxWidth: "560px",
  margin: "48px auto",
  padding: "40px 32px",
  backgroundColor: "#111111",
  borderRadius: "12px",
  border: "1px solid #222222",
};

const logoStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: "700",
  color: "#ffffff",
  margin: "0 0 32px 0",
  letterSpacing: "-0.02em",
};

const headingStyle: CSSProperties = {
  fontSize: "28px",
  fontWeight: "700",
  color: "#ffffff",
  margin: "0 0 24px 0",
  lineHeight: "1.2",
  letterSpacing: "-0.02em",
};

const bodyTextStyle: CSSProperties = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: "#a1a1aa",
  margin: "0 0 16px 0",
};

const hrStyle: CSSProperties = {
  border: "none",
  borderTop: "1px solid #222222",
  margin: "32px 0",
};

const footerTextStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#52525b",
  margin: "0 0 8px 0",
};
