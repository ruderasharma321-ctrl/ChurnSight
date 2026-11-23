import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CompanyWorkspaceInfo, DatasetState } from '../types/churn';
import { apiFetch, downloadProtectedCsv } from '../utils/apiClient';

interface DemoWorkspacePanelProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  onWorkspaceMutated: (data: Record<string, any>) => void;
  onNavigateToData?: () => void;
  embedded?: boolean;
}

type PendingConfirmAction = 'reset_demo' | 'clear_dataset' | 'restore_sample' | null;

export const DemoWorkspacePanel: React.FC<DemoWorkspacePanelProps> = ({
  company,
  dataset,
  onWorkspaceMutated,
  onNavigateToData,
  embedded = false,
}) => {
  const [pendingAction, setPendingAction] = useState<PendingConfirmAction>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const runAction = async (action: Exclude<PendingConfirmAction, null>) => {
    setIsRunning(true);
    setError(null);
    setSuccess(null);
    try {
      const endpoint =
        action === 'clear_dataset'
          ? '/api/demo/clear-dataset'
          : action === 'reset_demo'
            ? '/api/demo/reset-workspace'
            : '/api/dataset/load-sample';

      const res = await apiFetch(endpoint, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Operation failed.');
      }

      onWorkspaceMutated(data);
      setPendingAction(null);

      if (action === 'clear_dataset') {
        setSuccess(
          data.message ||
            'Imported dataset and derived predictions cleared. You can upload another Excel or CSV dataset immediately.'
        );
      } else if (action === 'reset_demo') {
        setSuccess(data.message || 'Demo workspace reset cleanly.');
      } else {
        setSuccess(
          `Loaded ${data.dataset?.fileName || 'sample dataset'} (${(data.dataset?.rowCount || 0).toLocaleString()} customer records) into your local browser workspace.`
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to complete demo workspace action.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportWorkspace = async () => {
    setError(null);
    setSuccess(null);
    setIsRunning(true);
    try {
      const safeName =
        company.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'workspace';
      await downloadProtectedCsv(
        '/api/demo/export-workspace',
        `${safeName}_demo_workspace_backup.json`
      );
      setSuccess('Workspace JSON backup downloaded from local browser storage.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to export workspace data.');
    } finally {
      setIsRunning(false);
    }
  };

  const confirmDetails: Record<
    Exclude<PendingConfirmAction, null>,
    { title: string; body: string; confirmLabel: string; danger: boolean }
  > = {
    clear_dataset: {
      title: 'Clear Imported Dataset?',
      body: 'This removes the active dataset, uploaded dataset history, trained models, and derived risk scores from this workspace so you can upload a fresh Excel or CSV file.',
      confirmLabel: 'Clear Imported Dataset',
      danger: true,
    },
    reset_demo: {
      title: 'Reset Demo Data?',
      body: 'This resets custom datasets, models, value settings, and churn formula overrides in this workspace back to the default demo state in your browser.',
      confirmLabel: 'Reset Demo Data',
      danger: true,
    },
    restore_sample: {
      title: 'Replace Active Dataset With Sample Data?',
      body: 'An active dataset is currently loaded. Restoring the industry sample dataset will replace the active dataset and re-run automated churn analysis and scoring.',
      confirmLabel: 'Restore Sample Dataset',
      danger: false,
    },
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6 max-w-5xl'}>
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">Demo Workspace</h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Local browser storage controls for {company.name}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F5F3FF] border border-purple-200 text-xs font-semibold text-[#5B3AD6] self-start sm:self-auto">
            <Database className="w-3.5 h-3.5" />
            <span>DEMO MODE — Data stored locally in this browser.</span>
          </span>
        </div>
      )}

      {error && (
        <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
          <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#065F46]">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
          {onNavigateToData && (
            <button
              type="button"
              onClick={onNavigateToData}
              className="px-3 py-1.5 rounded-lg bg-[#065F46] text-white font-semibold cursor-pointer whitespace-nowrap"
            >
              Open Data Management
            </button>
          )}
        </div>
      )}

      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-purple-100">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold text-[#11142B]">Browser Persistence Status</h2>
            <p className="text-xs text-slate-500">
              All datasets, customer records, models, and reports are saved locally in IndexedDB and
              persist across refreshes in this browser only.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 bg-[#F5F3FF] border border-purple-100 px-3 py-1.5 rounded-xl whitespace-nowrap">
            {dataset
              ? `${dataset.fileName} (${dataset.rowCount.toLocaleString()} rows)`
              : 'No active dataset'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Restore Sample Dataset */}
          <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-[#11142B]">
                <Sparkles className="w-4 h-4 text-[#7655E8]" />
                <span>Restore Sample Dataset</span>
              </div>
              <p className="text-xs text-slate-600">
                Loads the 250-record industry sample dataset and refreshes churn analytics and risk
                predictions.
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => {
                if (dataset) {
                  setPendingAction('restore_sample');
                } else {
                  runAction('restore_sample');
                }
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>Restore Sample Dataset</span>
            </button>
          </div>

          {/* Export Workspace Data */}
          <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-[#11142B]">
                <Download className="w-4 h-4 text-[#397BFF]" />
                <span>Export Workspace Data</span>
              </div>
              <p className="text-xs text-slate-600">
                Downloads a JSON backup containing your workspace configuration, active dataset,
                analytics, and model summaries.
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={handleExportWorkspace}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-purple-200 bg-white hover:bg-[#F5F3FF] text-[#11142B] text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Export Workspace Data</span>
            </button>
          </div>

          {/* Clear Imported Dataset */}
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-[#11142B]">
                <Trash2 className="w-4 h-4 text-amber-700" />
                <span>Clear Imported Dataset</span>
              </div>
              <p className="text-xs text-slate-600">
                Removes imported customer and ticket datasets along with dependent predictions so
                you can upload a new Excel or CSV file.
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setPendingAction('clear_dataset')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Imported Dataset</span>
            </button>
          </div>

          {/* Reset Demo Data */}
          <div className="rounded-xl border border-[#FF786B]/40 bg-[#FF786B]/5 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-[#9A2E25]">
                <RotateCcw className="w-4 h-4 text-[#E04F44]" />
                <span>Reset Demo Data</span>
              </div>
              <p className="text-xs text-slate-600">
                Restores this workspace to its initial demo defaults and clears custom modifications
                stored in your browser.
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setPendingAction('reset_demo')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[#FF786B]/50 bg-white hover:bg-[#FF786B]/10 text-[#9A2E25] text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Demo Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#11142B]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-[#11142B]">
                {confirmDetails[pendingAction].title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {confirmDetails[pendingAction].body}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 rounded-xl border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => runAction(pendingAction)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50 ${
                  confirmDetails[pendingAction].danger
                    ? 'bg-[#E04F44] hover:bg-[#C93B31]'
                    : 'bg-[#11142B] hover:bg-[#1C2147]'
                }`}
              >
                {isRunning ? 'Working...' : confirmDetails[pendingAction].confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
