import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  History,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  AuditLogEntry,
  PlatformCompanySummary,
  SubscriptionPlanSpec,
  SubscriptionPlanTier,
  UserAccount,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { getIndustryTemplate } from '../utils/industryConfig';
import { formatBytes } from '../utils/subscriptionPlans';

interface PlatformGovernanceViewProps {
  currentUser: UserAccount;
  onOwnCompanyPlanChanged?: () => Promise<void>;
}

export const PlatformGovernanceView: React.FC<PlatformGovernanceViewProps> = ({
  currentUser,
  onOwnCompanyPlanChanged,
}) => {
  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlanSpec[]>([]);
  const [industriesConfigured, setIndustriesConfigured] = useState(9);
  const [billingConfigured, setBillingConfigured] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [updatingCompanyId, setUpdatingCompanyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/platform/overview');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load platform governance overview.');
        return;
      }
      setCompanies(data.companies || []);
      setAuditLogs(data.auditLogs || []);
      setPlans(data.plans || []);
      setIndustriesConfigured(data.industriesConfigured || 9);
      setBillingConfigured(Boolean(data.billingIntegrationConfigured));
    } catch {
      setError('Network error while loading platform governance data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser.role === 'PLATFORM_OWNER') {
      loadOverview();
    } else {
      setIsLoading(false);
    }
  }, [currentUser.role]);

  if (currentUser.role !== 'PLATFORM_OWNER') {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-10 text-center max-w-xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-[#FF786B]/15 text-[#E04F44] flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#11142B]">Platform Owner Access Required</h2>
        <p className="text-sm text-slate-600">
          This multi-tenant governance console is restricted strictly to the SaaS Platform Owner.
        </p>
      </div>
    );
  }

  const handleAssignPlan = async (companyId: string, subscriptionPlan: SubscriptionPlanTier) => {
    setUpdatingCompanyId(companyId);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(
        `/api/platform/companies/${encodeURIComponent(companyId)}/plan`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptionPlan }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update tenant subscription plan.');
        return;
      }
      setNotice(`Assigned "${subscriptionPlan}" plan to ${data.company.name}.`);
      await loadOverview();
      if (companyId === currentUser.companyId && onOwnCompanyPlanChanged) {
        await onOwnCompanyPlanChanged();
      }
    } catch {
      setError('Network error while updating tenant subscription plan.');
    } finally {
      setUpdatingCompanyId(null);
    }
  };

  const totalRecords = companies.reduce((acc, c) => acc + c.recordCount, 0);
  const totalStorage = companies.reduce((acc, c) => acc + c.storageBytesUsed, 0);
  const totalUsers = companies.reduce((acc, c) => acc + c.userCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7655E8]">
            SaaS Platform Administration
          </div>
          <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">
            Platform Governance Console
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Monitor isolated tenant workspaces, subscription quotas, and platform-wide audit events
          </p>
        </div>

        <button
          type="button"
          onClick={loadOverview}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#F5F3FF] text-[#11142B] border border-purple-200 text-xs font-semibold rounded-xl cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#7655E8] ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">Registered Tenants</div>
          <div className="text-2xl font-bold text-[#11142B] font-mono tabular-nums mt-1">
            {companies.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {totalUsers} users · {industriesConfigured} industries configured
          </div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#397BFF]">Hosted Dataset Records</div>
          <div className="text-2xl font-bold text-[#397BFF] font-mono tabular-nums mt-1">
            {totalRecords.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Isolated per-tenant files</div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#7655E8]">Total Workspace Storage</div>
          <div className="text-2xl font-bold text-[#7655E8] font-mono tabular-nums mt-1">
            {formatBytes(totalStorage)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Encrypted &amp; disk-persisted</div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#0E9F6E]">Payment Gateway</div>
          <div className="text-sm font-bold text-[#11142B] mt-2">
            {billingConfigured ? 'Stripe Connected' : 'Preview Mode (Stripe Unset)'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Quotas actively enforced server-side
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

      {/* Tenant Directory */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#7655E8]" />
            <h2 className="text-base font-bold text-[#11142B]">Tenant Workspaces</h2>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-[#16C995]" />
            <span>Cross-tenant row payloads remain strictly confidential</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-purple-100 text-[#4C4A6E] font-semibold">
                <th className="py-2.5 pr-4">Company</th>
                <th className="py-2.5 px-3">Industry &amp; Region</th>
                <th className="py-2.5 px-3 text-right">Users</th>
                <th className="py-2.5 px-3 text-right">Dataset</th>
                <th className="py-2.5 px-3 text-right">Models</th>
                <th className="py-2.5 px-3 text-right">Storage</th>
                <th className="py-2.5 pl-3 text-right">Subscription Plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-50">
              {companies.map((row) => {
                const tmpl = getIndustryTemplate(
                  row.company.industry,
                  row.company.customIndustryName
                );
                return (
                  <tr key={row.company.id} className="hover:bg-[#F5F3FF]/50">
                    <td className="py-3 pr-4">
                      <div className="font-bold text-[#11142B]">{row.company.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {row.company.email}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-[#11142B]">{tmpl.label}</div>
                      <div className="text-[11px] text-slate-500">
                        {row.company.country} · {row.company.businessType}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {row.activeUserCount}/{row.userCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {row.hasDataset ? (
                        <span className="inline-flex items-center gap-1 text-[#11142B]">
                          <Database className="w-3 h-3 text-[#397BFF]" />
                          {row.recordCount.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">Empty</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {row.trainedModelsCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {formatBytes(row.storageBytesUsed)}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <select
                        aria-label={`Subscription plan for ${row.company.name}`}
                        value={row.company.subscriptionPlan}
                        disabled={updatingCompanyId === row.company.id}
                        onChange={(e) =>
                          handleAssignPlan(row.company.id, e.target.value as SubscriptionPlanTier)
                        }
                        className="rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-semibold text-[#11142B]"
                      >
                        {plans.map((p) => (
                          <option key={p.tier} value={p.tier}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Platform Audit Feed */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#7655E8]" />
          <h2 className="text-base font-bold text-[#11142B]">Platform Security Audit Feed</h2>
        </div>

        <div className="overflow-x-auto max-h-[320px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
              <tr>
                <th className="py-2 px-3">Timestamp</th>
                <th className="py-2 px-3">Company ID</th>
                <th className="py-2 px-3">Actor</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-50">
              {auditLogs.slice(0, 60).map((log) => (
                <tr key={log.id}>
                  <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {log.companyId}
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
      </div>
    </div>
  );
};
