import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  History,
  Info,
  Lock,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AnalyticsSummary,
  AuditLogEntry,
  BusinessModel,
  BusinessType,
  ChurnCalculationMethod,
  ChurnDefinition,
  ChurnDenominatorType,
  ChurnTriggerType,
  CompanyWorkspaceInfo,
  CustomerRelationshipType,
  DataPrivacySettings,
  DatasetState,
  IndustryKey,
  ModelEvaluationResult,
  PredictionPipelineStatus,
  ReportingPeriod,
  SubscriptionPlanTier,
  UserAccount,
  WorkspaceUsageSummary,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { DemoWorkspacePanel } from './DemoWorkspacePanel';
import { getInitials, readAndCompressImageFile } from '../utils/imageHelpers';
import {
  BUSINESS_MODEL_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  CALCULATION_METHOD_OPTIONS,
  CHURN_TRIGGER_OPTIONS,
  CUSTOMER_RELATIONSHIP_OPTIONS,
  DENOMINATOR_OPTIONS,
  INDUSTRY_OPTIONS,
  REPORTING_PERIOD_OPTIONS,
  buildDefaultChurnDefinition,
  buildDefaultPrivacySettings,
  formatChurnCalculationExplanation,
  getDefaultRelationshipForIndustry,
  getIndustryTemplate,
} from '../utils/industryConfig';
import {
  SUBSCRIPTION_PLAN_LIST,
  formatBytes,
  getSubscriptionPlanSpec,
} from '../utils/subscriptionPlans';

interface CompanySettingsViewProps {
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  usage: WorkspaceUsageSummary | null;
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
  onNavigateToData?: () => void;
}

