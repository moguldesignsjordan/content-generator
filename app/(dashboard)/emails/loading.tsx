import { Card, Skeleton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";

export default function EmailsLoading() {
  return (
    <>
      <ScreenHeader
        title="Emails"
        subtitle="Every draft, newest first. Tap to review and approve."
      />
      <Skeleton variant="rect" height={40} className="mb-5 w-full max-w-sm rounded-full" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton width="60%" />
              <Skeleton width="35%" height={11} />
            </div>
            <Skeleton variant="rect" width={72} height={22} className="rounded-full" />
          </Card>
        ))}
      </div>
    </>
  );
}
