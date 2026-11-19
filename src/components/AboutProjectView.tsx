import React from 'react';

export const AboutProjectView: React.FC = () => {
  const workflowSteps = [
    {
      step: '01',
      title: 'Industry & Workspace Setup',
      desc: 'Configure your business industry, revenue model, and company churn formula during onboarding or in Company Settings.',
    },
    {
      step: '02',
      title: 'Stage CSV or Excel Data',
      desc: 'Import .csv, .xlsx, or .xls customer files or load an industry-specific 250-record demonstration dataset.',
    },
    {
      step: '03',
      title: 'Confirm Schema & Definition',
      desc: 'Review missing values, duplicate rows, column mappings (target, ID, dates, segments), and business churn triggers.',
    },
    {
      step: '04',
      title: 'Validate & Prepare Data',
      desc: 'Customer data preparation automatically handles missing values, detects duplicates, and checks whether historical churn labels are sufficient.',
    },
    {
      step: '05',
      title: 'Standardize Customer Signals',
      desc: 'Encode customer categories and normalize account metrics automatically while guarding against post-churn data leakage.',
    },
    {
      step: '06',
      title: 'Hold-Out Quality Split',
      desc: 'Automatically reserves an unseen validation sample—using chronological order when dates are mapped—to measure real predictive reliability.',
    },
    {
      step: '07',
      title: 'Managed Prediction Setup',
      desc: 'Automatically evaluates supported algorithms, builds your company prediction model, and activates Prediction availability once quality checks pass.',
    },
    {
      step: '08',
      title: 'Scenario & Batch Scoring',
      desc: 'Inspect individual churn risk scores, run retention simulations, upload new customer batches, and refresh prediction models as new data arrives.',
    },
    {
      step: '09',
      title: 'Model Performance & Reports',
      desc: 'Review plain-language Model Performance, retention playbooks in Customer Intelligence, and export CSV/PDF reports—or inspect algorithms in Technical ML Studio.',
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="text-xs font-bold text-[#7655E8] uppercase tracking-wider mb-1">
          Predict Churn. Discover Insights. Retain Customers.
        </div>
        <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">
          About ChurnSight Platform
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Multi-Industry Customer Intelligence &amp; Churn Prediction SaaS Architecture Using
          Machine Learning
        </p>
      </div>

      {/* Project Overview */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-3">
        <h2 className="text-base font-bold text-[#15152F]">1. Platform Purpose &amp; Vision</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Customer churn affects organizations across Telecommunications, Banking, E-Commerce, SaaS,
          Healthcare, Insurance, Education, and Fitness memberships. Acquiring new customers is far
          more expensive than retaining existing ones. ChurnSight provides isolated, configurable
          company workspaces so each business can align churn definitions, visualisations, and
          supervised machine learning workflows directly with its real operations.
        </p>
      </div>

      {/* Technology Stack & Architecture */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
        <h2 className="text-base font-bold text-[#15152F]">
          2. Technology Stack &amp; Architectural Decisions
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          To deliver an auditable, zero-external-runtime SaaS architecture, data processing,
          multi-tenant persistence, role-based access control, and machine-learning pipelines run in{' '}
          <strong>TypeScript</strong> on <strong>Node.js + Express</strong>, paired with a{' '}
          <strong>React 19 + Tailwind CSS</strong> interface:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="border border-purple-100 bg-[#F6F3FF]/50 rounded-xl p-4 space-y-1.5">
            <div className="text-xs font-bold text-[#7655E8]">Frontend Experience</div>
            <div className="text-sm font-bold text-[#15152F]">
              React 19, Recharts, Three.js &amp; jsPDF
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Industry-adaptive KPIs, interactive BI charts, 3D probability telemetry, What-If
              simulation, batch scoring, and executive PDF/CSV exports.
            </p>
          </div>

          <div className="border border-purple-100 bg-[#F6F3FF]/50 rounded-xl p-4 space-y-1.5">
            <div className="text-xs font-bold text-[#397BFF]">Multi-Tenant ML Engine</div>
            <div className="text-sm font-bold text-[#15152F]">
              Node.js, Express, XLSX &amp; TypeScript
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Executes CSV/Excel parsing, staging verification, imputation, one-hot encoding,
              Logistic Regression, CART Decision Trees, Random Forest Ensembles, and tenant quota
              governance.
            </p>
          </div>
        </div>
      </div>

      {/* 9-Step ML Workflow */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
        <h2 className="text-base font-bold text-[#15152F]">
          3. Nine-Step Customer Intelligence Workflow
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {workflowSteps.map((item) => (
            <div
              key={item.step}
              className="border border-purple-100 bg-[#F6F3FF]/40 rounded-xl p-4 space-y-2"
            >
              <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-gradient-to-r from-[#7655E8] to-[#B84DE0] text-white text-[11px] font-mono font-semibold">
                Step {item.step}
              </div>
              <div className="text-sm font-bold text-[#15152F]">{item.title}</div>
              <p className="text-xs text-slate-600 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ethical & Statistical Note */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-2">
        <h2 className="text-base font-bold text-[#15152F]">
          4. Interpreting Predictions Responsibly
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Machine learning models identify statistical correlations in historical data—they cannot
          predict human decisions with 100% certainty. All churn probabilities displayed in this
          system are <strong>estimates</strong>, not guaranteed outcomes, and should be used alongside
          target leakage checks to guide proactive customer retention outreach.
        </p>
      </div>
    </div>
  );
};
