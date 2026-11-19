import React, { useRef, useState } from 'react';
import { RiskCategory } from '../types/churn';
import { AnimatedNumber } from './PremiumUI';

interface EnterpriseRiskDialProps {
  probability: number; // 0..1
  riskCategory: RiskCategory;
  predictedLabel: string;
  customerId?: string;
}

export const EnterpriseRiskDial: React.FC<EnterpriseRiskDialProps> = ({
  probability,
  riskCategory,
  predictedLabel,
  customerId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, hovered: false });

  const clamped = Math.max(0, Math.min(1, probability));
  const pct = clamped * 100;

  const size = 248;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 94;
  const circumference = 2 * Math.PI * radius;
  const activeSweep = circumference * 0.78; // 280deg precision instrument arc
  const dashOffset = activeSweep * (1 - clamped);

  let tierShort = 'LOW RISK';
  let tierPillClass = 'bg-[#35C5E8]/12 text-[#0C7D99] border-[#35C5E8]/35';
  let arcStart = '#35C5E8';
  let arcEnd = '#397BFF';
  let glowColor = 'rgba(53, 197, 232, 0.24)';

  if (riskCategory === 'Higher Estimated Churn Risk') {
    tierShort = 'HIGH RISK';
    tierPillClass = 'bg-[#B84DE0]/12 text-[#9D2EC5] border-[#B84DE0]/35';
    arcStart = '#7655E8';
    arcEnd = '#B84DE0';
    glowColor = 'rgba(184, 77, 224, 0.26)';
  } else if (riskCategory === 'Moderate Estimated Churn Risk') {
    tierShort = 'MODERATE RISK';
    tierPillClass = 'bg-[#7655E8]/12 text-[#5B3BD4] border-[#7655E8]/35';
    arcStart = '#397BFF';
    arcEnd = '#7655E8';
    glowColor = 'rgba(118, 85, 232, 0.24)';
  }

  const gradId = React.useId();

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setTilt({
      ry: (px - 0.5) * 9,
      rx: (0.5 - py) * 9,
      hovered: true,
    });
  };

  const handlePointerLeave = () => {
    setTilt({ rx: 0, ry: 0, hovered: false });
  };

  // Precision calibration ticks along the 280deg instrument arc (starting at 130deg)
  const ticks = Array.from({ length: 29 }, (_, idx) => {
    const ratio = idx / 28;
    const deg = 130 + ratio * 280;
    const rad = (deg * Math.PI) / 180;
    const isMajor = idx % 7 === 0;
    const rInner = isMajor ? radius - 20 : radius - 16;
    const rOuter = radius - 12;
    return {
      x1: cx + rInner * Math.cos(rad),
      y1: cy + rInner * Math.sin(rad),
      x2: cx + rOuter * Math.cos(rad),
      y2: cy + rOuter * Math.sin(rad),
      isMajor,
    };
  });

  // Threshold markers at 35% and 65%
  const thresholds = [0.35, 0.65].map((t) => {
    const deg = 130 + t * 280;
    const rad = (deg * Math.PI) / 180;
    return {
      t,
      x1: cx + (radius - 10) * Math.cos(rad),
      y1: cy + (radius - 10) * Math.sin(rad),
      x2: cx + (radius + 9) * Math.cos(rad),
      y2: cy + (radius + 9) * Math.sin(rad),
    };
  });

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="perspective-1200 flex flex-col items-center justify-center py-2 select-none"
    >
      <div
        className="relative preserve-3d flex flex-col items-center"
        style={{
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          transition: tilt.hovered
            ? 'transform 100ms ease-out'
            : 'transform 360ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#64748B] mb-2">
          CUSTOMER RISK SCORE
        </div>

        <div className="relative w-[248px] h-[232px] flex items-center justify-center">
          {/* Layered Depth Glow */}
          <div
            className="absolute inset-8 rounded-full blur-2xl pointer-events-none transition-colors duration-500"
            style={{ background: glowColor }}
          />

          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="w-[248px] h-[248px] overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={arcStart} />
                <stop offset="100%" stopColor={arcEnd} />
              </linearGradient>
            </defs>

            {/* Outer Precision Orbit Ring */}
            <circle
              cx={cx}
              cy={cy}
              r={radius + 15}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth="1"
              strokeDasharray="3 5"
            />

            {/* Calibration Tick Marks */}
            {ticks.map((tick, idx) => (
              <line
                key={idx}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={tick.isMajor ? '#94A3B8' : '#CBD5E1'}
                strokeWidth={tick.isMajor ? 1.5 : 1}
              />
            ))}

            {/* Track Arc (280 degrees starting at 130deg) */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="#ECE8FA"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${activeSweep} ${circumference}`}
              transform={`rotate(130 ${cx} ${cy})`}
            />

            {/* Active Animated Probability Arc */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${activeSweep} ${circumference}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(130 ${cx} ${cy})`}
              style={{
                transition: 'stroke-dashoffset 750ms cubic-bezier(0.16, 1, 0.3, 1)',
                filter: `drop-shadow(0 0 8px ${glowColor})`,
              }}
            />

            {/* 35% and 65% Classification Threshold Markers */}
            {thresholds.map((th) => (
              <line
                key={th.t}
                x1={th.x1}
                y1={th.y1}
                x2={th.x2}
                y2={th.y2}
                stroke="#11142B"
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
            ))}
          </svg>

          {/* Center Readout Stack (elevated in 3D space) */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center pt-2"
            style={{ transform: 'translateZ(24px)' }}
          >
            <div className="font-display text-5xl font-bold tracking-tight text-[#11142B] tabular-nums leading-none">
              <AnimatedNumber value={pct} decimals={1} suffix="%" />
            </div>

            <div
              className={`mt-3 px-2.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-[0.16em] ${tierPillClass}`}
            >
              {tierShort}
            </div>

            <div className="mt-2 text-xs font-medium text-[#475569]">{predictedLabel}</div>
          </div>
        </div>

        {/* Scale Legend & Caption */}
        <div className="w-full max-w-[230px] flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-slate-200/80 pt-2.5 mt-1">
          <span>0%</span>
          <span>35% LOW</span>
          <span>65% HIGH</span>
          <span>100%</span>
        </div>

        <p className="mt-2 text-xs text-slate-500 text-center">
          Estimated probability of churn
          {customerId ? (
            <span className="font-mono text-[#11142B] font-medium"> · {customerId}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
};
