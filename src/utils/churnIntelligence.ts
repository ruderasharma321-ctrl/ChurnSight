import {
  AnalyticsSummary,
  CategoryChurnStat,
  DatasetState,
  IndustryKey,
  ModelEvaluationResult,
} from '../types/churn';
import { getIndustryTemplate } from './industryConfig';

export type InsightTone = 'danger' | 'purple' | 'blue' | 'cyan' | 'emerald';

export interface CustomerIntelligenceInsight {
  id: string;
  category: string;
  title: string;
  statLabel: string;
  statValue: string;
  explanation: string;
  recommendation: string;
  tone: InsightTone;
  meterPercent: number;
}

function pickSignificantTopChurn(stats: CategoryChurnStat[], minTotal = 5): CategoryChurnStat | null {
  const valid = stats.filter((s) => s.total > 0);
  if (valid.length === 0) return null;
  const meaningful = valid.filter((s) => s.total >= minTotal);
  const pool = meaningful.length > 0 ? meaningful : valid;
  return [...pool].sort((a, b) => b.churnRate - a.churnRate || b.churned - a.churned)[0];
}

function pickSignificantLowestChurn(stats: CategoryChurnStat[], minTotal = 5): CategoryChurnStat | null {
  const valid = stats.filter((s) => s.total > 0);
  if (valid.length === 0) return null;
  const meaningful = valid.filter((s) => s.total >= minTotal);
  const pool = meaningful.length > 0 ? meaningful : valid;
  return [...pool].sort((a, b) => a.churnRate - b.churnRate || b.stayed - a.stayed)[0];
}

