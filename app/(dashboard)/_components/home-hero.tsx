"use client";

import { useEffect } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * The landing backdrop behind "What are we creating today?": a still of
 * spectrum glass ribbons brought to life in code. It blurs into focus, drifts
 * slowly, leans away from the pointer, catches a passing light sweep, and a
 * soft spotlight trails the cursor. Reduced motion gets the still, in focus.
 */
export function HomeHero({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  // Pointer position across the viewport, -0.5 to 0.5 on each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 18 });
  const sy = useSpring(py, { stiffness: 40, damping: 18 });
  const artX = useTransform(sx, (v) => v * -40);
  const artY = useTransform(sy, (v) => v * -24);
  const spotX = useTransform(sx, (v) => `${50 + v * 80}%`);
  const spotY = useTransform(sy, (v) => `${32 + v * 60}%`);
  const spotlight = useMotionTemplate`radial-gradient(480px 340px at ${spotX} ${spotY}, rgba(255, 61, 140, 0.16), rgba(158, 77, 242, 0.08) 45%, transparent 72%)`;

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      px.set(e.clientX / window.innerWidth - 0.5);
      py.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, px, py]);

  return (
    <motion.div
      aria-hidden
      className={cn("home-hero pointer-events-none overflow-hidden", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45 } }}
      transition={{ duration: 1.2, ease: EASE_OUT }}
    >
      <motion.div className="absolute -inset-[8%]" style={reduce ? undefined : { x: artX, y: artY }}>
        <motion.div
          className="home-hero-art h-full w-full"
          animate={
            reduce
              ? undefined
              : { scale: [1, 1.07, 1], rotate: [0, 1.4, 0], x: [0, -18, 0] }
          }
          transition={{ duration: 24, ease: "easeInOut", repeat: Infinity }}
        >
          <motion.img
            src="/home/hero.webp"
            alt=""
            className="h-full w-full object-cover object-top"
            initial={reduce ? false : { scale: 1.16, filter: "blur(20px)" }}
            animate={{ scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 1.8, ease: EASE_OUT }}
          />
        </motion.div>
      </motion.div>

      {!reduce && (
        <>
          <motion.div
            className="home-hero-sweep absolute inset-0"
            initial={{ backgroundPosition: "160% 0" }}
            animate={{ backgroundPosition: "-60% 0" }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 6, delay: 1.6 }}
          />
          <motion.div className="home-hero-spot absolute inset-0" style={{ backgroundImage: spotlight }} />
        </>
      )}
      <div className="home-grain absolute inset-0" />
    </motion.div>
  );
}
