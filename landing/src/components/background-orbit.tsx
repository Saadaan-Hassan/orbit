"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
}

interface Orb {
  radius: number;
  angle: number;
  speed: number;
  size: number;
  color: string;
}

export default function BackgroundOrbit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Initialize particles
    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.5,
      speedX: (Math.random() - 0.5) * 0.15,
      speedY: (Math.random() - 0.5) * 0.15,
      opacity: Math.random() * 0.5 + 0.2,
    }));

    // Initialize rotating orbs along orbits
    const orbs: Orb[] = [
      { radius: 150, angle: 0, speed: 0.0007, size: 3, color: "rgba(255, 255, 255, 0.4)" },
      { radius: 260, angle: Math.PI / 3, speed: -0.0004, size: 4, color: "rgba(255, 255, 255, 0.25)" },
      { radius: 380, angle: Math.PI, speed: 0.0002, size: 5, color: "rgba(255, 255, 255, 0.15)" },
    ];

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    const animate = () => {
      // Clear with very slight fade for trailing effect (optional, let's keep it clean)
      ctx.clearRect(0, 0, width, height);

      // 1. Draw subtle ambient cosmic light
      const centerX = width / 2;
      const centerY = height / 2;

      // Mouse-follow glow
      if (mouseRef.current.active) {
        const mouseGlow = ctx.createRadialGradient(
          mouseRef.current.x,
          mouseRef.current.y,
          0,
          mouseRef.current.x,
          mouseRef.current.y,
          400
        );
        mouseGlow.addColorStop(0, "rgba(255, 255, 255, 0.035)");
        mouseGlow.addColorStop(0.5, "rgba(255, 255, 255, 0.01)");
        mouseGlow.addColorStop(1, "transparent");
        ctx.fillStyle = mouseGlow;
        ctx.fillRect(0, 0, width, height);
      }

      // Deep central glow
      const centerGlow = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(width, height) * 0.6
      );
      centerGlow.addColorStop(0, "rgba(24, 24, 27, 0.4)");
      centerGlow.addColorStop(0.5, "rgba(9, 9, 11, 0.1)");
      centerGlow.addColorStop(1, "transparent");
      ctx.fillStyle = centerGlow;
      ctx.fillRect(0, 0, width, height);

      // 2. Draw Orbit rings
      ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
      ctx.lineWidth = 1;
      
      orbs.forEach((orb) => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, orb.radius, 0, Math.PI * 2);
        ctx.stroke();
      });

      // 3. Draw and update orbs on rings
      orbs.forEach((orb) => {
        orb.angle += orb.speed;
        const x = centerX + Math.cos(orb.angle) * orb.radius;
        const y = centerY + Math.sin(orb.angle) * orb.radius;

        // Subtle path glow
        const glow = ctx.createRadialGradient(x, y, 0, x, y, orb.size * 5);
        glow.addColorStop(0, orb.color);
        glow.addColorStop(1, "transparent");

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, orb.size * 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = orb.color;
        ctx.beginPath();
        ctx.arc(x, y, orb.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4. Draw and update ambient particles
      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;

        // Wrap around boundaries
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none bg-[#030303]"
    />
  );
}
