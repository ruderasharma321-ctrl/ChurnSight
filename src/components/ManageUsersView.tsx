import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Shield,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { CompanyWorkspaceInfo, UserAccount, UserPermissions, UserRole } from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { formatRoleLabel, getInitials } from '../utils/imageHelpers';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import { TableRowsSkeleton } from './PremiumUI';

interface ManageUsersViewProps {
  currentUser: UserAccount;
  company: CompanyWorkspaceInfo;
  onUsersChanged?: () => void;
}

export const ManageUsersView: React.FC<ManageUsersViewProps> = ({
  currentUser,
  company,
  onUsersChanged,
}) => {
  const isWorkspaceAdmin =
    currentUser.role === 'FIRM_ADMIN' || currentUser.role === 'PLATFORM_OWNER';
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>('ANALYST');
  const [newPermissions, setNewPermissions] = useState<UserPermissions>({
    canUploadAndAnalyse: true,
    canGeneratePredictions: true,
  });
  const [isCreating, setIsCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [isResettingPw, setIsResettingPw] = useState(false);

  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load company users.');
        return;
      }
      setUsers(data.users || []);
    } catch {
      setError('Network error while fetching users.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isWorkspaceAdmin) {
      loadUsers();
    } else {
      setIsLoading(false);
    }
  }, [isWorkspaceAdmin]);

  if (!isWorkspaceAdmin) {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-10 text-center max-w-xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-[#FF786B]/15 text-[#E04F44] flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#11142B]">Administrator Access Required</h2>
        <p className="text-sm text-slate-600">
          Only Firm Administrators can view, invite, or manage user roles and permissions.
        </p>
      </div>
    );
  }

  const seatsRemaining = Math.max(0, plan.maxUsers - users.length);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (newFullName.trim().length < 2) {
      setError('Full name must be at least 2 characters long.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Initial password must be at least 8 characters long.');
      return;
    }

    setIsCreating(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newFullName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
          permissions: newPermissions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to add user.');
        return;
      }
      setUsers((prev) => [...prev, data.user]);
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('ANALYST');
      setNewPermissions({ canUploadAndAnalyse: true, canGeneratePredictions: true });
      setShowAddForm(false);
      setNotice(`Added ${data.user.fullName} (${formatRoleLabel(data.user.role)}) to ${company.name}.`);
      onUsersChanged?.();
    } catch {
      setError('Network error while creating user.');
    } finally {
      setIsCreating(false);
    }
  };

  const handlePatchUser = async (
    userId: string,
    payload: {
      role?: UserRole;
      isActive?: boolean;
      permissions?: Partial<UserPermissions>;
    },
    successMsg: string
  ) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update user.');
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? data.user : u)));
      setNotice(successMsg);
    } catch {
      setError('Network error while updating user.');
    }
  };

  const handleResetMemberPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setError(null);
    setNotice(null);

    if (resetPasswordVal.length < 8) {
      setError('Temporary password must be at least 8 characters long.');
      return;
    }

    setIsResettingPw(true);
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(resetTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to reset user password.');
        return;
      }
      setNotice(`Password reset for ${resetTarget.fullName}. Existing sessions were signed out.`);
      setResetTarget(null);
      setResetPasswordVal('');
    } catch {
      setError('Network error while resetting password.');
    } finally {
      setIsResettingPw(false);
    }
  };

  const activeCount = users.filter((u) => u.isActive).length;
  const adminCount = users.filter((u) => u.role === 'FIRM_ADMIN' || u.role === 'PLATFORM_OWNER').length;
  const analystCount = users.filter((u) => u.role === 'ANALYST').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">Manage Users</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Manage team members, roles, and seat quota ({users.length} / {plan.maxUsers} on{' '}
            {plan.name}) for <span className="font-semibold text-[#11142B]">{company.name}</span>
          </p>
        </div>

        <button
          type="button"
          disabled={seatsRemaining === 0 && !showAddForm}
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 transition-all disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>
            {showAddForm
              ? 'Cancel New User'
              : seatsRemaining === 0
                ? 'Seat Quota Reached'
                : 'Add New User'}
          </span>
        </button>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-purple-100/90 rounded-2xl p-4 shadow-sm shadow-purple-950/[0.03]">
          <div className="text-xs font-semibold text-slate-500">Seat Usage</div>
          <div className="text-2xl font-bold text-[#11142B] font-mono tabular-nums mt-1">
            {users.length} / {plan.maxUsers}
          </div>
        </div>
        <div className="bg-white border border-purple-100/90 rounded-2xl p-4 shadow-sm shadow-purple-950/[0.03]">
          <div className="text-xs font-semibold text-[#0E9F6E]">Active Accounts</div>
          <div className="text-2xl font-bold text-[#0E9F6E] font-mono tabular-nums mt-1">
            {activeCount}
          </div>
        </div>
        <div className="bg-white border border-purple-100/90 rounded-2xl p-4 shadow-sm shadow-purple-950/[0.03]">
          <div className="text-xs font-semibold text-[#7655E8]">Administrators</div>
          <div className="text-2xl font-bold text-[#7655E8] font-mono tabular-nums mt-1">
            {adminCount}
          </div>
        </div>
        <div className="bg-white border border-purple-100/90 rounded-2xl p-4 shadow-sm shadow-purple-950/[0.03]">
          <div className="text-xs font-semibold text-[#397BFF]">Analysts</div>
          <div className="text-2xl font-bold text-[#397BFF] font-mono tabular-nums mt-1">
            {analystCount}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-[#9A2E25]">
          <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-[#065F46]">
          <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* Add New User Form */}
      {showAddForm && (
        <div className="bg-white border border-purple-200 rounded-2xl shadow-md shadow-purple-950/[0.05] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#11142B]">Create Company User</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                New accounts are isolated to {company.name} ({seatsRemaining} seat(s) remaining)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#11142B] hover:bg-[#F5F3FF] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">Full Name</label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g., Aina Rahman"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="analyst@company.com"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Initial Password (min 8 chars)
                </label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-3 pr-9 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                  >
                    {showNewPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Assign Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                >
                  <option value="ANALYST">ANALYST</option>
                  <option value="FIRM_ADMIN">FIRM ADMIN</option>
                </select>
              </div>
            </div>

            {newRole === 'ANALYST' && (
              <div className="bg-[#F5F3FF]/70 border border-purple-100 rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-[#11142B]">Analyst Permissions</div>
                <div className="flex flex-wrap gap-5 text-xs text-slate-700">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.canUploadAndAnalyse}
                      onChange={(e) =>
                        setNewPermissions((p) => ({
                          ...p,
                          canUploadAndAnalyse: e.target.checked,
                        }))
                      }
                      className="rounded border-purple-300 text-[#7655E8] accent-[#7655E8]"
                    />
                    <span>Upload &amp; modify customer datasets</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.canGeneratePredictions}
                      onChange={(e) =>
                        setNewPermissions((p) => ({
                          ...p,
                          canGeneratePredictions: e.target.checked,
                        }))
                      }
                      className="rounded border-purple-300 text-[#7655E8] accent-[#7655E8]"
                    />
                    <span>Train models &amp; generate churn predictions</span>
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-purple-200 rounded-xl hover:bg-[#F5F3FF] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="px-5 py-2 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {isCreating ? 'Creating User...' : 'Create User Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#7655E8]" />
            <h2 className="text-base font-bold text-[#11142B]">Company Directory</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {users.length} member(s)
          </span>
        </div>

        {isLoading ? (
          <TableRowsSkeleton rows={4} cols={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
                  <th className="py-2.5 pr-4">User</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Permissions</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Last Login</th>
                  <th className="py-2.5 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50 text-xs">
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  const isPlatformOwnerRow = u.role === 'PLATFORM_OWNER';
                  return (
                    <tr key={u.id} className="hover:bg-[#F5F3FF]/60 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          {u.avatarDataUrl ? (
                            <img
                              src={u.avatarDataUrl}
                              alt={u.fullName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-full object-cover border border-purple-200 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7655E8] to-[#397BFF] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                              {getInitials(u.fullName)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-[#11142B] truncate">
                              {u.fullName}
                              {isSelf && (
                                <span className="ml-1.5 text-[11px] font-bold text-[#7655E8]">
                                  (You)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 truncate">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {isPlatformOwnerRow ? (
                          <span className="font-semibold text-[#7655E8]">PLATFORM OWNER</span>
                        ) : (
                          <select
                            aria-label={`Role for ${u.fullName}`}
                            value={u.role}
                            disabled={isSelf}
                            onChange={(e) =>
                              handlePatchUser(
                                u.id,
                                { role: e.target.value as UserRole },
                                `Updated ${u.fullName}'s role to ${formatRoleLabel(e.target.value as UserRole)}.`
                              )
                            }
                            className="rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-semibold text-[#11142B] disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:border-[#7655E8]"
                          >
                            <option value="FIRM_ADMIN">FIRM ADMIN</option>
                            <option value="ANALYST">ANALYST</option>
                          </select>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        {u.role === 'FIRM_ADMIN' || u.role === 'PLATFORM_OWNER' ? (
                          <span className="inline-flex items-center gap-1 text-[#7655E8] font-medium">
                            <Shield className="w-3.5 h-3.5" />
                            <span>Full Workspace Access</span>
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={u.permissions.canUploadAndAnalyse}
                                onChange={(e) =>
                                  handlePatchUser(
                                    u.id,
                                    {
                                      permissions: { canUploadAndAnalyse: e.target.checked },
                                    },
                                    `Updated dataset upload permission for ${u.fullName}.`
                                  )
                                }
                                className="rounded border-purple-300 accent-[#7655E8]"
                              />
                              <span>Upload &amp; Analyse</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={u.permissions.canGeneratePredictions}
                                onChange={(e) =>
                                  handlePatchUser(
                                    u.id,
                                    {
                                      permissions: { canGeneratePredictions: e.target.checked },
                                    },
                                    `Updated prediction permission for ${u.fullName}.`
                                  )
                                }
                                className="rounded border-purple-300 accent-[#7655E8]"
                              />
                              <span>Train &amp; Predict</span>
                            </label>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`font-semibold ${
                            u.isActive ? 'text-[#0E9F6E]' : 'text-[#E04F44]'
                          }`}
                        >
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-mono tabular-nums text-slate-500">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleDateString()
                          : 'Never signed in'}
                      </td>

                      <td className="py-3 pl-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(u);
                              setResetPasswordVal('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-purple-200 rounded-lg text-[#7655E8] hover:bg-[#F5F3FF] font-semibold cursor-pointer whitespace-nowrap"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Reset PW</span>
                          </button>

                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() =>
                                handlePatchUser(
                                  u.id,
                                  { isActive: !u.isActive },
                                  u.isActive
                                    ? `Deactivated ${u.fullName}'s account.`
                                    : `Reactivated ${u.fullName}'s account.`
                                )
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-lg font-semibold cursor-pointer whitespace-nowrap ${
                                u.isActive
                                  ? 'border-[#FF786B]/50 text-[#E04F44] hover:bg-[#FF786B]/10'
                                  : 'border-[#16C995]/50 text-[#0E9F6E] hover:bg-[#16C995]/10'
                              }`}
                            >
                              {u.isActive ? (
                                <>
                                  <UserX className="w-3 h-3" />
                                  <span>Deactivate</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="w-3 h-3" />
                                  <span>Activate</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admin Password Reset Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-[#11142B]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#11142B]">Reset Member Password</h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#11142B] hover:bg-[#F5F3FF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Set a new temporary password for <strong>{resetTarget.fullName}</strong> (
              <span className="font-mono">{resetTarget.email}</span>).
            </p>
            <form onSubmit={handleResetMemberPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  New Password (min 8 characters)
                </label>
                <input
                  type="password"
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  placeholder="Enter temporary password"
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 border border-purple-200 rounded-xl hover:bg-[#F5F3FF] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResettingPw}
                  className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7655E8] to-[#E84FA8] rounded-xl shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isResettingPw ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
