import { cn } from "@/lib/cn";

/** The Mogul brand mark (raster). Rounded so any hard background edge softens. */
export function Logo({
  height = 30,
  className,
  alt = "Mogul",
}: {
  height?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/mogul-logo.webp"
      alt={alt}
      height={height}
      style={{ height, width: "auto" }}
      className={cn("rounded-md object-contain", className)}
    />
  );
}

/** Text-only wordmark in Clash Grotesk, for tight chrome / fallbacks. */
export function Wordmark({
  className,
  children = "Mogul",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "font-display text-[19px] font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
