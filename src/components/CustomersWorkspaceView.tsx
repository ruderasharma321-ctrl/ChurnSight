import React, { useEffect, useState } from 'react';
import { Gem, Users } from 'lucide-react';
import {
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
} from '../types/churn';
import { getIndustryTemplate } from '../utils/industryConfig';
import { CustomerDirectorySection } from './CustomerDirectorySection';
import { CustomerValueView } from './CustomerValueView';

export type CustomersSubTab = 'profiles' | 'value';

interface CustomersWorkspaceViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  activeModel: ModelEvaluationResult | null;
  canUploadAndAnalyse: boolean;
  section?: CustomersSubTab;
  initialSection?: CustomersSubTab;
  onSectionChange?: (next: CustomersSubTab) => void;
  onWorkspaceMutated: (payload: Record<string, any>) => void;
  onNavigate: (tab: NavTab) => void;
}

export const CustomersWorkspaceView: React.FC<CustomersWorkspaceViewProps> = ({
  company,
  dataset,
  activeModel,
  canUploadAndAnalyse,
  section: controlledSection,
  initialSection = 'profiles',
  onSectionChange,
  onWorkspaceMutated,
  onNavigate,
}) => {
  const [internalSection, setInternalSection] = useState<CustomersSubTab>(initialSection);
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);

  useEffect(() => {
    setInternalSection(initialSection);
  }, [initialSection]);

  const section = controlledSection ?? internalSection;
  const selectSection = (next: CustomersSubTab) => {
    setInternalSection(next);
    onSectionChange?.(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#7655E8]">{company.name}</span>
            <span aria-hidden="true">·</span>
            <span>{tmpl.shortLabel}</span>
            {dataset && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {dataset.rowCount.toLocaleString()} {tmpl.entityPlural.toLowerCase()}
                </span>
              </>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#11142B] tracking-tight mt-0.5">
            Customers
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Inspect customer profiles, value segments, churn risk, and revenue exposure in one place.
          </p>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-white border border-purple-100 rounded-xl shadow-xs self-start md:self-auto"
          role="tablist"
          aria-label="Customers subsections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === 'profiles'}
            onClick={() => selectSection('profiles')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'profiles'
                ? 'bg-[#11142B] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
            }`}
          >
            <Users className={`w-3.5 h-3.5 ${section === 'profiles' ? 'text-[#35C5E8]' : 'text-[#7655E8]'}`} />
            <span>Customer Profiles</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'value'}
            onClick={() => selectSection('value')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'value'
                ? 'bg-[#11142B] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
            }`}
          >
            <Gem className={`w-3.5 h-3.5 ${section === 'value' ? 'text-[#35C5E8]' : 'text-[#7655E8]'}`} />
            <span>Value &amp; Risk Intelligence</span>
          </button>
        </div>
      </div>

      {section === 'profiles' && (
        <CustomerDirectorySection
          company={company}
          dataset={dataset}
          activeModel={activeModel}
          canUploadAndAnalyse={canUploadAndAnalyse}
          onWorkspaceMutated={onWorkspaceMutated}
          onNavigateData={() => onNavigate('data')}
        />
      )}

      {section === 'value' && (
        <CustomerValueView
          company={company}
          datasetId={dataset?.datasetId || null}
          canEditConfig={canUploadAndAnalyse}
          embedded
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};
