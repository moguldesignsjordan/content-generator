"use client";

import Image from "next/image";
import { motion, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/cn";
import { KIND_ART } from "./art";
import type { StarterKind } from "./create-agent";

const TILES: { kind: StarterKind; label: string; blurb: string }[] = [
  { kind: "flyer", label: "Flyer", blurb: "4 designs to pick from" },
  { kind: "email", label: "Email", blurb: "A newsletter or a promo" },
  { kind: "campaign", label: "Campaign", blurb: "Posts, emails and ads in one go" },
  { kind: "blog", label: "Blog post", blurb: "An article for your site" },
  { kind: "ad", label: "Ad", blurb: "For Facebook and Instagram" },
];

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * The landing's big "what are we making?" buttons, one glass tile per kind.
 * Tapping one starts the chat for that kind, same as typing it. A sideways
 * rail on phones, five across from sm up.
 */
export function KindTiles({
  onPick,
  picked,
  disabled,
}: {
  onPick: (kind: StarterKind) => void;
  /** Lit when a link preset the kind (e.g. "New campaign"). */
  picked: StarterKind | null;
  disabled: boolean;
}) {
  return (
    <div className="rail-fade -mx-4 sm:mx-0 sm:[-webkit-mask-image:none] sm:[mask-image:none]">
      <div className="no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 py-1.5 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:px-0">
        {TILES.map((tile, i) => (
          <Tile
            key={tile.kind}
            {...tile}
            index={i}
            pressed={picked === tile.kind}
            onPick={onPick}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

/** Leans toward the mouse and springs back; the art drifts closer on hover. */
function Tile({
  kind,
  label,
  blurb,
  index,
  pressed,
  onPick,
  disabled,
}: {
  kind: StarterKind;
  label: string;
  blurb: string;
  index: number;
  pressed: boolean;
  onPick: (kind: StarterKind) => void;
  disabled: boolean;
}) {
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 200, damping: 18 });
  const rotateY = useSpring(0, { stiffness: 200, damping: 18 });

  return (
    <motion.button
      type="button"
      onClick={() => onPick(kind)}
      disabled={disabled}
      aria-pressed={pressed}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.75 + index * 0.06, ease: EASE_OUT }}
      whileTap={{ scale: 0.96 }}
      style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 800 }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        rotateY.set(((e.clientX - r.left) / r.width - 0.5) * 16);
        rotateX.set(((e.clientY - r.top) / r.height - 0.5) * -16);
      }}
      onPointerLeave={() => {
        rotateX.set(0);
        rotateY.set(0);
      }}
      className={cn(
        "group flex w-[132px] shrink-0 snap-start flex-col overflow-hidden rounded-[22px] border bg-surface-2 text-left transition-[border-color,box-shadow] duration-200 disabled:opacity-50 sm:w-auto",
        pressed
          ? "border-accent/60 shadow-[0_0_28px_-12px_rgba(255,61,140,0.55),0_0_56px_-22px_rgba(158,77,242,0.4)]"
          : "border-border hover:border-accent/45 hover:shadow-[0_0_28px_-14px_rgba(255,61,140,0.45),0_0_56px_-22px_rgba(158,77,242,0.35)]",
      )}
    >
      <span className="art-frame block aspect-square w-full overflow-hidden">
        <Image
          src={KIND_ART[kind]}
          alt=""
          sizes="(min-width: 640px) 152px, 132px"
          placeholder="blur"
          priority
          className="h-full w-full scale-[1.15] object-cover transition-transform duration-500 ease-out group-hover:scale-[1.3]"
        />
      </span>
      <span className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <span className="text-[14.5px] font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 text-[12px] leading-snug text-muted">{blurb}</span>
      </span>
    </motion.button>
  );
}
