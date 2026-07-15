import {
  ActivityIcon,
  BlogIcon,
  CreditIcon,
  FlyerIcon,
  GearIcon,
  HomeIcon,
  MailIcon,
  MegaphoneIcon,
  PlusIcon,
  TerminalIcon,
  type IconProps,
} from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  match: (pathname: string) => boolean;
  /** Only rendered for the 'admin' role (see lib/db/queries.ts getUserRole). */
  adminOnly?: boolean;
}

export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Home",
    Icon: HomeIcon,
    match: (p) => p === "/",
  },
  {
    href: "/emails",
    label: "Emails",
    Icon: MailIcon,
    // Draft review pages (/drafts/[id]) can be either kind, and the pathname
    // alone can't tell which — so neither Emails nor Blogs claims /drafts. The
    // review screen's own back-link orients you instead.
    match: (p) => p.startsWith("/emails"),
  },
  {
    href: "/blogs",
    label: "Blogs",
    Icon: BlogIcon,
    match: (p) => p.startsWith("/blogs"),
  },
  {
    href: "/flyers",
    label: "Flyers",
    Icon: FlyerIcon,
    match: (p) => p.startsWith("/flyers"),
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    Icon: MegaphoneIcon,
    match: (p) => p.startsWith("/campaigns"),
  },
  {
    href: "/create",
    label: "Create",
    Icon: PlusIcon,
    match: (p) => p.startsWith("/create"),
  },
  {
    href: "/billing",
    label: "Billing",
    Icon: CreditIcon,
    match: (p) => p.startsWith("/billing"),
  },
  {
    href: "/settings",
    label: "Settings",
    Icon: GearIcon,
    match: (p) => p.startsWith("/settings"),
  },
  {
    href: "/logs",
    label: "Logs",
    Icon: ActivityIcon,
    match: (p) => p.startsWith("/logs"),
    adminOnly: true,
  },
  {
    href: "/prompts",
    label: "Prompts",
    Icon: TerminalIcon,
    match: (p) => p.startsWith("/prompts"),
    adminOnly: true,
  },
];
