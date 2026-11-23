import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Eye,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  CompanyWorkspaceInfo,
  CustomerActualStatus,
  DatasetState,
  ModelEvaluationResult,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import {
  formatAttributeValue,
  formatCategoricalValue,
  formatReadableDate,
  getHumanReadableFieldLabel,
} from '../utils/formatters';
import {
  getIndustryDataTemplateColumns,
  getIndustryTemplate,
} from '../utils/industryConfig';

interface DirectoryRiskInfo {
  churnProbability: number;
  riskCategory: string;
  predictedChurn: string;
}

interface DirectoryCounts {
  all: number;
  active: number;
  churned: number;
  inconsistent?: number;
  highRisk: number;
  pending: number;
}

interface CustomerDirectorySectionProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  activeModel: ModelEvaluationResult | null;
  canUploadAndAnalyse: boolean;
  onWorkspaceMutated: (payload: Record<string, any>) => void;
  onNavigateData?: () => void;
}

type StatusFilterKey = 'ALL' | 'active' | 'churned' | 'inconsistent' | 'high_risk' | 'pending';

export const CustomerDirectorySection: React.FC<CustomerDirectorySectionProps> = ({
  company,
  dataset,
  activeModel,
  canUploadAndAnalyse,
  onWorkspaceMutated,
  onNavigateData,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const templateSpecs = useMemo(
    () => getIndustryDataTemplateColumns(company.industry),
    [company.industry]
  );

  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = viewMode === 'card' ? 6 : 10;

  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [rowIndices, setRowIndices] = useState<number[]>([]);
  const [risks, setRisks] = useState<(DirectoryRiskInfo | null)[]>([]);
  const [statuses, setStatuses] = useState<CustomerActualStatus[]>([]);
  const [counts, setCounts] = useState<DirectoryCounts>({
    all: 0,
    active: 0,
    churned: 0,
    inconsistent: 0,
    highRisk: 0,
    pending: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Add / Edit / View / Delete state
  const [formOpen, setFormOpen] = useState(false);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [inspectTarget, setInspectTarget] = useState<{
    row: Record<string, string>;
    rowIndex: number;
    risk: DirectoryRiskInfo | null;
    actualStatus?: CustomerActualStatus;
  } | null>(null);

  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!dataset) {
      setRows([]);
      setRowIndices([]);
      setRisks([]);
      setStatuses([]);
      setCounts({ all: 0, active: 0, churned: 0, inconsistent: 0, highRisk: 0, pending: 0 });
      setTotal(0);
      setTotalPages(1);
      return;
    }

    setIsLoadingRows(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        status: statusFilter,
      });
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (monthFilter.trim()) params.set('month', monthFilter.trim());

      const res = await apiFetch(`/api/dataset/rows?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load customer records.');
      }

      setRows(Array.isArray(data.items) ? data.items : []);
      setRowIndices(Array.isArray(data.rowIndices) ? data.rowIndices : []);
      setRisks(Array.isArray(data.risks) ? data.risks : []);
      setStatuses(Array.isArray(data.statuses) ? data.statuses : []);
      if (data.counts) {
        setCounts(data.counts);
      }
      setTotal(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Unable to load customer directory.');
    } finally {
      setIsLoadingRows(false);
    }
  }, [dataset, page, pageSize, statusFilter, searchQuery, monthFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery, monthFilter, viewMode, dataset?.datasetId]);

  const formatCtx = useMemo(() => ({ dataset, company }), [dataset, company]);

  const formFields = useMemo(() => {
    if (dataset && dataset.columns.length > 0) {
      return dataset.columns.map((col) => {
        const spec = templateSpecs.find((s) => s.name === col.name);
        return {
          name: col.name,
          label: getHumanReadableFieldLabel(col.name, formatCtx),
          dataType: col.dataType,
          categories: col.categories,
          placeholder: spec?.exampleValue || (col.sampleValues[0] ?? ''),
          description: spec?.description || '',
          isTarget: col.name === dataset.mapping.targetColumn,
        };
      });
    }

    return templateSpecs.map((spec) => ({
      name: spec.name,
      label: spec.displayName,
      dataType: spec.dataType,
      categories:
        spec.semanticRole === 'target'
          ? ['No', 'Yes']
          : undefined,
      placeholder: spec.exampleValue,
      description: spec.description,
      isTarget: spec.semanticRole === 'target',
    }));
  }, [dataset, templateSpecs]);

  const openAddModal = () => {
    const initial: Record<string, string> = {};
    const nextNum = (dataset?.rowCount || 0) + 1001;
    formFields.forEach((f, idx) => {
      if (idx === 0 && (f.dataType === 'identifier' || f.name.toLowerCase().includes('id'))) {
        initial[f.name] = `CUST-${nextNum}`;
      } else {
        initial[f.name] = '';
      }
    });
    setEditingRowIndex(null);
    setFormValues(initial);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (row: Record<string, string>, rowIndex: number) => {
    const initial: Record<string, string> = {};
    formFields.forEach((f) => {
      initial[f.name] = row[f.name] ?? '';
    });
    setEditingRowIndex(rowIndex);
    setFormValues(initial);
    setFormError(null);
    setFormOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSaving(true);
    try {
      const isEditing = editingRowIndex !== null;
      const url = isEditing
        ? `/api/dataset/customers/${editingRowIndex}`
        : '/api/dataset/customers';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: formValues }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save customer record.');
      }

      onWorkspaceMutated(data);
      setFormOpen(false);
      await fetchRows();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Unable to save customer.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async (rowIndex: number) => {
    setIsDeleting(true);
    setFetchError(null);
    try {
      const res = await apiFetch(`/api/dataset/customers/${rowIndex}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete customer record.');
      }
      setConfirmDeleteIndex(null);
      if (inspectTarget?.rowIndex === rowIndex) {
        setInspectTarget(null);
      }
      onWorkspaceMutated(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Unable to delete customer.');
    } finally {
      setIsDeleting(false);
    }
  };

  const mapping = dataset?.mapping;
  const idCol = mapping?.idColumn;
  const segmentCol = mapping?.contractColumn;
  const tenureCol = mapping?.tenureColumn;
  const revenueCol = mapping?.monthlyChargesColumn;
  const dateCol = mapping?.dateColumn;
  const freqCol = mapping?.frequencyColumn;
  const targetCol = mapping?.targetColumn;
  const positiveVal = (mapping?.positiveClassValue || '').trim().toLowerCase();

  const resolveRowSummary = (
    row: Record<string, string>,
    idx: number,
    apiStatus?: CustomerActualStatus
  ) => {
    const idVal =
      (idCol && row[idCol]?.trim()) ||
      Object.values(row).find((v) => v && v.trim()) ||
      `Row #${idx + 1}`;

    const segmentVal =
      segmentCol && row[segmentCol]?.trim()
        ? formatCategoricalValue(segmentCol, row[segmentCol].trim())
        : tmpl.shortLabel;
    const tenureVal =
      tenureCol && row[tenureCol]?.trim()
        ? formatAttributeValue(tenureCol, row[tenureCol], formatCtx)
        : '—';
    const revenueVal =
      revenueCol && row[revenueCol]?.trim()
        ? formatAttributeValue(revenueCol, row[revenueCol], formatCtx)
        : '—';
    const dateVal =
      dateCol && row[dateCol]?.trim() ? formatReadableDate(row[dateCol]) : '—';
    const freqVal =
      freqCol && row[freqCol]?.trim()
        ? formatAttributeValue(freqCol, row[freqCol], formatCtx)
        : null;

    const targetRaw = targetCol ? (row[targetCol] || '').trim() : '';
    let resolvedStatus: CustomerActualStatus = apiStatus || 'Unknown';
    if (!apiStatus && targetCol && targetRaw) {
      resolvedStatus = targetRaw.toLowerCase() === positiveVal ? 'Churned' : 'Active';
    }

    let statusLabel = 'Pending Outcome';
    let statusStyle = 'bg-sky-600 text-white';

    if (resolvedStatus === 'Churned') {
      statusLabel = 'Churned';
      statusStyle = 'bg-[#DC2626] text-white';
    } else if (resolvedStatus === 'Inconsistent') {
      statusLabel = 'Inconsistent';
      statusStyle = 'bg-amber-600 text-white';
    } else if (resolvedStatus === 'Active') {
      statusLabel = 'Active';
      statusStyle = 'bg-[#059669] text-white';
    }

    const riskApplicable = resolvedStatus !== 'Churned' && resolvedStatus !== 'Inconsistent';

    // Pick up to 2 extra display attributes if standard mapped columns are sparse
    const usedKeys = new Set(
      [idCol, segmentCol, tenureCol, revenueCol, dateCol, freqCol, targetCol].filter(Boolean)
    );
    const extraPairs = Object.entries(row)
      .filter(([k, v]) => !usedKeys.has(k) && v !== undefined && v.trim() !== '')
      .slice(0, 2);

    return {
      idVal,
      segmentVal,
      tenureVal,
      revenueVal,
      dateVal,
      freqVal,
      resolvedStatus,
      riskApplicable,
      statusLabel,
      statusStyle,
      extraPairs,
    };
  };

  return (
    <section className="space-y-5" aria-label="Customer Directory">
      {/* Toolbar Header + Filters + Card/List Switch + Add Customer */}
      <div className="bg-white/95 border border-purple-100 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] text-white flex items-center justify-center shrink-0 shadow-sm shadow-[#397BFF]/25">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#11142B]">
                {tmpl.entitySingular} Directory
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Browse, filter, inspect, or add {tmpl.entityPlural.toLowerCase()} in card or list view.
              </p>
            </div>
          </div>

          {/* Filter Buttons Bar */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: 'ALL' as const, label: 'All', count: counts.all },
                { key: 'active' as const, label: 'Active', count: counts.active },
                { key: 'churned' as const, label: 'Churned', count: counts.churned },
                ...((counts.inconsistent ?? 0) > 0
                  ? [{ key: 'inconsistent' as const, label: 'Inconsistent', count: counts.inconsistent ?? 0 }]
                  : []),
                ...(activeModel
                  ? [{ key: 'high_risk' as const, label: 'Active High Risk', count: counts.highRisk }]
                  : []),
                ...(counts.pending > 0
                  ? [{ key: 'pending' as const, label: 'Pending Outcome', count: counts.pending }]
                  : []),
              ]
            ).map((btn) => {
              const active = statusFilter === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => setStatusFilter(btn.key)}
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#7655E8] text-white border-[#7655E8] shadow-sm shadow-[#7655E8]/25'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-[#7655E8]/40 hover:bg-[#F5F3FF]/50'
                  }`}
                >
                  <span>{btn.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded-md ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {btn.count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + Date Month Filter + Card/List Switch + Add Customer */}
        <div className="pt-3 border-t border-purple-100/80 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${tmpl.entityPlural.toLowerCase()} by ID, plan...`}
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7655E8]/30 focus:border-[#7655E8]"
              />
            </div>

            {dateCol && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-slate-500 flex items-center gap-1 whitespace-nowrap">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Month:</span>
                </label>
                <input
                  type="month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7655E8]/30"
                />
                {monthFilter && (
                  <button
                    type="button"
                    onClick={() => setMonthFilter('')}
                    aria-label="Clear month filter"
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#11142B] hover:bg-slate-50 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Segmented Card | List Toggle */}
            <div
              className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5"
              role="group"
              aria-label="Customer view layout"
            >
              <button
                type="button"
                onClick={() => setViewMode('card')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  viewMode === 'card'
                    ? 'bg-[#7655E8] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#11142B]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Card</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  viewMode === 'list'
                    ? 'bg-[#7655E8] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#11142B]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>List</span>
              </button>
            </div>

            {canUploadAndAnalyse && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#11142B] hover:bg-[#1E234A] text-white text-xs font-semibold rounded-xl shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Add {tmpl.entitySingular}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {fetchError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-800">
          {fetchError}
        </div>
      )}

      {/* Directory Content: Empty State / Card Grid / List Table */}
      {!dataset ? (
        <div className="bg-white/95 border border-purple-100 rounded-2xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#F5F3FF] border border-purple-100 text-[#7655E8] flex items-center justify-center mx-auto">
            <UserPlus className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="font-display text-base font-bold text-[#11142B]">
              No {tmpl.entityPlural.toLowerCase()} added yet
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Add your first {tmpl.entitySingular.toLowerCase()} record directly here, or upload a CSV/Excel file to populate your directory in card and list views.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {canUploadAndAnalyse && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#7655E8] hover:bg-[#6645D8] text-white text-xs font-semibold rounded-xl shadow-sm cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Add First {tmpl.entitySingular}</span>
              </button>
            )}
            {onNavigateData && (
              <button
                type="button"
                onClick={onNavigateData}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-[#11142B] border border-slate-200 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
              >
                <span>Import CSV / Excel</span>
              </button>
            )}
          </div>
        </div>
      ) : isLoadingRows && rows.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 rounded-2xl bg-white border border-purple-100 animate-pulse p-5 space-y-3"
            >
              <div className="h-14 bg-purple-100/70 rounded-xl" />
              <div className="h-4 w-2/3 bg-slate-100 rounded" />
              <div className="h-4 w-1/2 bg-slate-100 rounded" />
              <div className="h-4 w-3/4 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white/95 border border-purple-100 rounded-2xl p-8 text-center space-y-2">
          <div className="text-sm font-semibold text-[#11142B]">
            No matching {tmpl.entityPlural.toLowerCase()} found
          </div>
          <p className="text-xs text-slate-500">
            Try clearing your search, month, or status filters.
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {rows.map((row, localIdx) => {
            const actualIdx = rowIndices[localIdx] ?? localIdx;
            const risk = risks[localIdx] || null;
            const apiStatus = statuses[localIdx];
            const info = resolveRowSummary(row, actualIdx, apiStatus);
            const isDeletingThis = confirmDeleteIndex === actualIdx;

            return (
              <article
                key={`${actualIdx}-${info.idVal}`}
                className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] overflow-hidden flex flex-col justify-between transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7655E8]/30"
              >
                {/* Gradient Card Header Banner */}
                <div>
                  <div className="bg-gradient-to-r from-[#397BFF] via-[#6846DE] to-[#7655E8] px-5 py-4 text-white">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-base font-bold tracking-tight truncate">
                        {info.idVal}
                      </h3>
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md shrink-0 ${info.statusStyle}`}
                      >
                        {info.statusLabel}
                      </span>
                    </div>
                    <div className="mt-2">
                      <span className="inline-block bg-white text-[#11142B] text-[11px] font-semibold px-2.5 py-0.5 rounded-md truncate max-w-full">
                        {info.segmentVal}
                      </span>
                    </div>
                  </div>

                  {/* Structured Key-Value Rows */}
                  <div className="px-5 py-2 divide-y divide-slate-100 text-xs">
                    <div className="py-2.5 flex items-center justify-between gap-3">
                      <span className="text-slate-500">{tmpl.tenureLabel}</span>
                      <span className="font-semibold font-mono tabular-nums text-[#11142B]">
                        {info.tenureVal}
                      </span>
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-3">
                      <span className="text-slate-500">{tmpl.revenueLabel}</span>
                      <span className="font-semibold font-mono tabular-nums text-[#11142B]">
                        {info.revenueVal}
                      </span>
                    </div>

                    {info.freqVal !== null && (
                      <div className="py-2.5 flex items-center justify-between gap-3">
                        <span className="text-slate-500">Activity / Frequency</span>
                        <span className="font-semibold font-mono tabular-nums text-[#11142B]">
                          {info.freqVal}
                        </span>
                      </div>
                    )}

                    <div className="py-2.5 flex items-center justify-between gap-3">
                      <span className="text-slate-500">
                        {dateCol ? getHumanReadableFieldLabel(dateCol, formatCtx) : 'Date'}
                      </span>
                      <span className="font-semibold font-mono tabular-nums text-[#11142B]">
                        {info.dateVal}
                      </span>
                    </div>

                    {activeModel && (
                      <div className="py-2.5 flex items-center justify-between gap-3">
                        <span className="text-slate-500">Predicted Risk</span>
                        {!info.riskApplicable ? (
                          <span className="font-semibold text-slate-500">Not Applicable</span>
                        ) : risk ? (
                          <span
                            className={`font-bold font-mono tabular-nums ${
                              risk.riskCategory === 'Higher Estimated Churn Risk'
                                ? 'text-[#EA580C]'
                                : risk.riskCategory === 'Moderate Estimated Churn Risk'
                                  ? 'text-[#7655E8]'
                                  : 'text-[#059669]'
                            }`}
                          >
                            {(risk.churnProbability * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="font-semibold text-slate-400">—</span>
                        )}
                      </div>
                    )}

                    {!risk &&
                      info.extraPairs.map(([k, v]) => (
                        <div key={k} className="py-2.5 flex items-center justify-between gap-3">
                          <span className="text-slate-500 truncate" title={k}>
                            {getHumanReadableFieldLabel(k, formatCtx)}
                          </span>
                          <span className="font-semibold font-mono tabular-nums text-[#11142B] truncate max-w-[150px]">
                            {formatAttributeValue(k, v, formatCtx)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Bottom Card Actions */}
                <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setInspectTarget({
                        row,
                        rowIndex: actualIdx,
                        risk,
                        actualStatus: info.resolvedStatus,
                      })
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-[#35C5E8] hover:bg-[#1EB2D6] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>

                  {canUploadAndAnalyse && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(row, actualIdx)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-400 hover:bg-amber-500 text-[#11142B] text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      {isDeletingThis ? (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => handleConfirmDelete(actualIdx)}
                          className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteIndex(actualIdx)}
                          aria-label={`Delete ${info.idVal}`}
                          className="p-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* List View (High-Density Table) */
        <div className="bg-white/95 border border-purple-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F3FF]/70 border-b border-purple-100 text-[#4C4A6E] font-semibold">
                  <th className="py-3 px-4 whitespace-nowrap">{tmpl.entitySingular} ID</th>
                  <th className="py-3 px-4 whitespace-nowrap">{tmpl.segmentLabel}</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">{tmpl.tenureLabel}</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">{tmpl.revenueLabel}</th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    {dateCol ? getHumanReadableFieldLabel(dateCol, formatCtx) : 'Date'}
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  {activeModel && <th className="py-3 px-4 text-right whitespace-nowrap">Risk</th>}
                  <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, localIdx) => {
                  const actualIdx = rowIndices[localIdx] ?? localIdx;
                  const risk = risks[localIdx] || null;
                  const apiStatus = statuses[localIdx];
                  const info = resolveRowSummary(row, actualIdx, apiStatus);
                  const isDeletingThis = confirmDeleteIndex === actualIdx;

                  return (
                    <tr
                      key={`${actualIdx}-${info.idVal}`}
                      className="hover:bg-[#F5F3FF]/45 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-[#11142B] whitespace-nowrap">
                        {info.idVal}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {info.segmentVal}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {info.tenureVal}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {info.revenueVal}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {info.dateVal}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md ${info.statusStyle}`}
                        >
                          {info.statusLabel}
                        </span>
                      </td>
                      {activeModel && (
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                          {!info.riskApplicable ? (
                            <span className="font-sans font-semibold text-slate-500">
                              Not Applicable
                            </span>
                          ) : risk ? (
                            <span
                              className={
                                risk.riskCategory === 'Higher Estimated Churn Risk'
                                  ? 'text-[#EA580C]'
                                  : risk.riskCategory === 'Moderate Estimated Churn Risk'
                                    ? 'text-[#7655E8]'
                                    : 'text-[#059669]'
                              }
                            >
                              {(risk.churnProbability * 100).toFixed(1)}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setInspectTarget({
                                row,
                                rowIndex: actualIdx,
                                risk,
                                actualStatus: info.resolvedStatus,
                              })
                            }
                            className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded-lg cursor-pointer"
                          >
                            View
                          </button>
                          {canUploadAndAnalyse && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(row, actualIdx)}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold rounded-lg cursor-pointer"
                              >
                                Edit
                              </button>
                              {isDeletingThis ? (
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => handleConfirmDelete(actualIdx)}
                                  className="px-2.5 py-1 bg-rose-600 text-white font-semibold rounded-lg cursor-pointer"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteIndex(actualIdx)}
                                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg cursor-pointer"
                                >
                                  Delete
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Bar */}
      {dataset && total > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-600 px-1">
          <div className="font-mono tabular-nums">
            Showing {((page - 1) * pageSize + 1).toLocaleString()}–
            {Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}{' '}
            {tmpl.entityPlural.toLowerCase()}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-semibold cursor-pointer"
            >
              Previous
            </button>
            <span className="font-mono tabular-nums px-2">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-semibold cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0B0E23]/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#11142B] to-[#302064] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold">
                  {editingRowIndex !== null
                    ? `Edit ${tmpl.entitySingular}`
                    : `Add New ${tmpl.entitySingular}`}
                </h3>
                <p className="text-xs text-indigo-200/85 mt-0.5">
                  {tmpl.shortLabel} schema · Saved directly to your isolated workspace
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-4">
              {formError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 text-xs text-rose-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {formFields.map((field) => {
                  const val = formValues[field.name] ?? '';
                  return (
                    <div key={field.name} className="space-y-1">
                      <label className="block text-xs font-semibold text-[#11142B] capitalize">
                        {field.label}
                      </label>
                      {field.isTarget ? (
                        <select
                          value={val}
                          onChange={(e) =>
                            setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7655E8]/30"
                        >
                          <option value="">Pending / Unlabeled (Active Monitoring)</option>
                          <option value={dataset?.mapping.positiveClassValue || 'Yes'}>
                            Churned ({dataset?.mapping.positiveClassValue || 'Yes'})
                          </option>
                          <option value="No">Retained / Active (No)</option>
                        </select>
                      ) : (
                        <input
                          type={
                            field.dataType === 'date'
                              ? 'date'
                              : field.dataType === 'numeric'
                                ? 'number'
                                : 'text'
                          }
                          step={field.dataType === 'numeric' ? 'any' : undefined}
                          value={val}
                          onChange={(e) =>
                            setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder ? `e.g. ${field.placeholder}` : ''}
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7655E8]/30"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-[#11142B] rounded-xl border border-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 bg-[#7655E8] hover:bg-[#6645D8] text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isSaving
                    ? 'Saving...'
                    : editingRowIndex !== null
                      ? 'Save Changes'
                      : `Add ${tmpl.entitySingular}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Customer Detail Modal */}
      {inspectTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#0B0E23]/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl w-full max-w-lg max-h-[86vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#397BFF] to-[#7655E8] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold">
                  {idCol && inspectTarget.row[idCol]
                    ? inspectTarget.row[idCol]
                    : `${tmpl.entitySingular} #${inspectTarget.rowIndex + 1}`}
                </h3>
                <div className="text-xs text-white/85 mt-0.5">
                  {inspectTarget.actualStatus === 'Churned' ||
                  inspectTarget.actualStatus === 'Inconsistent'
                    ? `Actual Status: ${inspectTarget.actualStatus} · Predicted Risk: Not Applicable`
                    : inspectTarget.risk
                      ? `Actual Status: Active · Predicted Risk: ${(inspectTarget.risk.churnProbability * 100).toFixed(1)}% (${inspectTarget.risk.riskCategory})`
                      : `${tmpl.shortLabel} Record`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectTarget(null)}
                aria-label="Close detail"
                className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto divide-y divide-slate-100 text-xs">
              {Object.entries(inspectTarget.row).map(([k, v]) => (
                <div key={k} className="py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500" title={k}>
                    {getHumanReadableFieldLabel(k, formatCtx)}
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-[#11142B] text-right">
                    {formatAttributeValue(k, v, formatCtx)}
                  </span>
                </div>
              ))}
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              {canUploadAndAnalyse && (
                <button
                  type="button"
                  onClick={() => {
                    const target = inspectTarget;
                    setInspectTarget(null);
                    openEditModal(target.row, target.rowIndex);
                  }}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-500 text-[#11142B] text-xs font-bold rounded-xl cursor-pointer"
                >
                  Edit Record
                </button>
              )}
              <button
                type="button"
                onClick={() => setInspectTarget(null)}
                className="px-4 py-2 bg-[#11142B] text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
