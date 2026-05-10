"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateNotificationPrefsAction } from "@/app/actions/settings";

interface Props {
  digestEnabled: boolean;
  nudgeEnabled: boolean;
}

export function NotificationToggles({ digestEnabled, nudgeEnabled }: Props) {
  const [digest, setDigest] = useState(digestEnabled);
  const [nudge, setNudge] = useState(nudgeEnabled);
  const [pending, startTransition] = useTransition();
  const dirty = digest !== digestEnabled || nudge !== nudgeEnabled;

  function save() {
    startTransition(async () => {
      const res = await updateNotificationPrefsAction({
        digest_enabled: digest,
        nudge_enabled: nudge,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save");
        return;
      }
      toast.success("Settings saved");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-1 p-0">
        <Toggle
          label="Sunday weekly digest"
          description="A Slack DM every Sunday evening with last week's recap and your remaining balances."
          value={digest}
          onChange={setDigest}
        />
        <div className="border-t" />
        <Toggle
          label="Daily morning nudge"
          description="A reminder DM at 9:30 AM if you haven't logged attendance for the day yet. Skipped on holidays + weekends."
          value={nudge}
          onChange={setNudge}
        />

        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button
            variant="ghost"
            onClick={() => {
              setDigest(digestEnabled);
              setNudge(nudgeEnabled);
            }}
            disabled={!dirty || pending}
          >
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 p-5 hover:bg-muted/30">
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </label>
  );
}

function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
