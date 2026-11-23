import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AnalyticsSummary,
  ModelEvaluationResult,
  RiskCategory,
} from '../types/churn';

const LazyHeroScene3D = React.lazy(() => import('./HeroScene3D'));

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
}) => {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setDisplayValue(value);
      return;
    }

    let rafId = 0;
    const duration = 700;
    const startVal = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startVal + (value - startVal) * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, reducedMotion]);

  const formatted =
    decimals > 0
      ? displayValue.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : Math.round(displayValue).toLocaleString('en-US');

  return (
    <span className="tabular-nums">
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

interface ProbabilityGaugeProps {
  probability: number; // 0..1
  riskCategory: RiskCategory;
  predictedLabel: string;
}

export const ProbabilityGauge: React.FC<ProbabilityGaugeProps> = ({
  probability,
  riskCategory,
  predictedLabel,
}) => {
  const clamped = Math.max(0, Math.min(1, probability));
  const pct = clamped * 100;

  const radius = 86;
  const cx = 110;
  const cy = 104;
  const halfCircumference = Math.PI * radius;
  const dashOffset = halfCircumference * (1 - clamped);

  let gradientId = 'gaugeLowRisk';
  let accentText = 'text-[#0E9F6E]';
  let statusSubtitle = 'Low estimated likelihood of cancellation';

  if (riskCategory === 'Higher Estimated Churn Risk') {
    gradientId = 'gaugeHighRisk';
    accentText = 'text-[#D63384]';
    statusSubtitle = 'Elevated retention attention recommended';
  } else if (riskCategory === 'Moderate Estimated Churn Risk') {
    gradientId = 'gaugeMedRisk';
    accentText = 'text-[#D97706]';
    statusSubtitle = 'Moderate churn signals detected';
  }

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <div className="relative w-[220px] h-[132px]">
        <svg viewBox="0 0 220 132" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="gaugeLowRisk" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#16C995" />
              <stop offset="100%" stopColor="#397BFF" />
            </linearGradient>
            <linearGradient id="gaugeMedRisk" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#FF786B" />
            </linearGradient>
            <linearGradient id="gaugeHighRisk" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FF786B" />
              <stop offset="100%" stopColor="#E84FA8" />
            </linearGradient>
          </defs>

          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke="#EDE9FE"
            strokeWidth="15"
            strokeLinecap="round"
          />

          {[0.35, 0.65].map((t) => {
            const angle = Math.PI * (1 - t);
            const x1 = cx + (radius - 11) * Math.cos(angle);
            const y1 = cy - (radius - 11) * Math.sin(angle);
            const x2 = cx + (radius + 10) * Math.cos(angle);
            const y2 = cy - (radius + 10) * Math.sin(angle);
            return (
              <line
                key={t}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#C4B5FD"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
            );
          })}

          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="15"
            strokeLinecap="round"
            strokeDasharray={halfCircumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>

        <div className="absolute inset-x-0 bottom-2 text-center">
          <div className="text-3xl font-bold font-mono tabular-nums text-[#15152F] leading-none">
            <AnimatedNumber value={pct} decimals={1} suffix="%" />
          </div>
          <div className={`text-xs font-bold mt-1.5 ${accentText}`}>{predictedLabel}</div>
        </div>
      </div>

      <div className="w-full max-w-[220px] flex items-center justify-between text-[11px] font-mono text-slate-400 px-1 mt-1">
        <span>0%</span>
        <span>35%</span>
        <span>65%</span>
        <span>100%</span>
      </div>
      <p className="text-xs text-slate-500 mt-2 text-center">{statusSubtitle}</p>
    </div>
  );
};

interface HeroArtworkProps {
  analytics?: AnalyticsSummary | null;
  activeModel?: ModelEvaluationResult | null;
  tilt?: { x: number; y: number };
}

export const HeroArtwork: React.FC<HeroArtworkProps> = ({
  analytics = null,
  activeModel = null,
  tilt = { x: 0, y: 0 },
}) => {
  const hp = analytics?.historicalPerformance;
  const hasValidLabels = Boolean(
    analytics &&
      !analytics.isUnlabeledColdStart &&
      (hp ? hp.historicalRateReliable : true)
  );
  const retainedRatio = hasValidLabels
    ? analytics!.stayedPercentage / 100
    : 0.74;
  const churnedRatio = hasValidLabels
    ? analytics!.churnedPercentage / 100
    : 0.26;

  const barRatios = useMemo(() => {
    if (analytics?.tenureStats && analytics.tenureStats.length >= 4) {
      const slice = analytics.tenureStats.slice(0, 5);
      const maxRate = Math.max(10, ...slice.map((s) => s.churnRate));
      return slice.map((s) => Math.max(0.28, s.churnRate / maxRate));
    }
    if (analytics?.contractStats && analytics.contractStats.length >= 2) {
      const slice = analytics.contractStats.slice(0, 5);
      const maxRate = Math.max(10, ...slice.map((s) => s.churnRate));
      return slice.map((s) => Math.max(0.28, s.churnRate / maxRate));
    }
    return [0.38, 0.62, 0.48, 0.78, 0.9];
  }, [analytics]);

  const highRiskCount = activeModel
    ? activeModel.predictions.filter(
        (p) =>
          p.riskApplicable !== false &&
          p.actualStatus !== 'Churned' &&
          p.actualStatus !== 'Inconsistent' &&
          p.actualChurn !== 'Churned' &&
          p.riskCategory === 'Higher Estimated Churn Risk'
      ).length
    : null;

  const totalCustomersValue = analytics
    ? analytics.totalCustomers.toLocaleString()
    : '—';
  const totalCustomersNote = analytics
    ? analytics.isUnlabeledColdStart
      ? 'Monitored accounts'
      : 'Analyzed records'
    : 'No dataset loaded';

  const churnRateValue = hasValidLabels
    ? `${(hp?.historicalChurnRate ?? analytics!.churnedPercentage).toFixed(1)}%`
    : '—';
  const churnRateNote = hasValidLabels
    ? `${(hp?.actualChurnedCount ?? analytics!.churnedCount).toLocaleString()} already churned`
    : analytics && !analytics.isUnlabeledColdStart && hp && !hp.historicalRateReliable
      ? 'Historical rate unavailable'
      : analytics
        ? 'Awaiting churn labels'
        : 'No labeled history';

  const highRiskValue = highRiskCount !== null
    ? highRiskCount.toLocaleString()
    : '—';
  const highRiskNote = highRiskCount !== null
    ? 'Active accounts flagged'
    : analytics
      ? 'Prediction pending'
      : 'Model not active';

  return (
    <div className="relative w-full flex flex-col justify-between gap-4 select-none">
      {/* Unobstructed 3D Orbital Visualization Stage */}
      <div className="relative w-full h-[250px] sm:h-[285px] flex items-center justify-center">
        {/* Ambient Blue & Purple Volumetric Glow */}
        <div
          className="absolute w-64 h-64 rounded-full bg-[#38BDF8]/18 blur-3xl -top-4 right-8 pointer-events-none"
          aria-hidden="true"
        />
        <div
          className="absolute w-64 h-64 rounded-full bg-[#7655E8]/26 blur-3xl bottom-0 left-8 pointer-events-none"
          aria-hidden="true"
        />

        <div className="absolute inset-0">
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-36 h-36 rounded-full border border-[#38BDF8]/35 bg-[#7655E8]/10" />
              </div>
            }
          >
            <LazyHeroScene3D
              retainedRatio={retainedRatio}
              churnedRatio={churnedRatio}
              barRatios={barRatios}
              pointerTilt={tilt}
            />
          </Suspense>
        </div>
      </div>

      {/* Three Grounded Real-Data Metric Cards (No backdrop-blur over WebGL, max 3 metrics) */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        style={{
          transform: `translate3d(${tilt.x * 4}px, ${tilt.y * 3}px, 0)`,
          transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="rounded-xl bg-[#0D112B]/90 border border-white/12 px-4 py-3 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
            Total Customers
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-white leading-tight">
            {totalCustomersValue}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            {totalCustomersNote}
          </div>
        </div>

        <div className="rounded-xl bg-[#0D112B]/90 border border-white/12 px-4 py-3 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
            Historical Churn Rate
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#F87171] leading-tight">
            {churnRateValue}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            {churnRateNote}
          </div>
        </div>

        <div className="rounded-xl bg-[#0D112B]/90 border border-white/12 px-4 py-3 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
            Active High-Risk
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#FB923C] leading-tight">
            {highRiskValue}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            {highRiskNote}
          </div>
        </div>
      </div>
    </div>
  );
};

interface TiltKpiCardProps {
  title: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  displayText?: string;
  subtitle: string;
  gradientClass: string;
  shadowClass: string;
  icon: React.ReactNode;
  index?: number;
}

export const TiltKpiCard: React.FC<TiltKpiCardProps> = ({
  title,
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  displayText,
  subtitle,
  gradientClass,
  shadowClass,
  icon,
  index = 0,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, glowX: 50, glowY: 50, hovered: false });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const ry = (px - 0.5) * 11;
    const rx = (0.5 - py) * 11;
    setTilt({ rx, ry, glowX: px * 100, glowY: py * 100, hovered: true });
  };

  const handlePointerLeave = () => {
    setTilt({ rx: 0, ry: 0, glowX: 50, glowY: 50, hovered: false });
  };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="perspective-1200"
    >
      {/* Subtle Shimmering Rim Border */}
      <div className="p-[1px] rounded-[20px] bg-gradient-to-br from-white/55 via-white/15 to-white/40 animate-border-shimmer shadow-xl">
        <div
          ref={cardRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          style={{
            transform: reducedMotion
              ? undefined
              : `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) translateY(${tilt.hovered ? -5 : 0}px)`,
            transition: tilt.hovered
              ? 'transform 90ms ease-out'
              : 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className={`relative overflow-hidden rounded-[19px] p-5 sm:p-6 text-white ${gradientClass} ${shadowClass} preserve-3d`}
        >
          {/* Interactive Mouse Light Reflection */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-200"
            style={{
              opacity: tilt.hovered && !reducedMotion ? 0.34 : 0,
              background: `radial-gradient(circle at ${tilt.glowX}% ${tilt.glowY}%, rgba(255,255,255,0.75), transparent 58%)`,
            }}
          />

          {/* Layered Translucent Decorative Geometry */}
          <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute right-8 -top-10 w-24 h-24 rounded-2xl rotate-12 bg-white/10 pointer-events-none" />
          <div className="absolute left-1/2 -bottom-10 w-28 h-16 rounded-full bg-white/[0.06] blur-md pointer-events-none" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/85">
                {title}
              </div>
              <div className="mt-3 text-3xl sm:text-[36px] font-extrabold font-display tabular-nums tracking-tight leading-none drop-shadow-xs">
                {displayText ? (
                  <span className="text-2xl sm:text-[28px]">{displayText}</span>
                ) : (
                  <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
                )}
              </div>
              <div className="mt-3 text-xs text-white/85 truncate">{subtitle}</div>
            </div>

            <div className="p-3 rounded-2xl bg-white/18 border border-white/30 shadow-[0_0_24px_rgba(255,255,255,0.22)] shrink-0">
              {icon}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

interface CircularRiskRingProps {
  label: string;
  count: number;
  total: number;
  strokeStart: string;
  strokeEnd: string;
  badgeTextClass: string;
  description: string;
}

export const CircularRiskRing: React.FC<CircularRiskRingProps> = ({
  label,
  count,
  total,
  strokeStart,
  strokeEnd,
  badgeTextClass,
  description,
}) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const gradId = React.useId();

  return (
    <div className="rounded-2xl border border-purple-100/90 bg-[#F5F3FF]/55 p-4 flex items-center gap-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="relative w-24 h-24 shrink-0">
        <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={strokeStart} />
              <stop offset="100%" stopColor={strokeEnd} />
            </linearGradient>
          </defs>
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke="#E9E4FA"
            strokeWidth="8"
          />
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 750ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-bold font-mono tabular-nums text-[#11142B]">
            <AnimatedNumber value={pct} decimals={1} suffix="%" />
          </span>
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <div className={`text-xs font-bold ${badgeTextClass}`}>{label}</div>
        <div className="text-xl font-bold font-mono tabular-nums text-[#11142B]">
          {count.toLocaleString()}{' '}
          <span className="text-xs font-normal text-slate-500">customers</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">{description}</p>
      </div>
    </div>
  );
};

export const DashboardLoadingSkeleton: React.FC = () => (
  <div className="space-y-6 animate-pulse" aria-label="Loading workspace">
    <div className="h-64 rounded-3xl bg-gradient-to-r from-[#11142B]/25 via-[#7655E8]/25 to-[#E84FA8]/20 border border-purple-100" />
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-36 rounded-2xl bg-white border border-purple-100 p-5 space-y-3"
        >
          <div className="h-3 w-24 bg-purple-100 rounded-md" />
          <div className="h-8 w-20 bg-purple-100 rounded-md" />
          <div className="h-3 w-32 bg-purple-50 rounded-md" />
        </div>
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-6 h-72 rounded-2xl bg-white border border-purple-100" />
      <div className="lg:col-span-6 h-72 rounded-2xl bg-white border border-purple-100" />
    </div>
  </div>
);

export const TableRowsSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 6,
  cols = 6,
}) => (
  <div className="space-y-2.5 py-2 animate-pulse" aria-label="Loading records">
    {Array.from({ length: rows }).map((_, rIdx) => (
      <div key={rIdx} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((__, cIdx) => (
          <div key={cIdx} className="h-6 bg-[#F6F3FF] rounded-lg border border-purple-100/60" />
        ))}
      </div>
    ))}
  </div>
);
