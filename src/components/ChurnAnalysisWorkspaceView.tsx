import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  BrainCircuit,
  CheckSquare,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AnalyticsSummary,
  BatchScoreResult,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
  TrainModelRequest,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { getIndustryTemplate } from '../utils/industryConfig';
import { ChurnPredictionView } from './ChurnPredictionView';
import { ChurnSeparationOverview } from './ChurnSeparationOverview';
import { CustomerIntelligenceView } from './CustomerIntelligenceView';
import { DataAnalysisView } from './DataAnalysisView';
import { ModelEvaluationView } from './ModelEvaluationView';
import { TechnicalWorkbenchView } from './TechnicalWorkbenchView';

export type ChurnAnalysisSubTab = 'predictions' | 'patterns' | 'performance' | 'technical';

interface ChurnAnalysisWorkspaceViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  analytics: AnalyticsSummary | null;
  activeModel: ModelEvaluationResult | null;
  modelHistory: ModelEvaluationResult[];
  automationStatus: PredictionPipelineStatus | null;
  batchScores: BatchScoreResult[];
  isPipelineRunning: boolean;
  isTraining: boolean;
  canGeneratePredictions: boolean;
  section?: ChurnAnalysisSubTab;
  initialSection?: ChurnAnalysisSubTab;
  onSectionChange?: (next: ChurnAnalysisSubTab) => void;
  onAutoBuild: () => Promise<void>;
  onBatchScore: (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string }
  ) => Promise<void>;
  onTrainModel: (req: TrainModelRequest) => Promise<void>;
  onNavigate: (tab: NavTab) => void;
}

