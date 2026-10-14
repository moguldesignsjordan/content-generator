import Link from "next/link";
import { Card } from "@/components/ui";
import { BlogIcon, FlyerIcon, ImageIcon, MailIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../_components/screen-header";

// One door to everything already made. Each kind keeps its own list page
// (filters, archive, bulk actions); this just puts them in one place.
const SECTIONS = [
  { href: "/emails", label: "Emails", hint: "Every email, sent or in progress", Icon: MailIcon },
  { href: "/blogs", label: "Blog posts", hint: "Posts drafted and published to your site", Icon: BlogIcon },
  { href: "/flyers", label: "Social posts and ads", hint: "Flyers, captions, and ad copy", Icon: FlyerIcon },
  { href: "/media", label: "Media", hint: "Images, uploads, style and competitor references", Icon: ImageIcon },
];

export default function LibraryPage() {
  return (
    <>
      <ScreenHeader title="Library" subtitle="Everything you've made, by kind." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ href, label, hint, Icon }) => (
          <li key={href}>
            <Link href={href} className="block h-full">
              <Card className="flex h-full items-center gap-4 p-5 transition-colors hover:border-foreground/20">
                <Icon size={24} className="shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-foreground">{label}</p>
                  <p className="text-[13px] text-muted">{hint}</p>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
