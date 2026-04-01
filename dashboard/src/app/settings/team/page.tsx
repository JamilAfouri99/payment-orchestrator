"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listTeamMembers,
  inviteTeamMember,
  changeTeamRole,
  type TeamMemberRecord,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const ROLES = ["owner", "admin", "developer", "viewer"];

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-accent/15 text-accent border-accent/30",
  admin: "bg-warning/15 text-warning border-warning/30",
  developer: "bg-success/15 text-success border-success/30",
  viewer: "bg-muted/15 text-muted border-muted/30",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  invited: "bg-warning/15 text-warning border-warning/30",
  disabled: "bg-danger/15 text-danger border-danger/30",
};

function canManage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Per-member role change state
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listTeamMembers();
      setMembers(data.members);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load team members",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setInviteError("Email is required");
      return;
    }
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await inviteTeamMember(inviteEmail.trim(), inviteRole);
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setInviteRole("developer");
      setShowInviteForm(false);
      // Reload to show pending invite
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    setChangingRole(memberId);
    try {
      await changeTeamRole(memberId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    } finally {
      setChangingRole(null);
    }
  }

  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "invited");
  const isManager = canManage(user?.role);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Team</h2>
          <p className="text-muted text-sm mt-1">
            Manage team members and their permissions
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => {
              setShowInviteForm((v) => !v);
              setInviteSuccess(null);
            }}
            className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            {showInviteForm ? "Cancel" : "+ Invite Member"}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {inviteSuccess && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-sm text-success flex items-center justify-between">
          <span>{inviteSuccess}</span>
          <button
            onClick={() => setInviteSuccess(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Invite form */}
      {showInviteForm && isManager && (
        <form
          onSubmit={handleInvite}
          className="bg-card border border-card-border rounded-xl p-6 space-y-4"
        >
          <h3 className="font-semibold">Invite Team Member</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {inviteError && (
            <p className="text-sm text-danger">{inviteError}</p>
          )}

          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {inviting ? "Sending invite..." : "Send Invite"}
          </button>
        </form>
      )}

      {/* Active members table */}
      <MembersTable
        title="Members"
        subtitle={loading ? "Loading..." : `${activeMembers.length} member${activeMembers.length !== 1 ? "s" : ""}`}
        members={activeMembers}
        loading={loading}
        isManager={isManager}
        currentUserId={user?.id}
        changingRole={changingRole}
        onRoleChange={handleRoleChange}
        emptyText="No active members found."
      />

      {/* Pending invites */}
      {(pendingMembers.length > 0 || isManager) && (
        <MembersTable
          title="Pending Invites"
          subtitle={`${pendingMembers.length} pending`}
          members={pendingMembers}
          loading={false}
          isManager={isManager}
          currentUserId={user?.id}
          changingRole={changingRole}
          onRoleChange={handleRoleChange}
          emptyText="No pending invites."
        />
      )}
    </div>
  );
}

function MembersTable({
  title,
  subtitle,
  members,
  loading,
  isManager,
  currentUserId,
  changingRole,
  onRoleChange,
  emptyText,
}: {
  title: string;
  subtitle: string;
  members: TeamMemberRecord[];
  loading: boolean;
  isManager: boolean;
  currentUserId: string | undefined;
  changingRole: string | null;
  onRoleChange: (memberId: string, role: string) => Promise<void>;
  emptyText: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="p-5 border-b border-card-border">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted mt-0.5">{subtitle}</p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-muted text-sm animate-pulse">
          Loading...
        </div>
      ) : members.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-card-border">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Last login</th>
                {isManager && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center text-xs font-semibold text-accent shrink-0">
                        {m.name?.charAt(0).toUpperCase() ?? "?"}
                      </div>
                      <span className="font-medium text-sm">{m.name}</span>
                      {m.userId === currentUserId && (
                        <span className="text-xs text-muted">(you)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted text-xs">{m.email}</td>
                  <td className="px-5 py-3">
                    <Badge
                      label={m.role}
                      style={ROLE_BADGE[m.role] ?? "bg-muted/15 text-muted border-muted/30"}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <Badge
                      label={m.status}
                      style={STATUS_BADGE[m.status] ?? "bg-muted/15 text-muted border-muted/30"}
                    />
                  </td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {m.lastLoginAt
                      ? new Date(m.lastLoginAt).toLocaleDateString()
                      : "Never"}
                  </td>
                  {isManager && (
                    <td className="px-5 py-3 text-right">
                      {m.userId !== currentUserId && m.role !== "owner" && (
                        <select
                          value={m.role}
                          onChange={(e) => onRoleChange(m.id, e.target.value)}
                          disabled={changingRole === m.id}
                          className="bg-background border border-card-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                        >
                          {ROLES.filter((r) => r !== "owner").map((r) => (
                            <option key={r} value={r}>
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {label}
    </span>
  );
}
