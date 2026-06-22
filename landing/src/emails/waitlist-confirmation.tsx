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
  Html,
  Img,
  Link,
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
          {/* Top header line accent */}
          <div style={accentBarStyle} />

          {/* Logo / wordmark */}
          <div style={logoContainerStyle}>
            <Img
              src={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://heyorbit.saadaan.dev"}/logo.png`}
              width="32"
              height="32"
              alt="Orbit Logo"
              style={logoImageStyle}
            />
            <span style={logoTextStyle}>Orbit</span>
          </div>

          <Heading as="h1" style={headingStyle}>
            You're on the list.
          </Heading>

          <Text style={greetingStyle}>{greeting}</Text>

          <Text style={bodyTextStyle}>
            Thanks for joining the Orbit waitlist.
          </Text>

          <Text style={bodyTextStyle}>
            I'm building Orbit to solve a problem I face every day: losing context between projects, conversations, and ideas.
          </Text>

          <Text style={bodyTextStyle}>
            Orbit helps you pick up exactly where you left off.
          </Text>

          <Text style={bodyTextStyle}>
            I'll keep you updated as development progresses and will reach out when early access opens.
          </Text>

          <Text style={bodyTextStyle}>
            Thanks for being here early.
          </Text>

          <Text style={signoffStyle}>
            — Saadaan
          </Text>

          <Text style={socialLinksStyle}>
            <Link href="https://linkedin.com/in/Saadaan-Hassan" style={linkStyle}>LinkedIn</Link>
            <span style={separatorStyle}> &middot; </span>
            <Link href="https://x.com/SaadaanHassan" style={linkStyle}>X (Twitter)</Link>
            <span style={separatorStyle}> &middot; </span>
            <Link href="https://github.com/Saadaan-Hassan" style={linkStyle}>GitHub</Link>
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
  backgroundColor: "#050505",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: "0",
  padding: "40px 20px",
};

const containerStyle: CSSProperties = {
  maxWidth: "500px",
  margin: "0 auto",
  backgroundColor: "#0a0a0a",
  borderRadius: "16px",
  border: "1px solid #1c1c1e",
  padding: "40px",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
};

const accentBarStyle: CSSProperties = {
  height: "3px",
  backgroundColor: "#ffffff",
  borderRadius: "3px 3px 0 0",
  margin: "-40px -40px 32px -40px",
};

const logoContainerStyle: CSSProperties = {
  display: "table",
  margin: "0 0 32px 0",
};

const logoImageStyle: CSSProperties = {
  borderRadius: "8px",
  display: "inline-block",
  verticalAlign: "middle",
};

const logoTextStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: "600",
  color: "#ffffff",
  letterSpacing: "-0.02em",
  display: "inline-block",
  verticalAlign: "middle",
  paddingLeft: "10px",
  lineHeight: "32px",
};

const headingStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: "600",
  color: "#ffffff",
  margin: "0 0 24px 0",
  lineHeight: "1.25",
  letterSpacing: "-0.03em",
};

const greetingStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: "500",
  color: "#ffffff",
  margin: "0 0 16px 0",
};

const bodyTextStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#a1a1aa",
  margin: "0 0 20px 0",
  fontWeight: "300",
};

const signoffStyle: CSSProperties = {
  fontSize: "13px",
  color: "#52525b",
  margin: "32px 0 0 0",
  fontWeight: "400",
};

const socialLinksStyle: CSSProperties = {
  fontSize: "12px",
  color: "#52525b",
  margin: "12px 0 0 0",
};

const linkStyle: CSSProperties = {
  color: "#a1a1aa",
  textDecoration: "underline",
};

const separatorStyle: CSSProperties = {
  color: "#3f3f46",
};
