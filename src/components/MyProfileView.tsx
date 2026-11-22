import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { CompanyWorkspaceInfo, UserAccount } from '../types/churn';
import { formatRoleLabel, getInitials, readAndCompressImageFile } from '../utils/imageHelpers';
import { apiFetch } from '../utils/apiClient';

interface MyProfileViewProps {
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  focusPasswordSection?: boolean;
  onUserUpdated: (user: UserAccount) => void;
}

export const MyProfileView: React.FC<MyProfileViewProps> = ({
  user,
  company,
  focusPasswordSection = false,
  onUserUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const passwordSectionRef = useRef<HTMLDivElement | null>(null);

  const [fullName, setFullName] = useState(user.fullName);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(user.avatarDataUrl);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user.fullName);
    setAvatarDataUrl(user.avatarDataUrl);
  }, [user]);

  useEffect(() => {
    if (focusPasswordSection && passwordSectionRef.current) {
      passwordSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusPasswordSection]);

  const handleAvatarUpload = async (file: File) => {
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const dataUrl = await readAndCompressImageFile(file, 280);
      setAvatarDataUrl(dataUrl);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Unable to process image.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (fullName.trim().length < 2) {
      setProfileError('Full name must be at least 2 characters long.');
      return;
    }

    setProfileSaving(true);
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          avatarDataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileError(data.error || 'Failed to update profile.');
        return;
      }
      onUserUpdated(data.user);
      setProfileSuccess('Your profile details have been saved.');
    } catch {
      setProfileError('Network error while saving profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword) {
      setPwError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError('New password and confirmation password do not match.');
      return;
    }

    setPwSaving(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || 'Failed to change password.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPwSuccess(data.message || 'Password updated successfully.');
    } catch {
      setPwError('Network error while changing password.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">My Profile</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Manage your personal account details, profile avatar, and login password
        </p>
      </div>

      {/* Account Identity & Profile Edit */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 pb-5 border-b border-purple-100">
          <div className="relative shrink-0">
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt={user.fullName}
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-2xl object-cover border border-purple-200 shadow-sm"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center text-2xl font-bold shadow-md shadow-[#7655E8]/25">
                {getInitials(user.fullName)}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <h2 className="text-lg font-bold text-[#11142B] truncate">{user.fullName}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-bold text-[#7655E8]">{formatRoleLabel(user.role)}</span>
              <span aria-hidden="true">·</span>
              <span>{company.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{user.email}</span>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#F5F3FF] hover:bg-purple-100 text-[#7655E8] border border-purple-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Upload Profile Photo</span>
              </button>
              {avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarDataUrl(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-[#E04F44] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Photo</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {profileError && (
          <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
            <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
            <span>{profileError}</span>
          </div>
        )}

        {profileSuccess && (
          <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#065F46]">
            <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
            <span>{profileSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="profile-fullname"
                className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
              >
                Full Name
              </label>
              <input
                id="profile-fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Email Address (Read-only)
              </label>
              <input
                type="email"
                readOnly
                value={user.email}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-purple-100 bg-slate-50 text-slate-500 font-mono cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Assigned Role
              </label>
              <input
                type="text"
                readOnly
                value={formatRoleLabel(user.role)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-purple-100 bg-slate-50 text-[#7655E8] font-semibold cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Company Workspace
              </label>
              <input
                type="text"
                readOnly
                value={company.name}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-purple-100 bg-slate-50 text-slate-700 font-medium cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={profileSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-sm font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <UserCheck className="w-4 h-4" />
              <span>{profileSaving ? 'Saving Profile...' : 'Save Profile Changes'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Change Password Card */}
      <div
        ref={passwordSectionRef}
        className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-5"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] text-white flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#11142B]">Change Password</h2>
            <p className="text-xs text-slate-500">Update your account password securely</p>
          </div>
        </div>

        {pwError && (
          <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
            <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
            <span>{pwError}</span>
          </div>
        )}

        {pwSuccess && (
          <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#065F46]">
            <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
            <span>{pwSuccess}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="pw-current"
                className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
              >
                Current Password
              </label>
              <div className="relative">
                <input
                  id="pw-current"
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full pl-3.5 pr-9 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                  aria-label="Toggle current password visibility"
                >
                  {showCurrentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="pw-new"
                className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
              >
                New Password (min 8 chars)
              </label>
              <div className="relative">
                <input
                  id="pw-new"
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-3.5 pr-9 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                  aria-label="Toggle new password visibility"
                >
                  {showNewPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="pw-confirm"
                className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="pw-confirm"
                  type={showConfirmPw ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full pl-3.5 pr-9 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                  aria-label="Toggle confirm password visibility"
                >
                  {showConfirmPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pwSaving}
              className="px-5 py-2.5 bg-gradient-to-r from-[#397BFF] to-[#7655E8] hover:opacity-95 text-white text-sm font-semibold rounded-xl shadow-sm shadow-[#397BFF]/25 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {pwSaving ? 'Updating Password...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
