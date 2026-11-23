import { jsPDF } from 'jspdf';
import type {
  AnalyticsSummary,
  BatchScoreResult,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
} from '../types/churn';
import { formatFeatureDisplayName, formatReadableDate } from './formatters';
import { getIndustryTemplate } from './industryConfig';

function sanitizeCsvField(val: string | number | null | undefined): string {
  const s = val === null || val === undefined ? '' : String(val);
  const formulaSafe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (formulaSafe.includes(',') || formulaSafe.includes('"') || formulaSafe.includes('\n')) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

function triggerTextDownload(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function addPdfHeader(
  doc: jsPDF,
  company: CompanyWorkspaceInfo,
  title: string,
  subtitle: string
): number {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  doc.setFillColor(17, 20, 43);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(`ChurnSight · ${title}`, 14, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`${company.name} · ${tmpl.label} · ${company.country}`, 14, 21);
  doc.text(`Generated ${formatReadableDate(new Date(), { includeTime: true })} · ${subtitle}`, 14, 27);
  doc.setTextColor(17, 20, 43);
  return 44;
}

export function exportChurnSummaryCsv(
  company: CompanyWorkspaceInfo,
  dataset: DatasetState,
  analytics: AnalyticsSummary
): void {
  const hp = analytics.historicalPerformance;
  const rateText =
    hp && !hp.historicalRateReliable
      ? 'Unavailable'
      : `${(hp?.historicalChurnRate ?? analytics.churnRate).toFixed(1)}%`;
  const lines: string[] = [
    ['Section', 'Metric', 'Value', 'Notes'].map(sanitizeCsvField).join(','),
    ['Workspace', 'Company', company.name, company.industry].map(sanitizeCsvField).join(','),
    ['Dataset', 'Source File', dataset.fileName, dataset.isSample ? 'Demonstration Data' : 'Company Upload']
      .map(sanitizeCsvField)
      .join(','),
    ['Dataset', 'Rows', dataset.rowCount, `${dataset.columnCount} columns`].map(sanitizeCsvField).join(','),
    ['KPI', 'Valid Labeled Records', analytics.totalCustomers, ''].map(sanitizeCsvField).join(','),
    ['KPI', 'Already Churned Customers', hp?.actualChurnedCount ?? analytics.churnedCount, `Target = ${dataset.mapping.positiveClassValue}`]
      .map(sanitizeCsvField)
      .join(','),
    ['KPI', 'Retained (Active) Customers', hp?.retainedCount ?? analytics.stayedCount, ''].map(sanitizeCsvField).join(','),
    ['KPI', 'Historical Churn Rate (%)', rateText, hp?.historicalRateNotice || analytics.calculationExplanation || '']
      .map(sanitizeCsvField)
      .join(','),
  ];

  if (analytics.contractStats) {
    for (const s of analytics.contractStats) {
      lines.push(
        ['Segment Breakdown', s.category, `${s.churnRate.toFixed(1)}%`, `${s.churned}/${s.total} churned`]
          .map(sanitizeCsvField)
          .join(',')
      );
    }
  }
  if (analytics.tenureStats) {
    for (const s of analytics.tenureStats) {
      lines.push(
        ['Tenure Cohort', s.category, `${s.churnRate.toFixed(1)}%`, `${s.churned}/${s.total} churned`]
          .map(sanitizeCsvField)
          .join(',')
      );
    }
  }

  triggerTextDownload(
    lines.join('\n'),
    `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_churn_summary.csv`,
    'text/csv;charset=utf-8'
  );
}

export function exportChurnSummaryPdf(
  company: CompanyWorkspaceInfo,
  dataset: DatasetState,
  analytics: AnalyticsSummary,
  activeModel: ModelEvaluationResult | null
): void {
  const doc = new jsPDF();
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  let y = addPdfHeader(
    doc,
    company,
    'Customer Churn Executive Report',
    dataset.isSample ? 'Demonstration Dataset' : dataset.fileName
  );

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Portfolio & Churn Definition Summary', 14, y);
  y += 7;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  const hp = analytics.historicalPerformance;
  const rateText =
    hp && !hp.historicalRateReliable
      ? `Unavailable (${hp.historicalRateNotice || 'Insufficient historical period or outcome data'})`
      : `${(hp?.historicalChurnRate ?? analytics.churnRate).toFixed(1)}%`;
  const summaryLines = [
    `Dataset: ${dataset.fileName}${dataset.isSample ? ' (Demonstration Data)' : ''} (${dataset.rowCount.toLocaleString()} records, ${dataset.columnCount} columns)`,
    `Total ${tmpl.entityPlural}: ${analytics.totalCustomers.toLocaleString()} | Already Churned: ${(hp?.actualChurnedCount ?? analytics.churnedCount).toLocaleString()} | Active: ${(hp?.retainedCount ?? analytics.stayedCount).toLocaleString()}`,
    `Historical Churn Rate: ${rateText}`,
  ];
  for (const line of summaryLines) {
    const wrapped = doc.splitTextToSize(line, 182);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5.2;
  }

  if (analytics.calculationExplanation) {
    const wrapped = doc.splitTextToSize(`Formula: ${analytics.calculationExplanation}`, 182);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5 + 3;
  }

  if (analytics.contractStats && analytics.contractStats.length > 0) {
    y += 3;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`2. ${tmpl.segmentLabel} Breakdown`, 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    for (const s of analytics.contractStats.slice(0, 8)) {
      doc.text(
        `- ${s.category}: ${s.churnRate.toFixed(1)}% churn (${s.churned} churned / ${s.total} total)`,
        16,
        y
      );
      y += 5;
    }
  }

  if (activeModel) {
    y += 5;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('3. Active Predictive Model Snapshot', 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Model: ${activeModel.modelName} (${activeModel.version}) | Split: ${activeModel.splitStrategy || 'stratified'}`,
      14,
      y
    );
    y += 5;
    doc.text(
      `Test Accuracy: ${activeModel.accuracy.toFixed(1)}% | Precision: ${activeModel.precision.toFixed(1)}% | Recall: ${activeModel.recall.toFixed(1)}% | F1-Score: ${activeModel.f1Score.toFixed(1)}%`,
      14,
      y
    );
    y += 6;

    doc.text('Top Predictive Features:', 14, y);
    y += 5;
    for (const f of activeModel.featureImportances.slice(0, 6)) {
      doc.text(
        `- ${formatFeatureDisplayName(f.feature, { dataset, company })}: ${f.importance.toFixed(1)}% impact share`,
        16,
        y
      );
      y += 4.8;
    }
  }

  doc.save(`${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_churn_report.pdf`);
}

export function exportDatasetSummaryCsv(
  company: CompanyWorkspaceInfo,
  dataset: DatasetState
): void {
  const header = ['Column', 'DataType', 'SemanticRole', 'UniqueCount', 'MissingCount', 'MissingPercent', 'SampleValues'];
  const lines = [header.join(',')];
  for (const col of dataset.columns) {
    lines.push(
      [
        col.name,
        col.dataType,
        col.semanticRole || 'other',
        col.uniqueCount,
        col.missingCount,
        `${col.missingPercent}%`,
        col.sampleValues.join(' | '),
      ]
        .map(sanitizeCsvField)
        .join(',')
    );
  }
  triggerTextDownload(
    lines.join('\n'),
    `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_dataset_summary.csv`,
    'text/csv;charset=utf-8'
  );
}

export function exportModelEvaluationPdf(
  company: CompanyWorkspaceInfo,
  model: ModelEvaluationResult
): void {
  const doc = new jsPDF();
  let y = addPdfHeader(
    doc,
    company,
    'Model Evaluation Report',
    `${model.modelName} (${model.version})`
  );

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Model Configuration & Validation Split', 14, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Algorithm: ${model.modelName} (${model.version})`, 14, y);
  y += 5;
  doc.text(
    `Split Strategy: ${model.splitStrategy || 'stratified'}${model.dateColumnUsed ? ` (Ordered by ${model.dateColumnUsed})` : ''}`,
    14,
    y
  );
  y += 5;
  doc.text(
    `Training Rows: ${model.trainCount.toLocaleString()} | Unseen Test Rows: ${model.testCount.toLocaleString()} | Trained At: ${formatReadableDate(model.trainedAt, { includeTime: true })}`,
    14,
    y
  );
  y += 8;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Held-Out Test Set Metrics', 14, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Accuracy: ${model.accuracy.toFixed(1)}% (Baseline: ${model.majorityBaselineAccuracy.toFixed(1)}%)`,
    14,
    y
  );
  y += 5;
  doc.text(
    `Precision: ${model.precision.toFixed(1)}% | Recall: ${model.recall.toFixed(1)}% | F1-Score: ${model.f1Score.toFixed(1)}%`,
    14,
    y
  );
  y += 5;
  const cm = model.confusionMatrix;
  doc.text(
    `Confusion Matrix -> TP: ${cm.tp}, TN: ${cm.tn}, FP: ${cm.fp}, FN: ${cm.fn}`,
    14,
    y
  );
  y += 8;

  if (model.leakageWarnings && model.leakageWarnings.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('3. Target Leakage Audit Warnings', 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    for (const w of model.leakageWarnings) {
      const wrapped = doc.splitTextToSize(`- ${w}`, 180);
      doc.text(wrapped, 14, y);
      y += wrapped.length * 4.8 + 1;
    }
    y += 3;
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Top Influential Predictive Signals', 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  for (const f of model.featureImportances.slice(0, 10)) {
    const dir =
      f.coefficient !== undefined
        ? ` (beta=${f.coefficient >= 0 ? '+' : ''}${f.coefficient.toFixed(3)})`
        : '';
    doc.text(`- ${formatFeatureDisplayName(f.feature, { company })}: ${f.importance.toFixed(1)}%${dir}`, 16, y);
    y += 5;
  }

  doc.save(`${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_model_evaluation_${model.version}.pdf`);
}

export function exportCustomerRiskPdf(
  company: CompanyWorkspaceInfo,
  model: ModelEvaluationResult,
  batch?: BatchScoreResult | null
): void {
  const doc = new jsPDF();
  const title = batch ? 'Batch Customer Risk Report' : 'Customer Risk Scoring Report';
  let y = addPdfHeader(
    doc,
    company,
    title,
    batch ? `${batch.fileName} · ${model.version}` : `${model.modelName} · ${model.version}`
  );

  const rows = batch
    ? [...batch.records].sort((a, b) => b.churnProbability - a.churnProbability).slice(0, 30)
    : [...model.predictions]
        .filter(
          (p) =>
            p.riskApplicable !== false &&
            p.actualStatus !== 'Churned' &&
            p.actualStatus !== 'Inconsistent' &&
            p.actualChurn !== 'Churned'
        )
        .sort((a, b) => b.churnProbability - a.churnProbability)
        .slice(0, 30);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Highest Estimated Risk Active Accounts (Top ${rows.length})`, 14, y);
  y += 6;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'Probabilities below apply strictly to Active customers; already-churned customers are excluded.',
    14,
    y
  );
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Row', 14, y);
  doc.text('Customer ID', 28, y);
  doc.text('Actual Status', 82, y);
  doc.text('Predicted Prob.', 118, y);
  doc.text('Predicted Risk', 155, y);
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  for (const r of rows) {
    if (y > 278) {
      doc.addPage();
      y = 20;
    }
    const actualStatusText =
      'actualStatus' in r && typeof r.actualStatus === 'string' && r.actualStatus
        ? r.actualStatus
        : 'Active';
    const isApplicable =
      actualStatusText !== 'Churned' &&
      actualStatusText !== 'Inconsistent' &&
      (!('riskApplicable' in r) || r.riskApplicable !== false);
    const riskTierLabel = !isApplicable
      ? 'Not Applicable'
      : r.riskCategory === 'Higher Estimated Churn Risk'
        ? 'High Risk'
        : r.riskCategory === 'Moderate Estimated Churn Risk'
          ? 'Medium Risk'
          : 'Low Risk';

    doc.text(String(r.rowIndex), 14, y);
    doc.text(String(r.customerId).slice(0, 24), 28, y);
    doc.text(actualStatusText, 82, y);
    doc.text(isApplicable ? `${(r.churnProbability * 100).toFixed(1)}%` : 'Not Applicable', 118, y);
    doc.text(riskTierLabel, 155, y);
    y += 5.2;
  }

  doc.save(`${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_customer_risk_report.pdf`);
}