export const CompanySettingsView: React.FC<CompanySettingsViewProps> = ({
  user,
  company,
  dataset,
  usage,
  onCompanyUpdated,
  onWorkspaceMutated,
  onNavigateToData,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isWorkspaceAdmin = user.role === 'FIRM_ADMIN' || user.role === 'PLATFORM_OWNER';

  const [name, setName] = useState(company.name);
  const [email, setEmail] = useState(company.email);
  const [registrationNumber, setRegistrationNumber] = useState(company.registrationNumber || '');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(company.logoDataUrl);
  const [industry, setIndustry] = useState<IndustryKey>(company.industry || 'telecommunications');
  const [customIndustryName, setCustomIndustryName] = useState(company.customIndustryName || '');
  const [country, setCountry] = useState(company.country || 'Malaysia');
  const [businessType, setBusinessType] = useState<BusinessType>(company.businessType || 'B2C');
  const [businessModel, setBusinessModel] = useState<BusinessModel>(
    company.businessModel || 'Subscription / Recurring'
  );
  const [customerRelationshipType, setCustomerRelationshipType] =
    useState<CustomerRelationshipType>(
      company.customerRelationshipType || getDefaultRelationshipForIndustry(company.industry)
    );
  const [privacySettings, setPrivacySettings] = useState<DataPrivacySettings>(
    company.privacySettings || buildDefaultPrivacySettings()
  );

  const [churnDef, setChurnDef] = useState<ChurnDefinition>(
    company.churnDefinition || buildDefaultChurnDefinition(company.industry)
  );

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingDef, setIsSavingDef] = useState(false);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const [isChangingPlan, setIsChangingPlan] = useState<SubscriptionPlanTier | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);

  useEffect(() => {
    setName(company.name);
    setEmail(company.email);
    setRegistrationNumber(company.registrationNumber || '');
    setLogoDataUrl(company.logoDataUrl);
    setIndustry(company.industry || 'telecommunications');
    setCustomIndustryName(company.customIndustryName || '');
    setCountry(company.country || 'Malaysia');
    setBusinessType(company.businessType || 'B2C');
    setBusinessModel(company.businessModel || 'Subscription / Recurring');
    setCustomerRelationshipType(
      company.customerRelationshipType || getDefaultRelationshipForIndustry(company.industry)
    );
    setPrivacySettings(company.privacySettings || buildDefaultPrivacySettings());
    setChurnDef(company.churnDefinition || buildDefaultChurnDefinition(company.industry));
  }, [company]);

  useEffect(() => {
    if (!isWorkspaceAdmin) return;
    if (!plan.allowAuditLogs && user.role !== 'PLATFORM_OWNER') {
      setAuditLogs([]);
      return;
    }
    let cancelled = false;
    const loadLogs = async () => {
      setLoadingLogs(true);
      try {
        const res = await apiFetch('/api/audit-logs');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAuditLogs(data.auditLogs || []);
      } catch {
        // Ignore transient audit log error
      } finally {
        if (!cancelled) setLoadingLogs(false);
      }
    };
    loadLogs();
    return () => {
      cancelled = true;
    };
  }, [isWorkspaceAdmin, plan.allowAuditLogs, user.role, company]);

  if (!isWorkspaceAdmin) {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-10 text-center max-w-xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-[#FF786B]/15 text-[#E04F44] flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#11142B]">Administrator Access Required</h2>
        <p className="text-sm text-slate-600">
          Only a Firm Administrator can modify company workspace settings, industry profile, or
          churn definitions.
        </p>
      </div>
    );
  }

  const handleLogoUpload = async (file: File) => {
    setError(null);
    setSuccess(null);
    try {
      const dataUrl = await readAndCompressImageFile(file, 256);
      setLogoDataUrl(dataUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to process company logo.');
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (name.trim().length < 2) {
      setError('Company name must be at least 2 characters long.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid company email address.');
      return;
    }
    if (industry === 'other' && customIndustryName.trim().length < 2) {
      setError('Please enter a custom industry label.');
      return;
    }

    setIsSavingProfile(true);
    try {
      const res = await apiFetch('/api/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          registrationNumber: registrationNumber.trim() || null,
          logoDataUrl,
          industry,
          customIndustryName: industry === 'other' ? customIndustryName.trim() : null,
          country: country.trim() || 'Malaysia',
          businessType,
          businessModel,
          customerRelationshipType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update company workspace.');
        return;
      }
      onCompanyUpdated(
        data.company,
        data.dataset,
        data.analytics,
        data.usage,
        data.activeModel,
        data.modelHistory,
        data.automationStatus
      );
      setSuccess('Company workspace identity and industry configuration updated.');
    } catch {
      setError('Network error while saving company workspace.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChurnDefinitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSavingDef(true);
    try {
      const res = await apiFetch('/api/company/churn-definition', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...churnDef,
          confirmedByUser: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update churn definition.');
        return;
      }
      onCompanyUpdated(
        data.company,
        data.dataset,
        data.analytics,
        data.usage,
        data.activeModel,
        data.modelHistory,
        data.automationStatus
      );
      setSuccess(
        'Company churn definition saved, analytics updated, and managed prediction setup refreshed.'
      );
    } catch {
      setError('Network error while saving churn definition.');
    } finally {
      setIsSavingDef(false);
    }
  };

  const handlePrivacySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSavingPrivacy(true);
    try {
      const res = await apiFetch('/api/company/privacy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowSharedModelContribution: privacySettings.allowSharedModelContribution,
          optInCrossCompanyBaseline: privacySettings.optInCrossCompanyBaseline,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update privacy settings.');
        return;
      }
      onCompanyUpdated(data.company);
      setSuccess('Workspace data isolation and cross-company model consent preferences updated.');
    } catch {
      setError('Network error while saving privacy preferences.');
    } finally {
      setIsSavingPrivacy(false);
    }
  };

  const handlePlanSwitch = async (nextTier: SubscriptionPlanTier) => {
    if (nextTier === company.subscriptionPlan) return;
    setError(null);
    setSuccess(null);
    setIsChangingPlan(nextTier);
    try {
      const res = await apiFetch('/api/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionPlan: nextTier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to switch subscription plan.');
        return;
      }
      onCompanyUpdated(
        data.company,
        data.dataset,
        data.analytics,
        data.usage,
        data.activeModel,
        data.modelHistory,
        data.automationStatus
      );
      setSuccess(
        `Workspace tier switched to ${getSubscriptionPlanSpec(nextTier).name} (Preview Mode).`
      );
    } catch {
      setError('Network error while switching plan tier.');
    } finally {
      setIsChangingPlan(null);
    }
  };

  const pct = (val: number, max: number) =>
    max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">
          Workspace &amp; Churn Settings
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Industry profile, churn formula, privacy controls, and quotas for {company.name}
        </p>
      </div>

      {error && (
        <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
          <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#065F46]">
          <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* 1. COMPANY PROFILE & INDUSTRY CONFIGURATION */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 pb-5 border-b border-purple-100">
          {logoDataUrl ? (
            <img
              src={logoDataUrl}
              alt={company.name}
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-2xl object-cover border border-purple-200 bg-white shadow-sm shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] text-white flex items-center justify-center text-xl font-bold shadow-md shadow-[#397BFF]/25 shrink-0">
              {getInitials(company.name)}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#7655E8]" />
              <h2 className="text-lg font-bold text-[#11142B]">{company.name}</h2>
            </div>
            <div className="text-xs text-slate-500">
              {tmpl.label} · {company.country} · {company.businessType} · {company.businessModel}
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#F5F3FF] hover:bg-purple-100 text-[#7655E8] border border-purple-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Company Logo</span>
              </button>
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={() => setLogoDataUrl(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-[#E04F44] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Logo</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="company-name" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Company Name
              </label>
              <input
                id="company-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              />
            </div>

            <div>
              <label htmlFor="company-email" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Company Contact Email
              </label>
              <input
                id="company-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              />
            </div>

            <div>
              <label htmlFor="company-regno" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Registration Number (Optional)
              </label>
              <input
                id="company-regno"
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g., 202401012345"
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] font-mono focus:outline-none focus:border-[#7655E8]"
              />
            </div>

            <div>
              <label htmlFor="company-industry" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Primary Industry
              </label>
              <select
                id="company-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value as IndustryKey)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              >
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {industry === 'other' && (
              <div>
                <label htmlFor="company-custom-ind" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                  Custom Industry Name
                </label>
                <input
                  id="company-custom-ind"
                  type="text"
                  value={customIndustryName}
                  onChange={(e) => setCustomIndustryName(e.target.value)}
                  placeholder="e.g., Logistics & Fleet"
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                />
              </div>
            )}

            <div>
              <label htmlFor="company-country" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Country / Region
              </label>
              <input
                id="company-country"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              />
            </div>

            <div>
              <label htmlFor="company-btype" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Business Type
              </label>
              <select
                id="company-btype"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              >
                {BUSINESS_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="company-bmodel" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Revenue / Business Model
              </label>
              <select
                id="company-bmodel"
                value={businessModel}
                onChange={(e) => setBusinessModel(e.target.value as BusinessModel)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              >
                {BUSINESS_MODEL_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="company-reltype" className="block text-xs font-semibold text-[#4C4A6E] mb-1.5">
                Customer Relationship Type
              </label>
              <select
                id="company-reltype"
                value={customerRelationshipType}
                onChange={(e) =>
                  setCustomerRelationshipType(e.target.value as CustomerRelationshipType)
                }
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              >
                {CUSTOMER_RELATIONSHIP_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSavingProfile}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-sm font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingProfile ? 'Saving Profile...' : 'Save Company Profile'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 2. CONFIGURABLE COMPANY CHURN DEFINITION */}
      <form
        onSubmit={handleChurnDefinitionSubmit}
        className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4"
      >
        <div>
          <h2 className="text-base font-bold text-[#11142B]">
            Churn Definition &amp; Formula
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Controls churn rate calculations across dashboards, analytics, and reports.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
              Churn Trigger Event
            </label>
            <select
              value={churnDef.triggerType}
              onChange={(e) =>
                setChurnDef((p) => ({
                  ...p,
                  triggerType: e.target.value as ChurnTriggerType,
                  inactivityDays: e.target.value === 'inactivity' ? p.inactivityDays || 90 : null,
                }))
              }
              className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
            >
              {CHURN_TRIGGER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
              Calculation Method
            </label>
            <select
              value={churnDef.calculationMethod}
              onChange={(e) =>
                setChurnDef((p) => ({
                  ...p,
                  calculationMethod: e.target.value as ChurnCalculationMethod,
                }))
              }
              className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
            >
              {CALCULATION_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
              Denominator Population
            </label>
            <select
              value={churnDef.denominatorPopulation}
              onChange={(e) =>
                setChurnDef((p) => ({
                  ...p,
                  denominatorPopulation: e.target.value as ChurnDenominatorType,
                }))
              }
              className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
            >
              {DENOMINATOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
              Reporting Period
            </label>
            <select
              value={churnDef.reportingPeriod}
              onChange={(e) =>
                setChurnDef((p) => ({
                  ...p,
                  reportingPeriod: e.target.value as ReportingPeriod,
                }))
              }
              className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
            >
              {REPORTING_PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {churnDef.triggerType === 'inactivity' && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                Inactivity Threshold (Days)
              </label>
              <input
                type="number"
                min={1}
                max={1095}
                value={churnDef.inactivityDays ?? 90}
                onChange={(e) =>
                  setChurnDef((p) => ({ ...p, inactivityDays: Number(e.target.value) || 90 }))
                }
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
              />
            </div>
          )}

          <div
            className={
              churnDef.triggerType === 'inactivity' ? 'sm:col-span-3' : 'sm:col-span-4'
            }
          >
            <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
              Business Churn Event Description
            </label>
            <input
              type="text"
              value={churnDef.churnEventDescription}
              onChange={(e) =>
                setChurnDef((p) => ({ ...p, churnEventDescription: e.target.value }))
              }
              className="w-full px-3 py-2 text-xs rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B]"
            />
          </div>
        </div>

        <div className="bg-[#F5F3FF] border border-purple-200/80 rounded-xl p-3.5 text-xs text-[#15152F]">
          <span className="font-bold text-[#5B3AD6]">Applied Formula Explanation: </span>
          <span className="font-mono text-[11px] text-slate-700">
            {formatChurnCalculationExplanation(churnDef, 25, 250)}
          </span>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSavingDef}
            className="inline-flex items-center gap-2 px-5 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 text-[#35C5E8]" />
            <span>{isSavingDef ? 'Saving Formula...' : 'Confirm & Save Churn Definition'}</span>
          </button>
        </div>
      </form>

      {/* 2B. DATA ISOLATION & CROSS-COMPANY PRIVACY SAFEGUARDS */}
      <form
        onSubmit={handlePrivacySubmit}
        className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#16C995]" />
            <h2 className="text-base font-bold text-[#11142B]">
              Data Isolation &amp; Cross-Company Model Governance
            </h2>
          </div>
          <span className="text-[11px] font-mono font-semibold text-[#0E9F6E] bg-[#16C995]/10 border border-[#16C995]/30 px-2.5 py-1 rounded-lg">
            Default: Private Tenant-Only (Opt-Out)
          </span>
        </div>

        <div className="bg-[#F5F3FF] border border-purple-200/80 rounded-xl p-3.5 text-xs text-[#15152F] space-y-1">
          <div className="font-bold text-[#11142B]">{privacySettings.isolationGuarantee}</div>
          <p className="text-slate-600">
            Tenant workspace <span className="font-mono font-semibold">{company.id}</span> keeps all
            customer records and model weights strictly isolated.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-purple-100 hover:border-purple-200 cursor-pointer">
            <input
              type="checkbox"
              checked={privacySettings.optInCrossCompanyBaseline}
              onChange={(e) =>
                setPrivacySettings((p) => ({
                  ...p,
                  optInCrossCompanyBaseline: e.target.checked,
                }))
              }
              className="mt-0.5 rounded border-purple-300 accent-[#7655E8]"
            />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-[#11142B]">
                Opt-in to Industry Cold-Start Baselines (Future Release)
              </div>
              <p className="text-slate-600">
                Evaluate anonymized industry baselines during cold-start periods.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-purple-100 hover:border-purple-200 cursor-pointer">
            <input
              type="checkbox"
              checked={privacySettings.allowSharedModelContribution}
              onChange={(e) =>
                setPrivacySettings((p) => ({
                  ...p,
                  allowSharedModelContribution: e.target.checked,
                }))
              }
              className="mt-0.5 rounded border-purple-300 accent-[#7655E8]"
            />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-[#11142B]">
                De-Identified Pattern Contribution (Opt-In)
              </div>
              <p className="text-slate-600">
                Off by default. Raw customer records are never shared across workspaces.
              </p>
            </div>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSavingPrivacy}
            className="inline-flex items-center gap-2 px-5 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 text-[#16C995]" />
            <span>{isSavingPrivacy ? 'Saving Preferences...' : 'Save Privacy Preferences'}</span>
          </button>
        </div>
      </form>

      {/* 3. SUBSCRIPTION PLAN & USAGE QUOTAS */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#7655E8]" />
            <h2 className="text-base font-bold text-[#11142B]">
              Subscription Tier &amp; Workspace Quotas
            </h2>
          </div>
          <span className="text-xs font-mono font-bold text-[#7655E8]">
            Active Plan: {plan.name} ({plan.monthlyPriceLabel})
          </span>
        </div>

        {usage && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="border border-purple-100 rounded-xl p-4 bg-[#F5F3FF]/40 space-y-2">
              <div className="flex items-center justify-between font-semibold text-[#11142B]">
                <span>Team Seats</span>
                <span className="font-mono tabular-nums">
                  {usage.userCount} / {plan.maxUsers}
                </span>
              </div>
              <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${pct(usage.userCount, plan.maxUsers)}%` }}
                  className="h-full bg-[#7655E8]"
                />
              </div>
            </div>

            <div className="border border-purple-100 rounded-xl p-4 bg-[#F5F3FF]/40 space-y-2">
              <div className="flex items-center justify-between font-semibold text-[#11142B]">
                <span>Dataset Records</span>
                <span className="font-mono tabular-nums">
                  {usage.recordCount.toLocaleString()} / {plan.maxRecords.toLocaleString()}
                </span>
              </div>
              <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${pct(usage.recordCount, plan.maxRecords)}%` }}
                  className="h-full bg-[#397BFF]"
                />
              </div>
            </div>

            <div className="border border-purple-100 rounded-xl p-4 bg-[#F5F3FF]/40 space-y-2">
              <div className="flex items-center justify-between font-semibold text-[#11142B]">
                <span>Workspace Storage</span>
                <span className="font-mono tabular-nums">
                  {formatBytes(usage.storageBytesUsed)} / {formatBytes(plan.maxStorageBytes)}
                </span>
              </div>
              <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${pct(usage.storageBytesUsed, plan.maxStorageBytes)}%` }}
                  className="h-full bg-[#E84FA8]"
                />
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#397BFF]/8 border border-[#397BFF]/25 rounded-xl p-3.5 flex items-center gap-2.5 text-xs text-[#11142B]">
          <Info className="w-4 h-4 text-[#397BFF] shrink-0" />
          <span>
            <strong>Preview Mode:</strong> Plan entitlements apply immediately without billing
            charges.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {SUBSCRIPTION_PLAN_LIST.map((p) => {
            const isCurrent = p.tier === company.subscriptionPlan;
            return (
              <div
                key={p.tier}
                className={`rounded-xl border p-4 flex flex-col justify-between space-y-3 ${
                  isCurrent
                    ? 'border-[#7655E8] bg-[#F5F3FF]/70 shadow-xs'
                    : 'border-purple-100 bg-white'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[#11142B]">{p.name}</span>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#7655E8]">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs font-bold text-[#397BFF]">
                    {p.monthlyPriceLabel}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{p.tagline}</p>
                  <ul className="text-[11px] text-slate-700 space-y-1 pt-2 font-mono">
                    <li>Max {p.maxRecords.toLocaleString()} rows</li>
                    <li>Max {p.maxUsers} users</li>
                    <li>Random Forest: {p.allowedModels.includes('random_forest') ? 'Yes' : 'No'}</li>
                    <li>Batch Scoring: {p.allowBatchScoring ? 'Yes' : 'No'}</li>
                    <li>PDF Exports: {p.allowPdfReports ? 'Yes' : 'No'}</li>
                    <li>Audit Logs: {p.allowAuditLogs ? 'Yes' : 'No'}</li>
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={isCurrent || isChangingPlan !== null}
                  onClick={() => handlePlanSwitch(p.tier)}
                  className={`w-full py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                    isCurrent
                      ? 'bg-purple-100 text-[#5B3AD6] cursor-default'
                      : 'bg-[#11142B] hover:bg-[#1C2147] text-white'
                  }`}
                >
                  {isCurrent
                    ? 'Active Plan'
                    : isChangingPlan === p.tier
                      ? 'Switching...'
                      : `Switch to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. COMPANY AUDIT LOGS */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#7655E8]" />
            <h2 className="text-base font-bold text-[#11142B]">Workspace Security Audit Log</h2>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {plan.allowAuditLogs || user.role === 'PLATFORM_OWNER'
              ? `${auditLogs.length} event(s)`
              : 'Professional+ Feature'}
          </span>
        </div>

        {!plan.allowAuditLogs && user.role !== 'PLATFORM_OWNER' ? (
          <p className="text-xs text-slate-600">
            Audit trail visibility is enabled on Professional and Enterprise subscription tiers.
          </p>
        ) : loadingLogs ? (
          <p className="text-xs text-slate-500">Loading workspace audit events...</p>
        ) : auditLogs.length === 0 ? (
          <p className="text-xs text-slate-500">No workspace audit events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-[280px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                <tr>
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Actor</th>
                  <th className="py-2 px-3">Action</th>
                  <th className="py-2 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {auditLogs.slice(0, 40).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-[#11142B] whitespace-nowrap">
                      {log.actorEmail}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#7655E8] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-2 px-3 text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. DEMO WORKSPACE CONTROLS */}
      <div className="space-y-2">
        <h2 className="text-base font-bold text-[#11142B]">Demo Workspace</h2>
        <DemoWorkspacePanel
          embedded
          company={company}
          dataset={dataset}
          onWorkspaceMutated={onWorkspaceMutated}
          onNavigateToData={onNavigateToData}
        />
      </div>
    </div>
  );
};