export const ChurnAnalysisWorkspaceView: React.FC<ChurnAnalysisWorkspaceViewProps> = ({
  company,
  dataset,
  analytics,
  activeModel,
  modelHistory,
  automationStatus,
  batchScores,
  isPipelineRunning,
  isTraining,
  canGeneratePredictions,
  section: controlledSection,
  initialSection = 'predictions',
  onSectionChange,
  onAutoBuild,
  onBatchScore,
  onTrainModel,
  onNavigate,
}) => {
  const [internalSection, setInternalSection] = useState<ChurnAnalysisSubTab>(initialSection);
  const [periodAnalytics, setPeriodAnalytics] = useState<AnalyticsSummary | null>(analytics);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [isFilteringPeriod, setIsFilteringPeriod] = useState(false);
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);

  useEffect(() => {
    setInternalSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setPeriodAnalytics(analytics);
    setSelectedPeriod(analytics?.historicalPerformance?.selectedPeriod || 'ALL');
  }, [analytics, dataset?.datasetId]);

  const handlePeriodChange = async (nextPeriod: string) => {
    setSelectedPeriod(nextPeriod);
    if (nextPeriod === 'ALL') {
      setPeriodAnalytics(analytics);
      return;
    }
    setIsFilteringPeriod(true);
    try {
      const res = await apiFetch('/api/analytics/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportingPeriod: nextPeriod }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.analytics) {
          setPeriodAnalytics(data.analytics);
        }
      }
    } finally {
      setIsFilteringPeriod(false);
    }
  };

  const section = controlledSection ?? internalSection;
  const setSection = (next: ChurnAnalysisSubTab) => {
    setInternalSection(next);
    onSectionChange?.(next);
  };

  const displayAnalytics = periodAnalytics || analytics;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#7655E8]">{company.name}</span>
            <span aria-hidden="true">·</span>
            <span>{tmpl.shortLabel}</span>
            {activeModel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#0E9F6E] font-semibold">
                  Model Active ({activeModel.accuracy.toFixed(1)}% accuracy)
                </span>
              </>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#11142B] tracking-tight mt-0.5">
            Churn Analysis
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Understand why customers leave, inspect individual churn risk predictions, and review model accuracy.
          </p>
        </div>

        <div
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-white border border-purple-100 rounded-xl shadow-xs self-start lg:self-auto"
          role="tablist"
          aria-label="Churn Analysis subsections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === 'predictions'}
            onClick={() => setSection('predictions')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'predictions'
                ? 'bg-[#11142B] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
            }`}
          >
            <BrainCircuit
              className={`w-3.5 h-3.5 ${section === 'predictions' ? 'text-[#35C5E8]' : 'text-[#7655E8]'}`}
            />
            <span>Predictions &amp; Drivers</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={section === 'patterns'}
            onClick={() => setSection('patterns')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'patterns'
                ? 'bg-[#11142B] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
            }`}
          >
            <BarChart3
              className={`w-3.5 h-3.5 ${section === 'patterns' ? 'text-[#35C5E8]' : 'text-[#7655E8]'}`}
            />
            <span>Patterns &amp; Insights</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={section === 'performance' || section === 'technical'}
            onClick={() => setSection('performance')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'performance' || section === 'technical'
                ? 'bg-[#11142B] text-white shadow-xs'
                : 'text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF]'
            }`}
          >
            <CheckSquare
              className={`w-3.5 h-3.5 ${
                section === 'performance' || section === 'technical'
                  ? 'text-[#35C5E8]'
                  : 'text-[#7655E8]'
              }`}
            />
            <span>Model Performance</span>
          </button>
        </div>
      </div>

      {(section === 'predictions' || section === 'patterns') && dataset && displayAnalytics && (
        <ChurnSeparationOverview
          analytics={displayAnalytics}
          entityPlural={tmpl.entityPlural}
          selectedPeriod={selectedPeriod}
          isFilteringPeriod={isFilteringPeriod}
          onPeriodChange={handlePeriodChange}
        />
      )}

      {section === 'predictions' && (
        <ChurnPredictionView
          company={company}
          dataset={dataset}
          activeModel={activeModel}
          automationStatus={automationStatus}
          batchScores={batchScores}
          isBuilding={isPipelineRunning}
          canGeneratePredictions={canGeneratePredictions}
          onAutoBuild={onAutoBuild}
          onBatchScore={onBatchScore}
          onNavigate={(tab) => {
            if (tab === 'performance') {
              setSection('performance');
            } else if (tab === 'technical') {
              setSection('technical');
            } else {
              onNavigate(tab);
            }
          }}
        />
      )}

      {section === 'patterns' && (
        <div className="space-y-8">
          <CustomerIntelligenceView
            company={company}
            dataset={dataset}
            analytics={analytics}
            activeModel={activeModel}
            automationStatus={automationStatus}
            isPipelineRunning={isPipelineRunning}
            canGeneratePredictions={canGeneratePredictions}
            embedded
            onAutoBuild={onAutoBuild}
            onNavigate={(tab) => {
              if (tab === 'predictions') {
                setSection('predictions');
              } else {
                onNavigate(tab);
              }
            }}
          />

          {dataset && analytics && (
            <div className="pt-4 border-t border-purple-100">
              <DataAnalysisView
                company={company}
                dataset={dataset}
                analytics={analytics}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </div>
      )}

      {(section === 'performance' || section === 'technical') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-purple-100 rounded-xl px-4 py-3">
            <div className="text-xs text-slate-600">
              {section === 'performance'
                ? 'Viewing plain-language model quality, accuracy, and key churn drivers.'
                : 'Viewing advanced algorithm tuning, custom train/test split, and version history.'}
            </div>
            <button
              type="button"
              onClick={() =>
                setSection(section === 'technical' ? 'performance' : 'technical')
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-[#F5F3FF]/70 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>
                {section === 'technical'
                  ? 'Back to Model Summary'
                  : 'Advanced Model Tuning'}
              </span>
            </button>
          </div>

          {section === 'performance' ? (
            <ModelEvaluationView
              company={company}
              activeModel={activeModel}
              automationStatus={automationStatus}
              isBuilding={isPipelineRunning}
              canGeneratePredictions={canGeneratePredictions}
              onAutoBuild={onAutoBuild}
              onNavigate={(tab) => {
                if (tab === 'technical') {
                  setSection('technical');
                } else if (tab === 'predictions') {
                  setSection('predictions');
                } else {
                  onNavigate(tab);
                }
              }}
            />
          ) : (
            <TechnicalWorkbenchView
              company={company}
              dataset={dataset}
              activeModel={activeModel}
              modelHistory={modelHistory}
              automationStatus={automationStatus}
              isTraining={isTraining}
              canGeneratePredictions={canGeneratePredictions}
              onTrainModel={onTrainModel}
              onNavigate={(tab) => {
                if (tab === 'predictions') {
                  setSection('predictions');
                } else if (tab === 'performance') {
                  setSection('performance');
                } else {
                  onNavigate(tab);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
