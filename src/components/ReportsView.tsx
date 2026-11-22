import React, { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
} from 'lucide-react';
import {
  AnalyticsSummary,
  BatchScoreResult,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
} from '../types/churn';
import { downloadProtectedCsv } from '../utils/apiClient';
import { getIndustryTemplate } from '../utils/industryConfig';
import {
  exportChurnSummaryCsv,
  exportChurnSummaryPdf,
  exportCustomerRiskPdf,
  exportDatasetSummaryCsv,
  exportModelEvaluationPdf,
} from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';

interface ReportsViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  analytics: AnalyticsSummary | null;
  activeModel: ModelEvaluationResult | null;
  batchScores: BatchScoreResult[];
  onNavigate: (tab: NavTab) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  company,
  dataset,
  analytics,
  activeModel,
  batchScores,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleProtectedDownload = async (url: string, filename: string) => {
    setExportError(null);
    try {
      await downloadProtectedCsv(url, filename);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to export report.');
    }
  };

  if (!dataset || !analytics) {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-10 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
          <FileText className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold text-[#11142B]">No Reports Available Yet</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Upload a customer dataset in Data Management first to generate executive retention PDFs,
          risk lists, and data quality audits.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] text-white text-sm font-semibold rounded-xl shadow-sm cursor-pointer"
        >
          Open Data Management
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#7655E8]">
            {company.name} · {tmpl.label}
          </div>
          <h1 className="font-display text-2xl font-bold text-[#11142B] tracking-tight mt-0.5">
            Reports &amp; Executive Deliverables
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Download board-ready retention summaries, customer risk priority lists, and dataset
            audits.
          </p>
        </div>

        <div className="text-xs text-slate-600 bg-white border border-purple-100 rounded-xl px-3.5 py-2">
          Active Plan: <strong className="text-[#11142B]">{plan.name}</strong>
          {!plan.allowPdfReports && ' · Upgrade to Starter+ for PDF Exports'}
        </div>
      </div>

      {!plan.allowPdfReports && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">PDF Report Generation Requires Starter Plan or Higher</div>
              <p className="mt-0.5">
                CSV exports remain unlocked on {plan.name}. Switch plan in Settings to download
                formatted Executive PDF deliverables.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="px-3.5 py-2 bg-amber-900 text-white font-semibold rounded-xl shrink-0 cursor-pointer"
          >
            View Plans in Settings
          </button>
        </div>
      )}

      {exportError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-center gap-2 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* 1. Executive Retention Summary */}
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#7655E8]">Portfolio Overview</div>
            <h2 className="font-display text-lg font-bold text-[#11142B]">
              Executive Churn Summary
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Summarizes total {tmpl.entityPlural.toLowerCase()} ({analytics.totalCustomers.toLocaleString()}
              ), overall churn rate ({analytics.churnRate.toFixed(1)}%), confirmed churn formula,
              and segment breakdowns for {dataset.fileName}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-100">
            <button
              type="button"
              onClick={() => exportChurnSummaryCsv(company, dataset, analytics)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF]/60 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Summary CSV</span>
            </button>
            <button
              type="button"
              disabled={!plan.allowPdfReports}
              onClick={() => exportChurnSummaryPdf(company, dataset, analytics, activeModel)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>Executive PDF</span>
            </button>
          </div>
        </div>

        {/* 2. At-Risk Customer Priority List */}
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#E84FA8]">Outreach &amp; Retention</div>
            <h2 className="font-display text-lg font-bold text-[#11142B]">
              {tmpl.entitySingular} Churn Risk List
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {activeModel
                ? `Exports ${activeModel.predictions.length.toLocaleString()} scored ${tmpl.entityPlural.toLowerCase()} ranked with churn probabilities and risk tiers.`
                : 'Available once your prediction model finishes validation checks and activates predictions.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-100">
            <button
              type="button"
              disabled={!activeModel}
              onClick={() =>
                handleProtectedDownload('/api/model/export-predictions', 'churn_predictions.csv')
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF]/60 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] disabled:opacity-45 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Predictions CSV</span>
            </button>
            <button
              type="button"
              disabled={!activeModel || !plan.allowPdfReports}
              onClick={() => activeModel && exportCustomerRiskPdf(company, activeModel)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
              <span>Risk Priority PDF</span>
            </button>
          </div>
        </div>

        {/* 3. Model Performance Report */}
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#397BFF]">Quality Assurance</div>
            <h2 className="font-display text-lg font-bold text-[#11142B]">
              Model Performance Report
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {activeModel
                ? `Documents validation reliability (${activeModel.accuracy.toFixed(1)}% accuracy, ${activeModel.recall.toFixed(1)}% churn recall) and key retention drivers.`
                : 'Requires an active validated prediction model.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-100">
            <button
              type="button"
              disabled={!activeModel || !plan.allowPdfReports}
              onClick={() => activeModel && exportModelEvaluationPdf(company, activeModel)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>Model Performance PDF</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('performance')}
              className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer px-2"
            >
              View Performance Details →
            </button>
          </div>
        </div>

        {/* 4. Data Preparation & Schema Audit */}
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#0E9F6E]">Data Governance</div>
            <h2 className="font-display text-lg font-bold text-[#11142B]">
              Data Preparation &amp; Schema Audit
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Exports column types, semantic mappings, missing cell counts, and unique value
              coverage across {dataset.columnCount} columns in {dataset.fileName}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-100">
            <button
              type="button"
              onClick={() => exportDatasetSummaryCsv(company, dataset)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF]/60 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#0E9F6E]" />
              <span>Schema Audit CSV</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('customers')}
              className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer px-2"
            >
              View Customer Profiles →
            </button>
          </div>
        </div>

        {/* 5. Customer Value & Revenue Exposure CSV */}
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 flex flex-col justify-between space-y-5 md:col-span-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#7655E8]">Customer Value &amp; Financial Exposure</div>
            <h2 className="font-display text-lg font-bold text-[#11142B]">
              Customer Value Intelligence &amp; Exposure Report
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Exports customer value scores, High/Medium/Low value tiers, Value &times; Churn Risk Matrix quadrants,
              expected annual revenue exposure, and traceable evidence columns from your workspace dataset.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-100">
            <button
              type="button"
              onClick={() =>
                handleProtectedDownload(
                  '/api/value-intelligence/export-csv',
                  'customer_value_intelligence.csv'
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF]/60 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>Customer Value &amp; Exposure CSV</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('value')}
              className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer px-2"
            >
              Open Value Intelligence →
            </button>
          </div>
        </div>
      </div>

      {/* Batch Prediction Exports History */}
      {batchScores.length > 0 && (
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Batch Prediction Exports
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Download scored CSV or PDF action lists from previously uploaded customer batches
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-purple-100 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-4">Batch File</th>
                  <th className="py-2.5 px-3">Scored At</th>
                  <th className="py-2.5 px-3 text-right">Records</th>
                  <th className="py-2.5 px-3 text-right">High Risk</th>
                  <th className="py-2.5 pl-3 text-right">Downloads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {batchScores.map((batch) => (
                  <tr key={batch.batchId}>
                    <td className="py-2.5 pr-4 font-semibold text-[#11142B]">{batch.fileName}</td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono">
                      {new Date(batch.scoredAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {batch.totalRows.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#D63384]">
                      {batch.highRiskCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleProtectedDownload(
                              `/api/model/export-batch/${encodeURIComponent(batch.batchId)}`,
                              `batch_predictions_${batch.batchId}.csv`
                            )
                          }
                          className="text-xs font-semibold text-[#397BFF] hover:underline cursor-pointer"
                        >
                          CSV
                        </button>
                        {plan.allowPdfReports && activeModel && (
                          <button
                            type="button"
                            onClick={() => exportCustomerRiskPdf(company, activeModel, batch)}
                            className="text-xs font-semibold text-[#E84FA8] hover:underline cursor-pointer"
                          >
                            PDF
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
