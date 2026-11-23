import React, { useEffect, useState } from 'react';
import { BookOpen, Building2, Database, ShieldCheck, User, Users } from 'lucide-react';
import {
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  PredictionPipelineStatus,
  UserAccount,
  WorkspaceUsageSummary,
} from '../types/churn';
import { AboutProjectView } from './AboutProjectView';
import { CompanySettingsView } from './CompanySettingsView';
import { DemoWorkspacePanel } from './DemoWorkspacePanel';
import { ManageUsersView } from './ManageUsersView';
import { MyProfileView } from './MyProfileView';
import { PlatformGovernanceView } from './PlatformGovernanceView';

export type SettingsSection = 'company' | 'demo' | 'users' | 'profile' | 'platform' | 'about';

interface SettingsViewProps {
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  usage: WorkspaceUsageSummary | null;
  initialSection?: SettingsSection;
  focusPasswordSection?: boolean;
  onUserUpdated: (user: UserAccount) => void;
  onCompanyUpdated: (
    company: CompanyWorkspaceInfo,
    nextDataset?: DatasetState | null,
    nextAnalytics?: AnalyticsSummary | null,
    nextUsage?: WorkspaceUsageSummary | null,
    nextActiveModel?: ModelEvaluationResult | null,
    nextModelHistory?: ModelEvaluationResult[],
    nextAutomationStatus?: PredictionPipelineStatus | null
  ) => void;
  onWorkspaceMutated: (data: Record<string, any>) => void;
  onUsersChanged: () => void | Promise<void>;
  onNavigateToData?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  company,
  dataset,
  usage,
  initialSection,
  focusPasswordSection = false,
  onUserUpdated,
  onCompanyUpdated,
  onWorkspaceMutated,
  onUsersChanged,
  onNavigateToData,
}) => {
  const isPlatformOwner = user.role === 'PLATFORM_OWNER';
  const isWorkspaceAdmin = user.role === 'FIRM_ADMIN' || isPlatformOwner;

  const defaultSection: SettingsSection =
    initialSection || (isWorkspaceAdmin ? 'company' : 'demo');
  const [section, setSection] = useState<SettingsSection>(defaultSection);

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection]);

  const tabs: {
    id: SettingsSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    ...(isWorkspaceAdmin
      ? [
          { id: 'company' as SettingsSection, label: 'Workspace & Churn Setup', icon: Building2 },
          { id: 'demo' as SettingsSection, label: 'Demo Workspace', icon: Database },
          { id: 'users' as SettingsSection, label: 'Team & Permissions', icon: Users },
        ]
      : [{ id: 'demo' as SettingsSection, label: 'Demo Workspace', icon: Database }]),
    { id: 'profile', label: 'My Profile & Password', icon: User },
    ...(isPlatformOwner
      ? [{ id: 'platform' as SettingsSection, label: 'Platform Governance', icon: ShieldCheck }]
      : []),
    { id: 'about', label: 'About ChurnSight', icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white border border-purple-100 rounded-2xl shadow-xs w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#11142B] text-white shadow-xs'
                  : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#35C5E8]' : 'text-[#7655E8]'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {section === 'company' && isWorkspaceAdmin && (
        <CompanySettingsView
          user={user}
          company={company}
          dataset={dataset}
          usage={usage}
          onCompanyUpdated={onCompanyUpdated}
          onWorkspaceMutated={onWorkspaceMutated}
          onNavigateToData={onNavigateToData}
        />
      )}

      {section === 'demo' && (
        <DemoWorkspacePanel
          company={company}
          dataset={dataset}
          onWorkspaceMutated={onWorkspaceMutated}
          onNavigateToData={onNavigateToData}
        />
      )}

      {section === 'users' && isWorkspaceAdmin && (
        <ManageUsersView
          currentUser={user}
          company={company}
          onUsersChanged={onUsersChanged}
        />
      )}

      {section === 'profile' && (
        <MyProfileView
          user={user}
          company={company}
          focusPasswordSection={focusPasswordSection}
          onUserUpdated={onUserUpdated}
        />
      )}

      {section === 'platform' && isPlatformOwner && (
        <PlatformGovernanceView
          currentUser={user}
          onOwnCompanyPlanChanged={() => Promise.resolve(onUsersChanged())}
        />
      )}

      {section === 'about' && <AboutProjectView />}
    </div>
  );
};
