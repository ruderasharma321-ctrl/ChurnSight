import React from 'react';

export const AboutProjectView: React.FC = () => {
  const workflowSteps = [
    {
      step: '01',
      title: 'Workspace Setup',
      desc: 'Select your industry, revenue model, and company churn definition.',
    },
    {
      step: '02',
      title: 'Import Customer Data',
      desc: 'Upload your Excel workbook or CSV customer and support ticket records.',
    },
    {
      step: '03',
      title: 'Validate & Map',
      desc: 'Verify column mapping, status consistency, and readiness eligibility.',
    },
    {
      step: '04',
      title: 'Value & Risk Scoring',
      desc: 'Segment High, Medium, and Low value customers and detect active churn risk.',
    },
    {
      step: '05',
      title: 'Scenario & Batch Scoring',
      desc: 'Simulate retention changes and score new active customer batches.',
    },
    {
      step: '06',
      title: 'Retention Reports',
      desc: 'Export board-ready PDFs, risk priority lists, and schema audits.',
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="text-xs font-bold text-[#7655E8] uppercase tracking-wider mb-1">
          Predict Churn · Discover Insights · Retain Customers
        </div>
        <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">About ChurnSight</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Multi-industry customer retention intelligence and churn prediction platform.
        </p>
      </div>

      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
        <h2 className="text-base font-bold text-[#15152F]">Platform Workflow</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflowSteps.map((item) => (
            <div
              key={item.step}
              className="border border-purple-100 bg-[#F6F3FF]/40 rounded-xl p-4 space-y-1.5"
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

      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#15152F]">Responsible Prediction Guidance</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Churn probabilities are statistical estimates for active accounts only—never guaranteed
            outcomes.
          </p>
        </div>
      </div>
    </div>
  );
};
