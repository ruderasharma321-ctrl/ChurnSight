import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CheckSquare,
  ChevronDown,
  Cpu,
  Database,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AuthViews } from './components/AuthViews';
import { ChurnPredictionView } from './components/ChurnPredictionView';
import { CustomerDataView } from './components/CustomerDataView';
import { CustomerIntelligenceView } from './components/CustomerIntelligenceView';
import { DashboardView } from './components/DashboardView';
import { DataAnalysisView } from './components/DataAnalysisView';
import { ModelEvaluationView } from './components/ModelEvaluationView';
import { DashboardLoadingSkeleton } from './components/PremiumUI';
import { ReportsView } from './components/ReportsView';
import { SettingsSection, SettingsView } from './components/SettingsView';
import { TechnicalWorkbenchView } from './components/TechnicalWorkbenchView';
import {
  AnalyticsSummary,
  AuthSessionPayload,
  BatchScoreResult,
  ChurnDefinition,
  ColumnMapping,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
  StagedDatasetImport,
  TrainModelRequest,
  UserAccount,
  WorkspaceUsageSummary,
} from './types/churn';
import { apiFetch, setClientSessionToken } from './utils/apiClient';
import { formatRoleLabel, getInitials } from './utils/imageHelpers';
import { getIndustryTemplate } from './utils/industryConfig';