export function deriveCustomerIntelligence(
  dataset: DatasetState,
  analytics: AnalyticsSummary,
  activeModel: ModelEvaluationResult | null,
  industry?: IndustryKey,
  customIndustryName?: string | null
): CustomerIntelligenceInsight[] {
  const insights: CustomerIntelligenceInsight[] = [];
  const tmpl = getIndustryTemplate(industry, customIndustryName);
  const entityLower = tmpl.entityPlural.toLowerCase();

  // Cold-start / Unlabeled Dataset Intelligence Mode
  if (analytics.isUnlabeledColdStart || dataset.hasValidChurnLabels === false) {
    const bm = analytics.behaviourMonitoring;
    const total = analytics.totalCustomers;

    // 1. Portfolio Scale & Leading Segment
    const topCategory =
      analytics.contractStats && analytics.contractStats.length > 0
        ? [...analytics.contractStats].sort((a, b) => b.total - a.total)[0]
        : null;
    if (topCategory) {
      const share = total > 0 ? (topCategory.total / total) * 100 : 0;
      insights.push({
        id: 'cold-start-segment',
        category: `Cold-Start Portfolio · ${tmpl.segmentLabel}`,
        title: `Largest Active Segment: "${topCategory.category}"`,
        statLabel: 'Segment Share',
        statValue: `${share.toFixed(1)}%`,
        explanation: `${topCategory.total.toLocaleString()} of ${total.toLocaleString()} active ${entityLower} belong to "${topCategory.category}". Historical churn labels are not yet present, so ChurnSight is operating in descriptive + behaviour monitoring mode.`,
        recommendation: `Track renewal dates and observed outcomes across "${topCategory.category}" accounts using Record Observed Outcome in Data Management.`,
        tone: 'purple',
        meterPercent: Math.min(100, Math.max(12, share)),
      });
    } else {
      insights.push({
        id: 'cold-start-portfolio',
        category: 'Cold-Start Portfolio Overview',
        title: `${total.toLocaleString()} Active ${tmpl.entityPlural} Monitored`,
        statLabel: 'Tracked Population',
        statValue: total.toLocaleString(),
        explanation: `${dataset.fileName} is active in descriptive analytics mode without confirmed two-class historical churn labels.`,
        recommendation: 'Map a Segment or Value column in Data Management to deepen cohort segmentation.',
        tone: 'purple',
        meterPercent: 65,
      });
    }

    // 2. Behaviour Monitoring & Inactivity Watchlist
    if (bm) {
      const watchlistPct = total > 0 ? (bm.inactivityWatchlistCount / total) * 100 : 0;
      insights.push({
        id: 'cold-start-watchlist',
        category: 'Behaviour Monitoring Watchlist',
        title:
          bm.inactivityWatchlistCount > 0
            ? `${bm.inactivityWatchlistCount.toLocaleString()} Inactive / Quiet ${tmpl.entityPlural} Flagged`
            : 'All Monitored Accounts Within Normal Activity Window',
        statLabel: bm.inactivityThresholdDays
          ? `Threshold (${bm.inactivityThresholdDays}d)`
          : 'Low-Engagement Accounts',
        statValue:
          bm.inactivityWatchlistCount > 0
            ? `${bm.inactivityWatchlistCount} flagged`
            : `${bm.lowEngagementCount} low-usage`,
        explanation: `Monitoring ${bm.signalsDetected.join(', ') || 'account attributes'} across ${bm.activeAccountsCount.toLocaleString()} records. Note: inactivity flags prompt review and are never treated as confirmed churn unless configured in your Churn Definition.`,
        recommendation:
          bm.inactivityWatchlistCount > 0
            ? 'Review the Behaviour Watchlist table, run outreach check-ins, and record confirmed Churned or Retained outcomes as they occur.'
            : 'Continue collecting activity timestamps and engagement counts to surface early drop-off signals.',
        tone: bm.inactivityWatchlistCount > 0 ? 'danger' : 'emerald',
        meterPercent: Math.min(100, Math.max(15, bm.inactivityWatchlistCount > 0 ? Math.max(25, watchlistPct) : 82)),
      });
    }

    // 3. Value / Spend Baseline
    if (analytics.monthlyChargesComparison) {
      const mc = analytics.monthlyChargesComparison;
      insights.push({
        id: 'cold-start-revenue',
        category: tmpl.revenueLabel,
        title: `Active Portfolio Mean: $${mc.overallAvg.toFixed(2)}`,
        statLabel: `Mean ${mc.columnName}`,
        statValue: `$${mc.overallAvg.toFixed(2)}`,
        explanation: `Across ${total.toLocaleString()} monitored ${entityLower}, average "${mc.columnName}" is $${mc.overallAvg.toFixed(2)}. Once historical outcomes accumulate, ChurnSight will compare retained vs. churned spend directly.`,
        recommendation: `Focus proactive retention check-ins on high-value accounts showing declining ${tmpl.frequencyLabel.toLowerCase()} or approaching renewal.`,
        tone: 'blue',
        meterPercent: 68,
      });
    }

    // 4. Readiness Path to Prediction
    const readiness = dataset.readiness;
    insights.push({
      id: 'cold-start-readiness-path',
      category: 'Prediction Readiness Status',
      title: readiness?.predictionReady.ready
        ? 'Prediction Ready'
        : 'Accumulating Observed Churn Outcomes',
      statLabel: 'Data Readiness Score',
      statValue: `${readiness?.readinessScore ?? 55}/100`,
      explanation:
        readiness?.predictionReady.blockers[0] ||
        dataset.churnReadinessMessage ||
        'Supervised churn predictions remain paused until sufficient confirmed Churned and Retained outcomes are recorded.',
      recommendation:
        readiness?.nextActions[0] ||
        'Record observed Churned / Retained outcomes in the Data Readiness Centre to unlock automated ML scoring.',
      tone: 'cyan',
      meterPercent: Math.min(100, Math.max(12, readiness?.readinessScore ?? 55)),
    });

    return insights;
  }

  // 1. Highest-Risk Customer Segment across all detected categorical dimensions
  let topSegment: { dimension: string; stat: CategoryChurnStat } | null = null;
  for (const [dimension, list] of Object.entries(analytics.categoricalBreakdowns || {})) {
    const candidate = pickSignificantTopChurn(list, 8);
    if (
      candidate &&
      (!topSegment || candidate.churnRate > topSegment.stat.churnRate)
    ) {
      topSegment = { dimension, stat: candidate };
    }
  }

  if (topSegment) {
    const { dimension, stat } = topSegment;
    const rateReliable = analytics.historicalPerformance?.historicalRateReliable !== false;
    insights.push({
      id: 'highest-risk-group',
      category: 'Highest Historical Churn Segment',
      title: `${dimension}: "${stat.category}"`,
      statLabel: 'Segment Historical Churn',
      statValue: `${stat.churnRate.toFixed(1)}%`,
      explanation: rateReliable
        ? `${stat.churned.toLocaleString()} of ${stat.total.toLocaleString()} ${entityLower} in "${stat.category}" have already churned—${
            stat.churnRate >= analytics.churnRate
              ? `${(stat.churnRate - analytics.churnRate).toFixed(1)} pts above`
              : `${(analytics.churnRate - stat.churnRate).toFixed(1)} pts below`
          } the ${analytics.churnRate.toFixed(1)}% historical average.`
        : `${stat.churned.toLocaleString()} of ${stat.total.toLocaleString()} ${entityLower} in "${stat.category}" have recorded churned status.`,
      recommendation: `Prioritise proactive retention campaigns and onboarding check-ins for active ${dimension} = "${stat.category}" accounts.`,
      tone: 'danger',
      meterPercent: Math.min(100, Math.max(8, stat.churnRate)),
    });
  }

  // 2. Primary Segment / Contract Pattern
  if (analytics.contractStats && analytics.contractStats.length >= 2) {
    const highest = pickSignificantTopChurn(analytics.contractStats, 3);
    const lowest = pickSignificantLowestChurn(analytics.contractStats, 3);
    if (highest && lowest && highest.category !== lowest.category) {
      const gap = Math.max(0, highest.churnRate - lowest.churnRate);
      insights.push({
        id: 'contract-pattern',
        category: tmpl.segmentLabel,
        title: `"${highest.category}" vs "${lowest.category}"`,
        statLabel: 'Segment Churn Gap',
        statValue: `+${gap.toFixed(1)} pts`,
        explanation: `${highest.category} accounts exhibit ${highest.churnRate.toFixed(
          1
        )}% churn (${highest.churned}/${highest.total}), compared with ${lowest.churnRate.toFixed(
          1
        )}% (${lowest.churned}/${lowest.total}) in ${lowest.category}.`,
        recommendation: `Incentivise "${highest.category}" ${entityLower} with loyalty or multi-period renewal benefits to migrate toward "${lowest.category}".`,
        tone: 'purple',
        meterPercent: Math.min(100, Math.max(10, highest.churnRate)),
      });
    }
  }

  // 3. Tenure / Lifecycle Cohort Pattern
  if (analytics.tenureStats && analytics.tenureStats.length >= 2) {
    const nonEmptyTenure = analytics.tenureStats.filter((t) => t.total > 0);
    const peakTenure = pickSignificantTopChurn(nonEmptyTenure, 3);
    const stableTenure = pickSignificantLowestChurn(nonEmptyTenure, 3);
    if (peakTenure && stableTenure) {
      insights.push({
        id: 'tenure-pattern',
        category: `${tmpl.tenureLabel} Lifecycle`,
        title: `Peak Attrition in ${peakTenure.category}`,
        statLabel: 'Peak Cohort Churn',
        statValue: `${peakTenure.churnRate.toFixed(1)}%`,
        explanation: `Churn peaks during ${peakTenure.category} (${peakTenure.churned} of ${peakTenure.total} ${entityLower}) and drops to ${stableTenure.churnRate.toFixed(
          1
        )}% in the ${stableTenure.category} cohort.`,
        recommendation: `Focus early-lifecycle engagement and adoption milestones before ${entityLower} reach the ${peakTenure.category} inflection window.`,
        tone: 'blue',
        meterPercent: Math.min(100, Math.max(10, peakTenure.churnRate)),
      });
    }
  }

  // 4. Engagement Frequency or Payment Method or Revenue Signal
  if (analytics.frequencyComparison) {
    const fc = analytics.frequencyComparison;
    const diff = fc.stayedAvg - fc.churnedAvg;
    insights.push({
      id: 'frequency-signal',
      category: tmpl.frequencyLabel,
      title:
        diff >= 0
          ? `Higher ${fc.columnName} Correlates with Retention`
          : `Churned Accounts Show Elevated ${fc.columnName}`,
      statLabel: 'Retained vs Churned Mean',
      statValue: `${fc.stayedAvg.toFixed(1)} vs ${fc.churnedAvg.toFixed(1)}`,
      explanation: `Retained ${entityLower} averaged ${fc.stayedAvg.toFixed(
        2
      )} on "${fc.columnName}" compared with ${fc.churnedAvg.toFixed(2)} among churned records.`,
      recommendation:
        diff >= 0
          ? `Monitor drops in ${fc.columnName} as an early warning signal to trigger automated outreach.`
          : `Investigate friction spikes in "${fc.columnName}" driving elevated attrition.`,
      tone: 'cyan',
      meterPercent: Math.min(100, Math.max(15, fc.stayedAvg > 0 ? (fc.churnedAvg / fc.stayedAvg) * 75 : 50)),
    });
  } else if (analytics.paymentMethodStats && analytics.paymentMethodStats.length >= 2) {
    const highestPay = pickSignificantTopChurn(analytics.paymentMethodStats, 3);
    const lowestPay = pickSignificantLowestChurn(analytics.paymentMethodStats, 3);
    if (highestPay && lowestPay) {
      insights.push({
        id: 'payment-pattern',
        category: 'Billing & Payment',
        title: `${highestPay.category} Leads Payment Churn`,
        statLabel: 'Payment Churn Rate',
        statValue: `${highestPay.churnRate.toFixed(1)}%`,
        explanation: `${tmpl.entityPlural} paying via ${highestPay.category} churn at ${highestPay.churnRate.toFixed(
          1
        )}% (${highestPay.churned}/${highestPay.total}), versus ${lowestPay.churnRate.toFixed(
          1
        )}% for ${lowestPay.category}.`,
        recommendation: `Encourage automatic payment enrollment (${lowestPay.category}) to reduce involuntary and friction-driven cancellations.`,
        tone: 'cyan',
        meterPercent: Math.min(100, Math.max(10, highestPay.churnRate)),
      });
    }
  } else if (analytics.monthlyChargesComparison) {
    const mc = analytics.monthlyChargesComparison;
    const delta = mc.churnedAvg - mc.stayedAvg;
    insights.push({
      id: 'monthly-charges',
      category: tmpl.revenueLabel,
      title:
        delta >= 0
          ? `Churned Accounts Carry Higher ${mc.columnName}`
          : `Lower-${mc.columnName} Accounts Churn More Often`,
      statLabel: 'Mean Value Delta',
      statValue: `${delta >= 0 ? '+' : '-'}$${Math.abs(delta).toFixed(2)}`,
      explanation: `Churned ${entityLower} averaged $${mc.churnedAvg.toFixed(
        2
      )} versus $${mc.stayedAvg.toFixed(2)} among retained ${entityLower} across ${dataset.rowCount.toLocaleString()} records.`,
      recommendation:
        delta >= 0
          ? `Review pricing perception and value delivery for higher ${tmpl.revenueLabel} cohorts.`
          : `Provide targeted onboarding incentives to increase engagement among lower-spend accounts.`,
      tone: 'cyan',
      meterPercent: Math.min(
        100,
        Math.max(
          15,
          Math.max(mc.churnedAvg, mc.stayedAvg) > 0
            ? (mc.churnedAvg / Math.max(mc.churnedAvg, mc.stayedAvg)) * 85
            : 50
        )
      ),
    });
  }

  // 5. Retention Opportunity / ML Model Driver
  if (activeModel && activeModel.featureImportances.length > 0) {
    const topDriver =
      activeModel.featureImportances.find((f) => f.direction === 'increases_churn') ||
      activeModel.featureImportances[0];
    const highRiskCount = activeModel.predictions.filter(
      (p) =>
        p.riskApplicable !== false &&
        p.actualStatus !== 'Churned' &&
        p.actualStatus !== 'Inconsistent' &&
        p.actualChurn !== 'Churned' &&
        p.riskCategory === 'Higher Estimated Churn Risk'
    ).length;

    insights.push({
      id: 'ml-retention-opportunity',
      category: 'ML Retention Opportunity',
      title: `Top Driver: ${topDriver.feature}`,
      statLabel: 'Model Feature Share',
      statValue: `${topDriver.importance.toFixed(1)}%`,
      explanation: `${activeModel.modelName} (${activeModel.version}, ${activeModel.accuracy.toFixed(
        1
      )}% test accuracy) identifies "${topDriver.feature}" as a primary predictor and flags ${highRiskCount.toLocaleString()} active higher-risk ${entityLower}.`,
      recommendation: `Target the ${highRiskCount.toLocaleString()} active higher-risk accounts identified by the trained model with tailored retention workflows.`,
      tone: 'emerald',
      meterPercent: Math.min(100, Math.max(12, topDriver.importance)),
    });
  } else if (analytics.monthlyChargesComparison) {
    const mc = analytics.monthlyChargesComparison;
    const retentionRate = analytics.stayedPercentage;
    const atRiskRevenueEstimate = analytics.churnedCount * mc.churnedAvg;
    insights.push({
      id: 'retention-opportunity',
      category: 'Retention Opportunity',
      title: `Churned ${tmpl.revenueLabel} Impact: $${atRiskRevenueEstimate.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      statLabel: 'Current Retention Rate',
      statValue: `${retentionRate.toFixed(1)}%`,
      explanation: `${analytics.churnedCount.toLocaleString()} churned ${entityLower} averaged $${mc.churnedAvg.toFixed(
        2
      )} on "${mc.columnName}", representing $${atRiskRevenueEstimate.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })} in historical churned value.`,
      recommendation:
        'Train Logistic Regression, Decision Tree, or Random Forest in Churn Prediction to score account-level risk probabilities.',
      tone: 'emerald',
      meterPercent: Math.min(100, Math.max(12, retentionRate)),
    });
  }

  // 6. Support Friction & Satisfaction Signals (when complaint, ticket, or satisfaction columns exist)
  const comparisons = analytics.numericComparisons || [];
  const satComp = comparisons.find((c) =>
    /(satisfaction|csat|nps|feedback_score)/i.test(c.column)
  );
  if (satComp && satComp.stayedAvg !== satComp.churnedAvg) {
    const gap = satComp.stayedAvg - satComp.churnedAvg;
    insights.push({
      id: 'satisfaction-gap-signal',
      category: 'Customer Satisfaction',
      title:
        gap > 0
          ? `Lower "${satComp.column}" Linked to Churn`
          : `"${satComp.column}" Variance Across Outcomes`,
      statLabel: 'Retained vs Churned Mean',
      statValue: `${satComp.stayedAvg.toFixed(1)} vs ${satComp.churnedAvg.toFixed(1)}`,
      explanation: `Retained ${entityLower} averaged ${satComp.stayedAvg.toFixed(
        2
      )} on "${satComp.column}", compared with ${satComp.churnedAvg.toFixed(
        2
      )} among churned ${entityLower}.`,
      recommendation:
        'Trigger proactive account reviews immediately whenever satisfaction survey responses dip below your workspace baseline.',
      tone: 'purple',
      meterPercent: Math.min(100, Math.max(20, Math.abs(gap) * 15)),
    });
  }

  const frictionComp = comparisons.find((c) =>
    /(complaint|unresolved_ticket|open_ticket|total_tickets_raised|average_resolution_days)/i.test(
      c.column
    )
  );
  if (frictionComp && frictionComp.churnedAvg > frictionComp.stayedAvg) {
    insights.push({
      id: 'service-friction-signal',
      category: 'Complaints & Support Friction',
      title: `Elevated "${frictionComp.column}" Precedes Attrition`,
      statLabel: 'Churned vs Retained Mean',
      statValue: `${frictionComp.churnedAvg.toFixed(1)} vs ${frictionComp.stayedAvg.toFixed(1)}`,
      explanation: `Churned ${entityLower} logged an average of ${frictionComp.churnedAvg.toFixed(
        2
      )} on "${frictionComp.column}", compared with ${frictionComp.stayedAvg.toFixed(
        2
      )} for retained ${entityLower}.`,
      recommendation:
        'Escalate accounts with repeat complaints or open unresolved tickets to priority SLA resolution queues.',
      tone: 'danger',
      meterPercent: Math.min(
        100,
        Math.max(
          22,
          frictionComp.churnedAvg > 0
            ? (frictionComp.churnedAvg / (frictionComp.churnedAvg + Math.max(0.5, frictionComp.stayedAvg))) * 100
            : 40
        )
      ),
    });
  }

  return insights;
}
