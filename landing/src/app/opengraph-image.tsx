import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Orbit — Never lose your place again.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          backgroundColor: "#030303",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          padding: "0 96px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle ambient radial glow */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -60%)",
            width: 800,
            height: 800,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)",
          }}
        />

        {/* Orbit rings decoration */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 900,
            height: 900,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.03)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 1100,
            height: 1100,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.02)",
          }}
        />

        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "2.5px solid #030303",
              }}
            />
          </div>
          <span
            style={{
              fontSize: 30,
              fontWeight: 600,
              color: "#ffffff",
              letterSpacing: "-0.03em",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            Orbit
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.05,
            letterSpacing: "-0.04em",
            fontFamily: "system-ui, -apple-system, sans-serif",
            maxWidth: 900,
          }}
        >
          Never lose your place again.
        </div>

        {/* Subline */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 300,
            color: "#71717a",
            textAlign: "center",
            lineHeight: 1.5,
            fontFamily: "system-ui, -apple-system, sans-serif",
            maxWidth: 680,
          }}
        >
          Your AI memory companion for macOS. Passive capture, instant recall.
        </div>

        {/* Bottom badge */}
        <div
          style={{
            position: "absolute",
            bottom: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 24px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "#ffffff",
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: "#a1a1aa",
              fontFamily: "system-ui, -apple-system, sans-serif",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Early Access · Join the Waitlist
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
