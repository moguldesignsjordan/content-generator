import {
  ActivityIcon,
  BlogIcon,
  CreditIcon,
  FlyerIcon,
  GearIcon,
  HomeIcon,
  ImageIcon,
  MailIcon,
  MegaphoneIcon,
  PlusIcon,
  QrCodeIcon,
  TerminalIcon,
  type IconProps,
} from "@/components/ui/icons";

export type NavGroup = "content" | "media" | "account" | "admin";

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  content: "Content",
  media: "Media",
  account: "Account",
  admin: "Admin",
};

export interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  match: (pathname: string) => boolean;
  /** Undefined = top-level (Home), rendered above the labeled sections. */
  group?: NavGroup;
  /** The app's primary action. Desktop sidebar renders it as a pinned CTA
   *  under the logo instead of a plain nav row. Ignored by the mobile tab bar. */
  primary?: boolean;
  /** Shown directly in the mobile tab bar; everything else lives in "More". */
  core?: boolean;
  /** Only rendered for the 'admin' role (see lib/db/queries.ts getUserRole). */
  adminOnly?: boolean;
}

/**
 * One ordered list drives every surface. Order within a group is the order it
 * renders; group order is fixed by the consumers (Sidebar / TabBar split
 * content+media into the main nav and account+admin into the bottom cluster).
 */
export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Home",
    Icon: HomeIcon,
    match: (p) => p === "/",
    core: true,
  },
  {
    href: "/create",
    label: "Create",
    Icon: PlusIcon,
    match: (p) => p.startsWith("/create"),
    primary: true,
    core: true,
  },
  {
    href: "/emails",
    label: "Emails",
    Icon: MailIcon,
    // Draft review pages (/drafts/[id]) can be either kind, and the pathname
    // alone can't tell which — so neither Emails nor Blogs claims /drafts. The
    // review screen's own back-link orients you instead.
    match: (p) => p.startsWith("/emails"),
    group: "content",
    core: true,
  },
  {
    href: "/blogs",
    label: "Blogs",
    Icon: BlogIcon,
    match: (p) => p.startsWith("/blogs"),
    group: "content",
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    Icon: MegaphoneIcon,
    match: (p) => p.startsWith("/campaigns"),
    group: "content",
  },
  {
    href: "/flyers",
    label: "Flyers",
    Icon: FlyerIcon,
    match: (p) => p.startsWith("/flyers"),
    group: "content",
  },
  {
    href: "/media",
    label: "Media",
    Icon: ImageIcon,
    match: (p) => p.startsWith("/media"),
    group: "media",
    core: true,
  },
  {
    href: "/qrcode",
    label: "QR Code",
    Icon: QrCodeIcon,
    match: (p) => p.startsWith("/qrcode"),
    group: "media",
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
