"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  createEmployeeAction,
  updateEmployeeAction,
} from "@/app/actions/admin";
import { todayISO } from "@/lib/date";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import type { ManagedEmployee } from "@/app/admin/employees/page";

const ROLES = ["employee", "team_lead", "hr", "admin"] as const;
const DEFAULT = { casual: 10, sick: 8, annual: 14 };
type LoginMethod = "slack" | "password";

interface Props {
  open: boolean;
  editing?: ManagedEmployee;
  teams: { id: string; name: string }[];
  onClose: () => void;
}

interface FormState {
  full_name: string;
  email: string;
  team_id: string;
  role: (typeof ROLES)[number];
  join_date: string;
  is_active: boolean;
  casual: number;
  sick: number;
  annual: number;
  /** Phase 8A — only meaningful when creating a new employee. */
  login_method: LoginMethod;
  password: string;
  force_password_change: boolean;
}

function initialState(editing?: ManagedEmployee): FormState {
  if (!editing) {
    return {
      full_name: "",
      email: "",
      team_id: "",
      role: "employee",
      join_date: todayISO(),
      is_active: true,
      casual: DEFAULT.casual,
      sick: DEFAULT.sick,
      annual: DEFAULT.annual,
      login_method: "slack",
      password: "",
      force_password_change: true,
    };
  }
  return {
    full_name: editing.full_name,
    email: editing.email,
    team_id: editing.team_id ?? "",
    role: editing.role,
    join_date: editing.join_date,
    is_active: editing.is_active,
    casual: editing.leave_allowances.casual,
    sick: editing.leave_allowances.sick,
    annual: editing.leave_allowances.annual,
    login_method: "slack",
    password: "",
    force_password_change: true,
  };
}

export function EmployeeFormDialog({ open, editing, teams, onClose }: Props) {
  const [form, setForm] = useState<FormState>(initialState(editing));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setForm(initialState(editing));
  }, [open, editing]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    const allowances = {
      casual: Number(form.casual),
      sick: Number(form.sick),
      annual: Number(form.annual),
    };
    if (
      !editing &&
      form.login_method === "password" &&
      form.password.length < MIN_PASSWORD_LENGTH
    ) {
      toast.error(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
      return;
    }
    startTransition(async () => {
      const res = editing
        ? await updateEmployeeAction({
            id: editing.id,
            full_name: form.full_name,
            email: form.email,
            team_id: form.team_id || null,
            role: form.role,
            join_date: form.join_date,
            is_active: form.is_active,
            allowances,
          })
        : await createEmployeeAction({
            full_name: form.full_name,
            email: form.email,
            team_id: form.team_id || null,
            role: form.role,
            join_date: form.join_date,
            allowances,
            ...(form.login_method === "password"
              ? {
                  password: form.password,
                  forcePasswordChange: form.force_password_change,
                }
              : {}),
          });
      if (!res.ok) {
        toast.error(res.error ?? "Failed");
        return;
      }
      toast.success(editing ? "Employee updated" : "Employee added");
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit employee" : "Add employee"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are audited automatically."
                : "Fill in the basics. Allowances default to 10/8/14."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input
                value={form.full_name}
                onChange={(e) =>
                  setForm({ ...form, full_name: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>

            <Field label="Team">
              <select
                value={form.team_id}
                onChange={(e) =>
                  setForm({ ...form, team_id: e.target.value })
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as FormState["role"] })
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Join date">
              <Input
                type="date"
                value={form.join_date}
                onChange={(e) =>
                  setForm({ ...form, join_date: e.target.value })
                }
              />
            </Field>

            {editing && (
              <Field label="Active">
                <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm({ ...form, is_active: e.target.checked })
                    }
                  />
                  {form.is_active ? "Active" : "Inactive"}
                </label>
              </Field>
            )}
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Allowances (days/year)
            </Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <Field label="Casual">
                <Input
                  type="number"
                  min={0}
                  value={form.casual}
                  onChange={(e) =>
                    setForm({ ...form, casual: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Sick">
                <Input
                  type="number"
                  min={0}
                  value={form.sick}
                  onChange={(e) =>
                    setForm({ ...form, sick: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Annual">
                <Input
                  type="number"
                  min={0}
                  value={form.annual}
                  onChange={(e) =>
                    setForm({ ...form, annual: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
          </div>

          {!editing && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Login method
              </Label>
              <RadioGroup
                value={form.login_method}
                onValueChange={(v) =>
                  setForm({ ...form, login_method: v as LoginMethod })
                }
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <label
                  htmlFor="login-slack"
                  className={`flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3 ${
                    form.login_method === "slack"
                      ? "border-primary"
                      : "border-border"
                  }`}
                >
                  <RadioGroupItem
                    id="login-slack"
                    value="slack"
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">Slack only</div>
                    <div className="text-xs text-muted-foreground">
                      Signs in via Slack OAuth. No password required.
                    </div>
                  </div>
                </label>
                <label
                  htmlFor="login-password"
                  className={`flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3 ${
                    form.login_method === "password"
                      ? "border-primary"
                      : "border-border"
                  }`}
                >
                  <RadioGroupItem
                    id="login-password"
                    value="password"
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">Password</div>
                    <div className="text-xs text-muted-foreground">
                      You issue a temp password; they pick their own on
                      first sign-in.
                    </div>
                  </div>
                </label>
              </RadioGroup>

              {form.login_method === "password" && (
                <div className="space-y-2 pt-1">
                  <Field label="Temporary password">
                    <Input
                      type="text"
                      autoComplete="off"
                      minLength={MIN_PASSWORD_LENGTH}
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      required
                    />
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={form.force_password_change}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          force_password_change: e.target.checked,
                        })
                      }
                    />
                    Force change on first login (recommended)
                  </label>
                </div>
              )}
            </div>
          )}

          {editing?.slack_user_id && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Slack user ID:{" "}
              <span className="font-mono">{editing.slack_user_id}</span>{" "}
              (read-only — set automatically when they log in)
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
