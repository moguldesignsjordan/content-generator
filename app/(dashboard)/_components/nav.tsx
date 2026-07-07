import {
  ActivityIcon,
  BlogIcon,
  GearIcon,
  HomeIcon,
  MailIcon,
  PlusIcon,
  type IconProps,
} from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  match: (pathname: string) => boolean;
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
    href: "/create",
    label: "Create",
    Icon: PlusIcon,
    match: (p) => p.startsWith("/create"),
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
  },
];
