import { Card, Skeleton } from "@/components/ui";

// This sits at the (dashboard) group's root, so Next uses it as the loading
// fallback for any nested dashboard route that doesn't define its own more
// specific loading.tsx (see emails/loading.tsx for one that does) — kept
// generic on purpose so it reads fine no matter which page is arriving.
export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton width="45%" height={30} className="rounded-[8px]" />
        <Skeleton width="30%" height={16} className="mt-2.5 rounded-[6px]" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="space-y-2.5 p-5">
          <Skeleton width="40%" height={13} />
          <Skeleton width="90%" />
          <Skeleton width="70%" />
        </Card>
      ))}
    </div>
  );
}
