import {
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
    match: (p) => p.startsWith("/emails") || p.startsWith("/drafts"),
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
];
