import { describe, expect, it } from "vitest";
import { cleanFlyerEdit, flyerEditRerenders, type FlyerEditAction } from "./chat-preview";

const opts = { optionCount: 4, storageHost: "abc.supabase.co" };
const photo = "https://abc.supabase.co/storage/v1/object/public/content-images/a.jpg";

describe("cleanFlyerEdit", () => {
  it("accepts an option switch within range", () => {
    expect(cleanFlyerEdit({ option: 2 }, opts)).toEqual({ kind: "flyer", option: 2 });
    expect(cleanFlyerEdit({ option: 5 }, opts)).toMatch(/pick one from 1 to 4/);
    expect(cleanFlyerEdit({ option: 1.5 }, opts)).toMatch(/pick one/);
  });

  it("cleans text edits, keeps blank lines as clears, and rejects a blank headline", () => {
    const dash = String.fromCharCode(0x2014);
    expect(cleanFlyerEdit({ headline: ` Stop the grind ${dash} now `, subtext: "" }, opts)).toEqual({
      kind: "flyer",
      headline: "Stop the grind ,  now",
      subtext: "",
    });
    expect(cleanFlyerEdit({ headline: "  " }, opts)).toMatch(/can't be empty/);
  });

  it("only takes photos hosted on our storage, defaulting to placing them", () => {
    expect(cleanFlyerEdit({ photo_url: photo, note: "on the right" }, opts)).toEqual({
      kind: "flyer",
      photo_url: photo,
      photo_use: "place",
      note: "on the right",
    });
    expect(cleanFlyerEdit({ photo_url: photo, photo_use: "style", note: "x" }, opts)).toEqual({
      kind: "flyer",
      photo_url: photo,
      photo_use: "style",
    });
    expect(cleanFlyerEdit({ photo_url: "https://evil.example/a.jpg" }, opts)).toMatch(/attached in this chat/);
    expect(cleanFlyerEdit({ photo_url: "http://abc.supabase.co/a.jpg" }, opts)).toMatch(/attached in this chat/);
  });

  it("asks for a change when given nothing", () => {
    expect(cleanFlyerEdit({}, opts)).toMatch(/Nothing to change/);
    expect(cleanFlyerEdit({ pro: false }, opts)).toMatch(/Nothing to change/);
  });
});

describe("flyerEditRerenders", () => {
  it("re-renders for text, scene, or Pro, not for a pick or photo alone", () => {
    const base: FlyerEditAction = { kind: "flyer" };
    expect(flyerEditRerenders({ ...base, option: 2 })).toBe(false);
    expect(flyerEditRerenders({ ...base, photo_url: photo, photo_use: "place" })).toBe(false);
    expect(flyerEditRerenders({ ...base, subtext: "" })).toBe(true);
    expect(flyerEditRerenders({ ...base, pro: true })).toBe(true);
  });
});
