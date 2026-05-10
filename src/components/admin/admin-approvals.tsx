import Link from "next/link";

import { ApprovalsList, type ApprovalItem } from "@/components/leave/approvals-list";
import { Card, CardContent } from "@/components/ui/card";

export function AdminApprovalsCard({
  items,
  emptyText = "Nothing pending. :tada:",
}: {
  items: ApprovalItem[];
  emptyText?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight">
            Pending approvals
          </h3>
          <Link
            href="/approvals"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Open page
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <ApprovalsList items={items} />
        )}
      </CardContent>
    </Card>
  );
}
