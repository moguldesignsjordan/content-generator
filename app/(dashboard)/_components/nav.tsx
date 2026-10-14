import {
  ActivityIcon,
  ArchiveIcon,
  BoltIcon,
  CheckIcon,
  CreditIcon,
  GearIcon,
  LightbulbIcon,
  MegaphoneIcon,
  PlusIcon,
  QrCodeIcon,
  SendIcon,
  TerminalIcon,
  type IconProps,
} from "@/components/ui/icons";

export type NavGroup = "more" | "account" | "admin";

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  more: "More tools",
  account: "Account",
  admin: "Admin",
};

export interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  match: (pathname: string) => boolean;
  /** Undefined = top-level, rendered above the labeled sections. */
  group?: NavGroup;
  /** The app's primary action. Desktop sidebar renders it as a pinned CTA
   *  under the logo instead of a plain nav row. Ignored by the mobile tab bar. */
  primary?: boolean;
  /** Shown directly in the mobile tab bar; everything else lives in "More". */
  core?: boolean;
  /** Only rendered for the 'admin' role (see lib/db/queries.ts getUserRole). */
  adminOnly?: boolean;
}

/** The kind lists the Library page opens; Library stays lit on all of them. */
const LIBRARY_PATHS = ["/library", "/emails", "/blogs", "/flyers", "/media"];

/**
 * One ordered list drives every surface. Four top-level destinations carry the
 * main loop (make a campaign, follow it, approve, find past work); the
 * occasional tools sit under "More tools" so they never crowd it.
 */
export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Create",
    Icon: PlusIcon,
    match: (p) => p === "/",
    primary: true,
    core: true,
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    Icon: MegaphoneIcon,
    match: (p) => p.startsWith("/campaigns"),
    core: true,
  },
  {
    href: "/review",
    label: "Review",
    Icon: CheckIcon,
    // Draft review pages (/drafts/[id]) are where Review leads.
    match: (p) => p.startsWith("/review") || p.startsWith("/drafts"),
    core: true,
  },
  {
    href: "/library",
    label: "Library",
    Icon: ArchiveIcon,
    match: (p) => LIBRARY_PATHS.some((path) => p.startsWith(path)),
    core: true,
  },
  {
    href: "/plan",
    label: "Content plan",
    Icon: LightbulbIcon,
    match: (p) => p.startsWith("/plan"),
    group: "more",
  },
  {
    href: "/chat",
    label: "Quick chat",
    Icon: BoltIcon,
    match: (p) => p.startsWith("/chat"),
    group: "more",
  },
  {
    href: "/social",
    label: "Social calendar",
    Icon: SendIcon,
    match: (p) => p.startsWith("/social"),
    group: "more",
  },
  {
    href: "/qrcode",
    label: "QR Code",
    Icon: QrCodeIcon,
    match: (p) => p.startsWith("/qrcode"),
    group: "more",
  },
  {
    href: "/settings",
    label: "Settings",
    Icon: GearIcon,
    match: (p) => p.startsWith("/settings"),
    group: "account",
  },
  {
    href: "/billing",
    label: "Billing",
    Icon: CreditIcon,
    match: (p) => p.startsWith("/billing"),
    group: "account",
  },
  {
    href: "/logs",
    label: "Logs",
    Icon: ActivityIcon,
    match: (p) => p.startsWith("/logs"),
    group: "admin",
    adminOnly: true,
  },
  {
    href: "/prompts",
    label: "Prompts",
    Icon: TerminalIcon,
    match: (p) => p.startsWith("/prompts"),
    group: "admin",
    adminOnly: true,
  },
];
