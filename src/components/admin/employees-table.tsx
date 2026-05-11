"use client";

import { useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmployeeFormDialog } from "@/components/admin/employee-form-dialog";
import {
  deactivateEmployeeAction,
  reactivateEmployeeAction,
} from "@/app/actions/admin";
import type { ManagedEmployee } from "@/app/admin/employees/page";

const DEFAULT_ALLOWANCES = { casual: 10, sick: 8, annual: 14 } as const;

interface EmployeesTableProps {
  employees: ManagedEmployee[];
  teams: { id: string; name: string }[];
}

export function EmployeesTable({ employees, teams }: EmployeesTableProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ManagedEmployee | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = query
    ? employees.filter(
        (e) =>
          e.full_name.toLowerCase().includes(query.toLowerCase()) ||
          e.email.toLowerCase().includes(query.toLowerCase()) ||
          (e.team_name ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : employees;

  function handleDeactivate(emp: ManagedEmployee) {
    if (!confirm(`Deactivate ${emp.full_name}?`)) return;
    setPendingId(emp.id);
    startTransition(async () => {
      const res = await deactivateEmployeeAction(emp.id);
      setPendingId(null);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else toast.success(`${emp.full_name} deactivated`);
    });
  }

  function handleReactivate(emp: ManagedEmployee) {
    setPendingId(emp.id);
    startTransition(async () => {
      const res = await reactivateEmployeeAction(emp.id);
      setPendingId(null);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else toast.success(`${emp.full_name} reactivated`);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add employee
        </Button>
      </div>

      {/* Mobile: card stack */}
      <div className="space-y-2 sm:hidden">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="px-3 py-12 text-center text-sm text-muted-foreground">
              No employees match.
            </CardContent>
          </Card>
        ) : (
          filtered.map((e) => {
            const isCustom =
              e.leave_allowances.casual !== DEFAULT_ALLOWANCES.casual ||
              e.leave_allowances.sick !== DEFAULT_ALLOWANCES.sick ||
              e.leave_allowances.annual !== DEFAULT_ALLOWANCES.annual;
            const initials = e.full_name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join("");
            return (
              <Card
                key={e.id}
                className={e.is_active ? "" : "opacity-60"}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">
                          {e.full_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.email}
                        </div>
                      </div>
                    </div>
                    {e.is_active ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="secondary" className="capitalize">
                      {e.role.replace("_", " ")}
                    </Badge>
                    {e.team_name && (
                      <Badge variant="outline">{e.team_name}</Badge>
                    )}
                    <Badge variant="outline" className="font-mono">
                      {e.leave_allowances.casual}/
                      {e.leave_allowances.sick}/
                      {e.leave_allowances.annual}
                    </Badge>
                    {isCustom && (
                      <Badge variant="secondary">custom</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(e)}
                    >
                      Edit
                    </Button>
                    {e.is_active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeactivate(e)}
                        disabled={pendingId === e.id}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReactivate(e)}
                        disabled={pendingId === e.id}
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card className="hidden sm:block">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Allowance</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-12 text-center text-sm text-muted-foreground"
                  >
                    No employees match.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => {
                  const isCustom =
                    e.leave_allowances.casual !== DEFAULT_ALLOWANCES.casual ||
                    e.leave_allowances.sick !== DEFAULT_ALLOWANCES.sick ||
                    e.leave_allowances.annual !== DEFAULT_ALLOWANCES.annual;
                  const initials = e.full_name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("");
                  return (
                    <tr
                      key={e.id}
                      className={`border-t ${e.is_active ? "" : "opacity-60"}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback>{initials}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{e.full_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {e.email}
                      </td>
                      <td className="px-3 py-2">{e.team_name ?? "—"}</td>
                      <td className="px-3 py-2 capitalize">
                        {e.role.replace("_", " ")}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="font-mono text-xs">
                            {e.leave_allowances.casual}/
                            {e.leave_allowances.sick}/
                            {e.leave_allowances.annual}
                          </Badge>
                          {isCustom && (
                            <Badge variant="secondary" className="text-xs">
                              custom
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {e.is_active ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(e)}
                          >
                            Edit
                          </Button>
                          {e.is_active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeactivate(e)}
                              disabled={pendingId === e.id}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleReactivate(e)}
                              disabled={pendingId === e.id}
                            >
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <EmployeeFormDialog
        open={adding}
        teams={teams}
        onClose={() => setAdding(false)}
      />
      <EmployeeFormDialog
        open={!!editing}
        editing={editing ?? undefined}
        teams={teams}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
