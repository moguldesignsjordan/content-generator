import { stripEmDashes } from "@/lib/text";

// What the Create chat asks its live preview card to do. The agent decides
// (edit_flyer / revise_piece); the card runs it through the same endpoints the
// review page uses, so guards, timeouts, and persistence stay in one place.
// Pure and client-safe: the route validates with it, the card reads the types.

export interface FlyerEditAction {
  kind: "flyer";
  /** 1-based option to switch to. */
  option?: number;
  headline?: string;
  /** "" clears the line. */
  subtext?: string;
  scene?: string;
  /** A photo from this chat, hosted on our storage. */
  photo_url?: string;
  photo_use?: "place" | "style";
  note?: string;
  /** Re-render the current option on the Pro image model. */
  pro?: boolean;
}

export interface ReviseAction {
  kind: "revise";
  feedback: string;
}

export type PreviewAction = FlyerEditAction | ReviseAction;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return stripEmDashes(value).trim().slice(0, max);
}

/** Validates the agent's edit_flyer input. Returns the action, or a reason to
 * hand back to the model. */
export function cleanFlyerEdit(
  input: unknown,
  opts: { optionCount: number; storageHost: string | null },
): FlyerEditAction | string {
  const raw = (input ?? {}) as Record<string, unknown>;
  const action: FlyerEditAction = { kind: "flyer" };

  if (raw.option !== undefined) {
    const option = Number(raw.option);
    if (!Number.isInteger(option) || option < 1 || option > opts.optionCount) {
      return `There are ${opts.optionCount} options; pick one from 1 to ${opts.optionCount}.`;
    }
    action.option = option;
  }

  const headline = text(raw.headline, 80);
  if (headline !== undefined) {
    if (!headline) return "The headline can't be empty.";
    action.headline = headline;
  }
  const subtext = text(raw.subtext, 100);
  if (subtext !== undefined) action.subtext = subtext;
  const scene = text(raw.scene, 400);
  if (scene) action.scene = scene;

  if (raw.photo_url !== undefined) {
    let host: string | null = null;
    try {
      const url = new URL(String(raw.photo_url));
      if (url.protocol === "https:") host = url.host;
    } catch {
      // falls through to the error below
    }
    if (!host || host !== opts.storageHost) {
      return "Use the exact URL of a photo attached in this chat.";
    }
    action.photo_url = String(raw.photo_url);
    action.photo_use = raw.photo_use === "style" ? "style" : "place";
    const note = text(raw.note, 300);
    if (note && action.photo_use === "place") action.note = note;
  }

  if (raw.pro === true) action.pro = true;

  const changes = Object.keys(action).filter((k) => k !== "kind");
  if (!changes.length) return "Nothing to change: say what to change on the flyer.";
  return action;
}

/** Whether the edit re-renders the flyer (beyond switching options or adding a photo). */
export function flyerEditRerenders(action: FlyerEditAction): boolean {
  return (
    action.headline !== undefined ||
    action.subtext !== undefined ||
    action.scene !== undefined ||
    action.pro === true
  );
}
