"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTeamAction,
  deleteTeamAction,
  setTeamLeadAction,
} from "@/app/actions/admin";
import type { ManagedTeam } from "@/app/admin/teams/page";

export function TeamsManager({ teams }: { teams: ManagedTeam[] }) {
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createTeamAction({
        name: newName,
        lead_id: null,
      });
      if (!res.ok) toast.error(res.error ?? "Failed");
      else {
        toast.success("Team created");
        setNewName("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="newTeam">Add team</Label>
              <Input
                id="newTeam"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Engineering"
              />
            </div>
            <Button type="submit" disabled={pending || !newName.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {teams.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
            No teams yet — add your first one above.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teams.map((t) => (
            <TeamRow key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamRow({ team }: { team: ManagedTeam }) {
  const [leadId, setLeadId] = useState(team.lead_id ?? "");
  const [pending, startTransition] = useTransition();

  function handleLeadChange(next: string) {
    setLeadId(next);
    startTransition(async () => {
      const res = await setTeamLeadAction({
        teamId: team.id,
        leadId: next || null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Failed");
        setLeadId(team.lead_id ?? "");
      } else {
        toast.success("Lead updated");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete team "${team.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteTeamAction(team.id);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else toast.success("Team deleted");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{team.name}</div>
            <div className="text-xs text-muted-foreground">
              {team.member_count}{" "}
              {team.member_count === 1 ? "member" : "members"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={pending || team.member_count > 0}
            title={
              team.member_count > 0
                ? "Reassign members before deleting"
                : "Delete team"
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Lead</Label>
          <select
            value={leadId}
            onChange={(e) => handleLeadChange(e.target.value)}
            disabled={pending || team.members.length === 0}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="">No lead</option>
            {team.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          {team.members.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add members on this team before you can assign a lead.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
