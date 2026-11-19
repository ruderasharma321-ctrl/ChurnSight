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
      ? displayValue.toFixed(decimals)
      : Math.round(displayValue).toLocaleString();

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
  const retainedPct = analytics ? analytics.stayedPercentage : 74;
  const churnedPct = analytics ? analytics.churnedPercentage : 26;
  const retainedRatio = retainedPct / 100;
  const churnedRatio = churnedPct / 100;

  const barRatios = useMemo(() => {
    if (analytics?.tenureStats && analytics.tenureStats.length >= 4) {
      const slice = analytics.tenureStats.slice(0, 5);
      const maxRate = Math.max(10, ...slice.map((s) => s.churnRate));
      return slice.map((s) => Math.max(0.25, s.churnRate / maxRate));
    }
    if (analytics?.contractStats && analytics.contractStats.length >= 2) {
      const slice = analytics.contractStats.slice(0, 5);
      const maxRate = Math.max(10, ...slice.map((s) => s.churnRate));
      return slice.map((s) => Math.max(0.25, s.churnRate / maxRate));
    }
    return [0.42, 0.68, 0.52, 0.84, 0.94];
  }, [analytics]);

  const highRiskCount = activeModel
    ? activeModel.predictions.filter((p) => p.riskCategory === 'Higher Estimated Churn Risk').length
    : null;

  return (
    <div className="relative w-full h-[310px] sm:h-[340px] flex items-center justify-center select-none">
      {/* Ambient Volumetric Lighting Behind Canvas */}
      <div className="absolute w-64 h-64 rounded-full bg-[#397BFF]/25 blur-3xl -top-6 right-4 pointer-events-none" />
      <div className="absolute w-60 h-60 rounded-full bg-[#E84FA8]/30 blur-3xl bottom-0 left-4 pointer-events-none" />

      {/* Dedicated Isolated Lazy-Loaded WebGL 3D Canvas Container */}
      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-40 h-40 rounded-full border-2 border-[#35C5E8]/40 bg-[#7655E8]/15" />
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

      {/* Crisp Perimeter Floating Glass HUD Cards (No backdrop-blur over WebGL; unobstructed center) */}
      <div className="relative z-10 w-full h-full pointer-events-none">
        {/* Top-Left Telemetry Card */}
        <div
          className="animate-float-slow absolute top-1 left-0 sm:left-2 rounded-xl bg-[#11142B]/85 border border-white/20 shadow-2xl px-3.5 py-2.5 space-y-0.5"
          style={{
            transform: `translate3d(${tilt.x * -8}px, ${tilt.y * -6}px, 0)`,
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#35C5E8] font-semibold">
            {analytics ? 'Retention Share' : '3D Analytics Engine'}
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-white">
            {analytics ? `${retainedPct.toFixed(1)}%` : 'Live Model'}
          </div>
        </div>

        {/* Top-Right Churn Indicator Card */}
        <div
          className="animate-float-reverse absolute top-3 right-0 sm:right-2 rounded-xl bg-[#11142B]/85 border border-[#E84FA8]/35 shadow-2xl px-3.5 py-2.5 space-y-0.5"
          style={{
            transform: `translate3d(${tilt.x * 10}px, ${tilt.y * -8}px, 0)`,
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#FF9AC8] font-semibold">
            {analytics ? 'Attrition Rate' : 'Risk Scoring'}
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-white">
            {analytics ? `${churnedPct.toFixed(1)}%` : 'Logistic & Tree'}
          </div>
        </div>

        {/* Bottom-Left Customer Risk Indicator Card */}
        <div
          className="animate-float-delayed absolute bottom-2 left-0 sm:left-2 rounded-xl bg-[#11142B]/85 border border-white/20 shadow-2xl px-3.5 py-2.5 flex items-center gap-2.5"
          style={{
            transform: `translate3d(${tilt.x * -6}px, ${tilt.y * 8}px, 0)`,
          }}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#397BFF] to-[#7655E8] flex items-center justify-center text-white shrink-0 border border-white/25">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 19c1.5-3.2 4-4.5 7-4.5s5.5 1.3 7 4.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-indigo-200/75 font-semibold">
              {highRiskCount !== null ? 'High-Risk Flagged' : 'Dataset Scope'}
            </div>
            <div className="text-xs font-bold font-mono tabular-nums text-white">
              {highRiskCount !== null
                ? `${highRiskCount.toLocaleString()} Accounts`
                : analytics
                  ? `${analytics.totalCustomers.toLocaleString()} Records`
                  : 'Ready for CSV'}
            </div>
          </div>
        </div>

        {/* Bottom-Right Model Precision Card */}
        {activeModel && (
          <div
            className="animate-float-slow absolute bottom-2 right-0 sm:right-2 rounded-xl bg-[#11142B]/85 border border-[#35C5E8]/35 shadow-2xl px-3.5 py-2.5 space-y-0.5"
            style={{
              transform: `translate3d(${tilt.x * 8}px, ${tilt.y * 6}px, 0)`,
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#35C5E8] font-semibold">
              Test Accuracy
            </div>
            <div className="text-sm font-bold font-mono tabular-nums text-white">
              {activeModel.accuracy.toFixed(1)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface TiltKpiCardProps {
  title: string;
  value: number;
  decimals?: number;
  suffix?: string;
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
  suffix = '',
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
                <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />
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