const CUSTOMER_NAV_ITEMS: {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'intelligence', label: 'Customer Intelligence', icon: Cpu },
  { id: 'data', label: 'Data Management', icon: Database },
  { id: 'analytics', label: 'Business Analytics', icon: BarChart3 },
  { id: 'predictions', label: 'Churn Predictions', icon: BrainCircuit },
  { id: 'performance', label: 'Model Performance', icon: CheckSquare },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [auth, setAuth] = useState<AuthSessionPayload | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('company');
  const [focusPasswordSection, setFocusPasswordSection] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const [dataset, setDataset] = useState<DatasetState | null>(null);
  const [stagedImport, setStagedImport] = useState<StagedDatasetImport | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [activeModel, setActiveModel] = useState<ModelEvaluationResult | null>(null);
  const [modelHistory, setModelHistory] = useState<ModelEvaluationResult[]>([]);
  const [automationStatus, setAutomationStatus] = useState<PredictionPipelineStatus | null>(null);
  const [batchScores, setBatchScores] = useState<BatchScoreResult[]>([]);
  const [usage, setUsage] = useState<WorkspaceUsageSummary | null>(null);

  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isDatasetLoading, setIsDatasetLoading] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const clearWorkspaceState = useCallback(() => {
    setDataset(null);
    setStagedImport(null);
    setAnalytics(null);
    setActiveModel(null);
    setModelHistory([]);
    setAutomationStatus(null);
    setBatchScores([]);
    setUsage(null);
    setGlobalError(null);
    setProfileMenuOpen(false);
    setMobileNavOpen(false);
    setActiveTab('overview');
  }, []);

  const fetchCompanyWorkspaceState = useCallback(async () => {
    setIsWorkspaceLoading(true);
    try {
      const res = await apiFetch('/api/state');
      if (res.status === 401) {
        setClientSessionToken(null);
        setAuth(null);
        clearWorkspaceState();
        setSessionNotice('Your session has expired. Please sign in again.');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.company) {
          setAuth((prev) => (prev ? { ...prev, company: data.company } : prev));
        }
        setDataset(data.dataset || null);
        setStagedImport(null);
        setAnalytics(data.analytics || null);
        setActiveModel(data.activeModel || null);
        setModelHistory(data.modelHistory || []);
        setAutomationStatus(data.automationStatus || null);
        setBatchScores(data.batchScores || []);
        setUsage(data.usage || null);
      }
    } catch {
      // Ignore transient load error
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, [clearWorkspaceState]);

  const verifyAuthSession = useCallback(
    async (isBackgroundCheck = false) => {
      if (!isBackgroundCheck) setIsCheckingAuth(true);
      try {
        const res = await apiFetch('/api/auth/me');
        if (!res.ok) {
          setClientSessionToken(null);
          setAuth(null);
          clearWorkspaceState();
          return;
        }
        const data = (await res.json()) as AuthSessionPayload;
        setAuth(data);
        if (!isBackgroundCheck) {
          await fetchCompanyWorkspaceState();
        }
      } catch {
        setAuth(null);
        clearWorkspaceState();
      } finally {
        if (!isBackgroundCheck) setIsCheckingAuth(false);
      }
    },
    [clearWorkspaceState, fetchCompanyWorkspaceState]
  );

  useEffect(() => {
    verifyAuthSession(false);
  }, [verifyAuthSession]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        verifyAuthSession(true);
      }
    };
    const handlePopState = () => {
      verifyAuthSession(true);
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [verifyAuthSession]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [profileMenuOpen]);

  const navigateTo = (
    tab: NavTab,
    options?: { settingsSection?: SettingsSection; focusPassword?: boolean }
  ) => {
    if (tab === 'platform') {
      setActiveTab('settings');
      setSettingsSection('platform');
    } else {
      setActiveTab(tab);
      if (options?.settingsSection) {
        setSettingsSection(options.settingsSection);
      }
    }
    setFocusPasswordSection(Boolean(options?.focusPassword));
    setMobileNavOpen(false);
    setProfileMenuOpen(false);
    if (auth && window.location.hash !== `#${tab}`) {
      window.history.pushState({ tab }, '', `#${tab}`);
    }
  };

  const handleAuthenticated = async (payload: AuthSessionPayload) => {
    setSessionNotice(null);
    if (payload.sessionToken) {
      setClientSessionToken(payload.sessionToken);
    }
    setAuth(payload);
    setActiveTab('overview');
    window.history.replaceState({ tab: 'overview' }, '', '#overview');
    await fetchCompanyWorkspaceState();
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local cleanup regardless
    }
    setClientSessionToken(null);
    setAuth(null);
    clearWorkspaceState();
    setSessionNotice('You have signed out securely.');
    window.history.replaceState(null, '', '#login');
  };

  const handleAuthErrorIf401 = (status: number): boolean => {
    if (status === 401) {
      setClientSessionToken(null);
      setAuth(null);
      clearWorkspaceState();
      setSessionNotice('Your session expired or was invalidated. Please sign in again.');
      return true;
    }
    return false;
  };

  const handleLoadSample = async () => {
    setIsDatasetLoading(true);
    setIsPipelineRunning(true);
    setGlobalError(null);
    try {
      const res = await apiFetch('/api/dataset/load-sample', { method: 'POST' });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load sample dataset.');
      }
      setStagedImport(null);
      setDataset(data.dataset);
      setAnalytics(data.analytics);
      setUsage(data.usage || null);
      setActiveModel(data.activeModel || null);
      setModelHistory(data.modelHistory || []);
      setAutomationStatus(data.automationStatus || null);
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load sample dataset.');
    } finally {
      setIsDatasetLoading(false);
      setIsPipelineRunning(false);
    }
  };

  const handleStageUpload = async (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string }
  ) => {
    setIsDatasetLoading(true);
    setGlobalError(null);
    try {
      const res = await apiFetch('/api/dataset/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, ...payload }),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse uploaded spreadsheet.');
      }
      setStagedImport(data.stagedImport);
    } finally {
      setIsDatasetLoading(false);
    }
  };

  const handleCommitStaged = async (req: {
    stagedId: string;
    mapping: ColumnMapping;
    churnDefinition: ChurnDefinition;
  }) => {
    setIsDatasetLoading(true);
    setIsPipelineRunning(true);
    setGlobalError(null);
    try {
      const res = await apiFetch('/api/dataset/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to commit dataset.');
      }
      if (data.company) {
        setAuth((prev) => (prev ? { ...prev, company: data.company } : prev));
      }
      setStagedImport(null);
      setDataset(data.dataset);
      setAnalytics(data.analytics);
      setUsage(data.usage || null);
      setActiveModel(data.activeModel || null);
      setModelHistory(data.modelHistory || []);
      setAutomationStatus(data.automationStatus || null);
    } finally {
      setIsDatasetLoading(false);
      setIsPipelineRunning(false);
    }
  };

  const handleUpdateMapping = async (mapping: Partial<ColumnMapping>) => {
    setGlobalError(null);
    setIsPipelineRunning(true);
    try {
      const res = await apiFetch('/api/dataset/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapping),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        setGlobalError(data.error || 'Failed to update column mapping.');
        return;
      }
      setDataset(data.dataset);
      setAnalytics(data.analytics);
      if (data.usage) setUsage(data.usage);
      setActiveModel(data.activeModel || null);
      setModelHistory(data.modelHistory || []);
      setAutomationStatus(data.automationStatus || null);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const handleSaveChurnDefinition = async (def: ChurnDefinition) => {
    setGlobalError(null);
    setIsPipelineRunning(true);
    try {
      const res = await apiFetch('/api/company/churn-definition', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...def, confirmedByUser: true }),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to confirm churn definition.');
      }
      if (data.company) {
        setAuth((prev) => (prev ? { ...prev, company: data.company } : prev));
      }
      if (data.dataset !== undefined) setDataset(data.dataset);
      if (data.analytics !== undefined) setAnalytics(data.analytics);
      if (data.activeModel !== undefined) setActiveModel(data.activeModel);
      if (data.modelHistory !== undefined) setModelHistory(data.modelHistory);
      if (data.automationStatus !== undefined) setAutomationStatus(data.automationStatus);
      if (data.usage) setUsage(data.usage);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const handleRecordOutcome = async (
    updates: { customerId: string; outcome: 'Churned' | 'Retained' }[]
  ) => {
    setGlobalError(null);
    setIsPipelineRunning(true);
    try {
      const res = await apiFetch('/api/dataset/record-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record observed churn outcome.');
      }
      if (data.dataset) setDataset(data.dataset);
      if (data.analytics) setAnalytics(data.analytics);
      setActiveModel(data.activeModel || null);
      setModelHistory(data.modelHistory || []);
      setAutomationStatus(data.automationStatus || null);
      if (data.usage) setUsage(data.usage);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const handleAutoBuild = async () => {
    setIsPipelineRunning(true);
    setGlobalError(null);
    try {
      const res = await apiFetch('/api/model/auto-build', { method: 'POST' });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Managed prediction setup failed.');
      }
      setActiveModel(data.activeModel || null);
      setModelHistory(data.modelHistory || []);
      setAutomationStatus(data.automationStatus || null);
      if (data.usage) setUsage(data.usage);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const handleTrainModel = async (req: TrainModelRequest) => {
    setIsTraining(true);
    setGlobalError(null);
    try {
      const res = await apiFetch('/api/model/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (handleAuthErrorIf401(res.status)) return;
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Model build failed.');
      }
      setActiveModel(data.activeModel);
      setModelHistory(data.modelHistory || []);
      if (data.automationStatus !== undefined) {
        setAutomationStatus(data.automationStatus);
      }
      if (data.usage) setUsage(data.usage);
    } finally {
      setIsTraining(false);
    }
  };

  const handleBatchScore = async (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string }
  ) => {
    setGlobalError(null);
    const res = await apiFetch('/api/model/batch-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, ...payload }),
    });
    if (handleAuthErrorIf401(res.status)) return;
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Batch prediction failed.');
    }
    setBatchScores(data.batchScores || []);
    if (data.usage) setUsage(data.usage);
  };

  const handleUserUpdated = (updatedUser: UserAccount) => {
    setAuth((prev) => (prev ? { ...prev, user: updatedUser } : prev));
  };

  const handleCompanyUpdated = (
    updatedCompany: CompanyWorkspaceInfo,
    nextDataset?: DatasetState | null,
    nextAnalytics?: AnalyticsSummary | null,
    nextUsage?: WorkspaceUsageSummary | null,
    nextActiveModel?: ModelEvaluationResult | null,
    nextModelHistory?: ModelEvaluationResult[],
    nextAutomationStatus?: PredictionPipelineStatus | null
  ) => {
    setAuth((prev) => (prev ? { ...prev, company: updatedCompany } : prev));
    if (nextDataset !== undefined) setDataset(nextDataset);
    if (nextAnalytics !== undefined) setAnalytics(nextAnalytics);
    if (nextUsage !== undefined) setUsage(nextUsage);
    if (nextActiveModel !== undefined) setActiveModel(nextActiveModel);
    if (nextModelHistory !== undefined) setModelHistory(nextModelHistory);
    if (nextAutomationStatus !== undefined) setAutomationStatus(nextAutomationStatus);
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[#F5F3FF] p-8 max-w-6xl mx-auto">
        <DashboardLoadingSkeleton />
      </div>
    );
  }

  if (!auth) {
    return <AuthViews onAuthenticated={handleAuthenticated} sessionNotice={sessionNotice} />;
  }

  const { user, company } = auth;
  const isPlatformOwner = user.role === 'PLATFORM_OWNER';
  const isWorkspaceAdmin = user.role === 'FIRM_ADMIN' || isPlatformOwner;
  const canUploadAndAnalyse = isWorkspaceAdmin || user.permissions.canUploadAndAnalyse;
  const canGeneratePredictions = isWorkspaceAdmin || user.permissions.canGeneratePredictions;
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);

  const activeNavLabel =
    activeTab === 'technical'
      ? 'Technical ML Studio'
      : CUSTOMER_NAV_ITEMS.find((item) => item.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen flex bg-[#F5F3FF] text-[#11142B]">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-[#11142B]/60 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#11142B] text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 shrink-0 shadow-2xl shadow-[#11142B]/30 border-r border-white/[0.07] ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto relative">
          <div className="absolute -top-12 -left-10 w-44 h-44 rounded-full bg-[#7655E8]/20 blur-3xl pointer-events-none" />

          <div className="relative h-16 px-5 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#7655E8] via-[#B84DE0] to-[#E84FA8] flex items-center justify-center shadow-md shadow-[#7655E8]/40 border border-white/20 shrink-0">
                <BrainCircuit className="w-4 h-4 text-white" />
              </div>
              <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap">
                ChurnSight
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden text-indigo-200/70 hover:text-white p-1 cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Primary Customer-Facing 8-Item Navigation */}
          <nav className="relative p-4 space-y-1.5" aria-label="Customer Navigation">
            {CUSTOMER_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    navigateTo(item.id, {
                      settingsSection:
                        item.id === 'settings'
                          ? isWorkspaceAdmin
                            ? 'company'
                            : 'profile'
                          : undefined,
                    })
                  }
                  className={`group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35C5E8] ${
                    isActive
                      ? 'text-white'
                      : 'text-indigo-100/75 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebarActivePill"
                      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#7655E8] via-[#9D50E4] to-[#B84DE0] shadow-lg shadow-[#7655E8]/35 border border-white/15"
                    />
                  )}
                  {isActive && (
                    <motion.span
                      layoutId="sidebarActiveGlowBar"
                      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                      className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#35C5E8] shadow-[0_0_10px_#35C5E8]"
                    />
                  )}
                  <Icon
                    className={`relative z-10 w-4 h-4 shrink-0 transition-transform duration-150 ${
                      isActive
                        ? 'text-white scale-105'
                        : 'text-indigo-200/75 group-hover:text-[#35C5E8] group-hover:scale-105'
                    }`}
                  />
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Separated Advanced Technical Area */}
          <div className="relative px-4 pt-3 pb-4 border-t border-white/10 space-y-1.5">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-200/55">
              Advanced Technical
            </div>
            <button
              type="button"
              onClick={() => navigateTo('technical')}
              className={`group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35C5E8] ${
                activeTab === 'technical'
                  ? 'text-white'
                  : 'text-indigo-100/75 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              {activeTab === 'technical' && (
                <motion.div
                  layoutId="sidebarActivePill"
                  transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#7655E8] via-[#9D50E4] to-[#B84DE0] shadow-lg shadow-[#7655E8]/35 border border-white/15"
                />
              )}
              {activeTab === 'technical' && (
                <motion.span
                  layoutId="sidebarActiveGlowBar"
                  transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#35C5E8] shadow-[0_0_10px_#35C5E8]"
                />
              )}
              <SlidersHorizontal
                className={`relative z-10 w-4 h-4 shrink-0 transition-transform duration-150 ${
                  activeTab === 'technical'
                    ? 'text-white scale-105'
                    : 'text-indigo-200/75 group-hover:text-[#35C5E8] group-hover:scale-105'
                }`}
              />
              <span className="relative z-10">Technical ML Studio</span>
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-white/10 text-xs text-indigo-200/70 space-y-1">
          <div className="font-semibold text-white/90 leading-snug">
            Predict Churn. Discover Insights. Retain Customers.
          </div>
          <div>Multi-Industry ChurnSight SaaS</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur-md border-b border-purple-100/90 px-4 sm:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#11142B]/70 hover:text-[#11142B] cursor-pointer shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 min-w-0">
              {company.logoDataUrl ? (
                <img
                  src={company.logoDataUrl}
                  alt={company.name}
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-xl object-cover border border-purple-200 bg-white shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] text-white flex items-center justify-center text-xs font-bold shadow-xs shrink-0">
                  {getInitials(company.name)}
                </div>
              )}

              <div className="min-w-0">
                <div className="text-sm font-bold text-[#11142B] truncate leading-tight">
                  {company.name}
                </div>
                <div className="text-[11px] text-slate-500 truncate leading-tight flex items-center gap-1.5">
                  <span>{tmpl.shortLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>{company.country}</span>
                  {company.registrationNumber && (
                    <>
                      <span className="hidden sm:inline" aria-hidden="true">
                        ·
                      </span>
                      <span className="hidden sm:inline font-mono">
                        Reg: {company.registrationNumber}
                      </span>
                    </>
                  )}
                  <span className="hidden md:inline" aria-hidden="true">
                    ·
                  </span>
                  <span className="hidden md:inline font-semibold text-[#7655E8]">
                    {activeNavLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Authenticated User Profile Dropdown */}
          <div className="relative shrink-0" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-xl border border-purple-100 hover:border-purple-200 hover:bg-[#F5F3FF]/80 transition-colors cursor-pointer"
            >
              {user.avatarDataUrl ? (
                <img
                  src={user.avatarDataUrl}
                  alt={user.fullName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-purple-200 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {getInitials(user.fullName)}
                </div>
              )}

              <div className="hidden sm:block text-left leading-tight max-w-[160px]">
                <div className="text-xs font-bold text-[#11142B] truncate">{user.fullName}</div>
                <div className="text-[10px] font-bold text-[#7655E8] tracking-wide">
                  {formatRoleLabel(user.role)}
                </div>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform duration-150 shrink-0 ${
                  profileMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {profileMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-60 bg-white border border-purple-100 rounded-2xl shadow-xl shadow-purple-950/15 py-2 z-50"
              >
                <div className="px-4 py-2.5 border-b border-purple-100">
                  <div className="text-xs font-bold text-[#11142B] truncate">{user.fullName}</div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">{user.email}</div>
                  <div className="text-[10px] font-bold text-[#7655E8] mt-0.5">
                    {formatRoleLabel(user.role)}
                  </div>
                </div>

                <div className="py-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateTo('settings', { settingsSection: 'profile', focusPassword: false })
                    }
                    className="w-full px-4 py-2 text-left text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] hover:text-[#7655E8] flex items-center gap-2.5 cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-[#7655E8]" />
                    <span>My Profile</span>
                  </button>

                  {isWorkspaceAdmin && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => navigateTo('settings', { settingsSection: 'company' })}
                        className="w-full px-4 py-2 text-left text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] hover:text-[#7655E8] flex items-center gap-2.5 cursor-pointer"
                      >
                        <Building2 className="w-3.5 h-3.5 text-[#397BFF]" />
                        <span>Workspace Settings</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => navigateTo('settings', { settingsSection: 'users' })}
                        className="w-full px-4 py-2 text-left text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] hover:text-[#7655E8] flex items-center gap-2.5 cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5 text-[#B84DE0]" />
                        <span>Team &amp; Permissions</span>
                      </button>
                    </>
                  )}

                  {isPlatformOwner && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => navigateTo('settings', { settingsSection: 'platform' })}
                      className="w-full px-4 py-2 text-left text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] hover:text-[#7655E8] flex items-center gap-2.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#0E9F6E]" />
                      <span>Platform Governance</span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateTo('settings', { settingsSection: 'profile', focusPassword: true })
                    }
                    className="w-full px-4 py-2 text-left text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] hover:text-[#7655E8] flex items-center gap-2.5 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#7655E8]" />
                    <span>Change Password</span>
                  </button>
                </div>

                <div className="pt-1 border-t border-purple-100">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-xs font-semibold text-[#E04F44] hover:bg-[#FF786B]/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {globalError && (
            <div className="mb-6 bg-[#FF786B]/10 border border-[#FF786B]/40 rounded-2xl p-4 text-sm text-[#9A2E25] flex items-center justify-between">
              <span>{globalError}</span>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="text-xs font-semibold underline ml-4 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {isWorkspaceLoading ? (
            <DashboardLoadingSkeleton />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeTab === 'overview' && (
                  <DashboardView
                    company={company}
                    dataset={dataset}
                    analytics={analytics}
                    activeModel={activeModel}
                    automationStatus={automationStatus}
                    isLoading={isDatasetLoading}
                    isPipelineRunning={isPipelineRunning}
                    canUploadAndAnalyse={canUploadAndAnalyse}
                    canGeneratePredictions={canGeneratePredictions}
                    onLoadSample={handleLoadSample}
                    onAutoBuild={handleAutoBuild}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'intelligence' && (
                  <CustomerIntelligenceView
                    company={company}
                    dataset={dataset}
                    analytics={analytics}
                    activeModel={activeModel}
                    automationStatus={automationStatus}
                    isPipelineRunning={isPipelineRunning}
                    canGeneratePredictions={canGeneratePredictions}
                    onAutoBuild={handleAutoBuild}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'data' && (
                  <CustomerDataView
                    company={company}
                    dataset={dataset}
                    analytics={analytics}
                    stagedImport={stagedImport}
                    automationStatus={automationStatus}
                    isPipelineRunning={isPipelineRunning}
                    isLoading={isDatasetLoading}
                    canUploadAndAnalyse={canUploadAndAnalyse}
                    canGeneratePredictions={canGeneratePredictions}
                    onLoadSample={handleLoadSample}
                    onStageUpload={handleStageUpload}
                    onCommitStaged={handleCommitStaged}
                    onCancelStaged={() => setStagedImport(null)}
                    onUpdateMapping={handleUpdateMapping}
                    onSaveChurnDefinition={handleSaveChurnDefinition}
                    onRecordOutcome={handleRecordOutcome}
                    onAutoBuild={handleAutoBuild}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'analytics' && (
                  <DataAnalysisView
                    company={company}
                    dataset={dataset}
                    analytics={analytics}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'predictions' && (
                  <ChurnPredictionView
                    company={company}
                    dataset={dataset}
                    activeModel={activeModel}
                    automationStatus={automationStatus}
                    batchScores={batchScores}
                    isBuilding={isPipelineRunning}
                    canGeneratePredictions={canGeneratePredictions}
                    onAutoBuild={handleAutoBuild}
                    onBatchScore={handleBatchScore}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'performance' && (
                  <ModelEvaluationView
                    company={company}
                    activeModel={activeModel}
                    automationStatus={automationStatus}
                    isBuilding={isPipelineRunning}
                    canGeneratePredictions={canGeneratePredictions}
                    onAutoBuild={handleAutoBuild}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'reports' && (
                  <ReportsView
                    company={company}
                    dataset={dataset}
                    analytics={analytics}
                    activeModel={activeModel}
                    batchScores={batchScores}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}

                {activeTab === 'settings' && (
                  <SettingsView
                    user={user}
                    company={company}
                    usage={usage}
                    initialSection={settingsSection}
                    focusPasswordSection={focusPasswordSection}
                    onUserUpdated={handleUserUpdated}
                    onCompanyUpdated={handleCompanyUpdated}
                    onUsersChanged={fetchCompanyWorkspaceState}
                  />
                )}

                {activeTab === 'technical' && (
                  <TechnicalWorkbenchView
                    company={company}
                    dataset={dataset}
                    activeModel={activeModel}
                    modelHistory={modelHistory}
                    automationStatus={automationStatus}
                    isTraining={isTraining}
                    canGeneratePredictions={canGeneratePredictions}
                    onTrainModel={handleTrainModel}
                    onNavigate={(tab) => navigateTo(tab)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
    </div>
  );
}
