# Product Requirements Document (PRD)
# ChurnSight — Multi-Industry Customer Intelligence, Churn Readiness & Prediction SaaS Platform

---

## 1. Document Control & Metadata

| Field | Specification |
| :--- | :--- |
| **Product Name** | **ChurnSight** (`Customer Churn Analysis & Prediction System`) |
| **Document Version** | `2.0.0` (Multi-Industry SaaS & Data Readiness Architecture) |
| **Product Stage** | Full-Stack Web Application (Production-Architecture MVP) |
| **Tech Stack** | React 19, TypeScript, Tailwind CSS v4, Three.js, Recharts, Express.js, Node.js |
| **Deployment Modes** | Stateful Node Server (`server.ts`) / Vercel Serverless (`api/index.ts` + `vercel.json`) |
| **Primary Audience** | Product Owners, SaaS Architects, ML Engineers, Enterprise Evaluators, Examiners |

---

## 2. Executive Summary & Product Vision

### 2.1 Problem Statement
Customer retention is one of the highest-leverage revenue drivers across subscription, contractual, and repeat-purchase businesses. Yet most churn analytics systems suffer from four structural failures:

1. **Single-Industry Rigidity:** Tools built around telecom datasets fail when applied to SaaS, banking, healthcare, insurance, retail, education, or fitness businesses because churn events, revenue units, and engagement cadences differ fundamentally.
2. **Technical Complexity Barrier:** Non-technical business operators are forced to configure ML hyperparameters, feature scaling, train/test splits, and evaluation thresholds manually—or worse, blindly trust unvalidated models.
3. **False Churn Assumptions & Data Leakage:** Systems often guess that "inactivity" equals "churn," or train on post-churn leakage columns (e.g., `cancellation_reason`, `refund_amount`), producing inflated evaluation scores that fail in production.
4. **Cold-Start Dead Ends:** Companies without historical churn labels are blocked completely instead of receiving immediate segmentation, inactivity monitoring, and a guided path to supervised ML readiness.

### 2.2 Product Vision
**ChurnSight** is a multi-tenant, multi-industry **Customer Intelligence & Churn Prediction SaaS Platform** designed with Fortune-100 enterprise clarity. Each business registers an isolated workspace, defines what churn means in its specific commercial context *before* uploading data, receives industry-tailored CSV/Excel templates or auto-mapped ingestion for custom schemas, evaluates dataset health through a quantitative **Data Readiness Centre (0–100)**, and unlocks either **Behaviour Monitoring (Cold-Start)** or **Automated Managed Prediction Models** gated by strict hold-out validation checks.

### 2.3 Core Design & Product Philosophy
- **Business-First Language:** Ordinary business users interact with *"Managed prediction setup"*, *"Customer data preparation"*, *"Model Performance"*, and *"Prediction availability"* rather than opaque ML jargon, while technical diagnostics remain accessible for analysts in a dedicated Technical Workbench.
- **Honest Validation Gates:** ChurnSight **never fabricates predictions** when historical churn labels are insufficient, imbalanced, or fail hold-out recall/F1 quality checks.
- **Explicit Churn Semantics:** Inactivity is never silently relabeled as churn unless the company explicitly selects and confirms an inactivity-based churn rule.
- **Strict Tenant & Privacy Governance:** Customer records, trained models, and audit logs are strictly isolated per company (`companyId`), with cross-company model contribution and benchmarking strictly **opt-out by default**.

---

## 3. Target Market & Multi-Industry Configuration

ChurnSight supports **9 industry verticals** out of the box, plus configurable organizational attributes captured during onboarding and editable in Company Settings.

### 3.1 Supported Organization Attributes
- **Business Types (`BusinessType`):** `B2C`, `B2B`, `B2B2C`, `Non-Profit / Public`
- **Business Models (`BusinessModel`):**
  - `Subscription / Recurring`
  - `Transactional / Repeat Purchase`
  - `Contract / Retainer`
  - `Membership / Hybrid`
- **Customer Relationship Types (`CustomerRelationshipType`):**
  - `Contractual / Recurring Subscription`
  - `Repeat Purchase / Transactional`
  - `Fixed-Term Renewal / Policy`
  - `Long-Term Care / Advisory`
  - `Membership / Attendance-Based`

### 3.2 Supported Industry Verticals (`IndustryKey`)

| Industry Key | Typical Churn Event | Default Relationship Type | Key Behavioral / Revenue Signals |
| :--- | :--- | :--- | :--- |
| `telecommunications` | Subscription / line cancellation | Contractual / Recurring Subscription | `contract_type`, `tenure_months`, `monthly_charges`, `support_calls`, `internet_service` |
| `banking_finance` | Account closure (`exited`) | Contractual / Recurring Subscription | `account_tier`, `balance`, `monthly_transactions`, `num_products`, `last_transaction_date` |
| `retail_ecommerce` | Extended purchase inactivity / non-repeat | Repeat Purchase / Transactional | `customer_segment`, `months_active`, `avg_order_value`, `orders_90d`, `last_purchase_date` |
| `saas_technology` | Plan cancellation or seat downgrade/non-renewal | Contractual / Recurring Subscription | `plan_tier`, `months_subscribed`, `mrr`, `weekly_active_users`, `support_tickets` |
| `healthcare` | Patient attrition / missed care follow-up | Long-Term Care / Advisory | `care_plan`, `tenure_months`, `visit_value`, `visits_6m`, `last_visit_date` |
| `insurance` | Policy lapse or non-renewal | Fixed-Term Renewal / Policy | `policy_type`, `policy_tenure_months`, `annual_premium`, `claims_count`, `renewal_date` |
| `education` | Course dropout or term non-renewal | Fixed-Term Renewal / Policy | `program_track`, `months_enrolled`, `tuition_fee`, `sessions_per_week`, `assignments_completed_pct` |
| `fitness_membership` | Gym/club membership cancellation | Membership / Attendance-Based | `membership_tier`, `tenure_months`, `monthly_dues`, `monthly_checkins`, `last_checkin_date` |
| `other` | Custom company-defined churn trigger | Configurable (`customIndustryName`) | Flexible auto-mapped ID, revenue, tenure, segment, date, and usage features |

---

## 4. User Personas & Role-Based Access Control (RBAC)

### 4.1 Roles (`UserRole`)

| Role | Scope | Primary Responsibilities & Access |
| :--- | :--- | :--- |
| **`PLATFORM_OWNER`** | Platform-Wide (Multi-Tenant) | Oversees registered companies, workspace storage/record consumption, model activity, plan tier assignments (`PATCH /api/platform/companies/:companyId/plan`), and cross-platform audit logs. Elevated via `PLATFORM_OWNER_EMAIL`. |
| **`FIRM_ADMIN`** | Single Company Workspace | Registers the company workspace, configures company profile & industry, confirms churn definitions, manages privacy consent flags, creates/edits/deactivates team members, reviews company audit logs, and has full analytics/ML access. |
| **`ANALYST`** | Single Company Workspace | Operates inside assigned tenant workspace with granular permissions (`canUploadAndAnalyse`, `canGeneratePredictions`). Cannot alter company billing/privacy governance or manage other users. |

### 4.2 Granular Analyst Permissions (`UserPermissions`)
- `canUploadAndAnalyse` (`boolean`): Controls access to dataset staging, upload, commit, column mapping updates, churn definition updates, and observed outcome recording.
- `canGeneratePredictions` (`boolean`): Controls access to automated model setup triggers, manual workbench training, single-customer risk scoring, and batch scoring exports.

### 4.3 Security & Tenant Isolation Controls
- **Authentication:** Scrypt/salted password hashing, random opaque session tokens hashed before persistence, `HttpOnly` + `SameSite` + `Secure; Partitioned` cookies (with `Authorization: Bearer` header support for embedded/iframe contexts).
- **Session Lifetimes:** `8 hours` standard or `30 days` when *"Remember me"* is selected.
- **No-Cache API Headers:** All `/api/*` responses enforce `Cache-Control: no-store, no-cache, must-revalidate, private` to prevent back-button data replay after sign-out.
- **Rate Limiting:** Dedicated sliding-window limiters for auth endpoints (`authLimiter`: 40 req / 5 min) and compute-heavy data/ML endpoints (`computeLimiter`: 80 req / 5 min).
- **Audit Logging (`AuditLogEntry`):** Records `COMPANY_REGISTERED`, `USER_LOGIN`, `USER_LOGOUT`, `DATASET_STAGED`, `DATASET_COMMITTED`, `CHURN_DEFINITION_UPDATED`, `CHURN_OUTCOME_RECORDED`, `AUTOMATED_MODEL_BUILT`, `DATA_PRIVACY_SETTINGS_UPDATED`, `PLATFORM_PLAN_ASSIGNED`, and user management events (up to 2,500 retained entries).

---

## 5. Detailed Functional Requirements

### FR-1: Company Onboarding & Authentication Lifecycle
- **FR-1.1:** Registration (`POST /api/auth/register-company`) captures Company Name, Company Email, optional Registration Number, Industry (with custom name for `other`), Country, Business Type, Business Model, **Customer Relationship Type** (auto-suggested from industry), Admin Full Name, Admin Email, and Password (`>= 8` characters with confirmation).
- **FR-1.2:** Upon registration, the workspace initializes with:
  - Industry-matched default `ChurnDefinition` (`confirmedByUser: false` until explicitly reviewed/confirmed).
  - Strict opt-out `DataPrivacySettings` (`allowSharedModelContribution: false`, `optInCrossCompanyBaseline: false`, `crossCompanyValidationStatus: 'awaiting_opt_in_and_validation'`).
  - Default `SubscriptionPlanTier`.
- **FR-1.3:** Supports Sign In (`POST /api/auth/login`), Sign Out (`POST /api/auth/logout`), Session Hydration (`GET /api/auth/me` & `GET /api/state`), Password Reset lookup (`POST /api/auth/forgot-password`), Profile Updates (`PATCH /api/auth/profile`), and In-Session Password Change (`POST /api/auth/change-password`).

### FR-2: Pre-Upload Churn Definition Engine
- **FR-2.1:** Before uploading or committing data, businesses configure their `ChurnDefinition` via **Step 1 · Define Churn Rules** in Customer Data or Company Settings (`PUT /api/company/churn-definition`):
  - **Trigger Type (`ChurnTriggerType`):** `cancellation`, `non_renewal`, `inactivity`, or `custom_status`.
  - **Churn Event Description:** Human-readable commercial definition.
  - **Calculation Method (`ChurnCalculationMethod`):** `customer_based` vs. `period_based`.
  - **Denominator Population (`ChurnDenominatorType`):** `all_active_start`, `all_customers`, `eligible_renewals`, `active_subscribers`.
  - **Reporting Period (`ReportingPeriod`):** `monthly`, `quarterly`, `annual`, `custom`.
  - **Inactivity Threshold (`inactivityDays`):** Active when `inactivity` trigger or monitoring cadence is used.
  - **Explicit User Confirmation:** `confirmedByUser` + `confirmedAt` timestamp.
- **FR-2.2:** Updating the churn definition dynamically recalculates dataset readiness, analytics, and automated prediction setup if a dataset is already loaded.

### FR-3: Industry-Specific CSV & Excel Templates
- **FR-3.1:** Endpoint `GET /api/dataset/template?industry=...&format=csv|xlsx&mode=labeled|cold_start` generates tailored templates per industry.
- **FR-3.2:** Templates support two explicit modes:
  - **Full Historical (`labeled`):** Includes historical target outcome column (e.g., `churn`, `exited`, `dropped`, `policy_lapsed`) for immediate supervised ML training.
  - **Cold-Start (`cold_start`):** Excludes outcome labels so organizations with only active customer/activity data can immediately run analytics and behaviour watchlists.
- **FR-3.3:** Excel (`.xlsx`) exports include **two sheets**:
  1. `Customer_Data_Template`: Sample rows formatted for immediate population.
  2. `Column_Guide_and_Formats`: Column name, display name, Tier (`required`, `recommended`, `optional`), Data Type, Semantic Role, Accepted Formats, Description, Example Value, and Cold-Start Notes.
- **FR-3.4:** Custom company column names remain fully supported via intelligent heuristic auto-mapping—templates are a guide, not a rigid parser constraint.

### FR-4: Data Staging, Mapping Rationales & Hygiene Profiling
- **FR-4.1:** Uploads support `.csv` and `.xlsx`/`.xls` files up to the workspace plan's record/byte quota (`enforceDatasetPlanQuota`).
- **FR-4.2:** Staging (`POST /api/dataset/stage`) runs non-destructive profiling before committing data:
  - **Type & Semantic Role Detection:** Classifies columns as `numeric`, `categorical`, `identifier`, or `date`, and assigns semantic roles (`id`, `target`, `date`, `revenue`, `tenure`, `segment`, `frequency`, `other`).
  - **Mapping Suggestion Rationales (`MappingSuggestionRationale[]`):** Explains *why* each column was auto-suggested (`high`, `medium`, or `unmapped` confidence).
  - **Data Hygiene Metrics:**
    - `missingCellCount` and per-column `missingPercent`
    - `duplicateCount` (duplicate rows / customer IDs)
    - `invalidDateCount` (malformed date strings inside date-typed columns)
    - `inconsistentCategoryCount` & `inconsistentCategorySamples` (case/whitespace collisions such as `"Standard"` vs. `"standard "`)
    - `invalidNumericCount` (non-numeric tokens inside numeric columns)
  - **Leakage Guardrail (`looksLikeLeakageColumn`):** Flags potential post-churn columns (`churn_reason`, `cancellation_date`, `exit_reason`, `refund_amount`, `closed_date`, etc.) so they are excluded from predictive features.
- **FR-4.3:** Users review the staged preview (`previewRows`), adjust column mappings if needed, and commit (`POST /api/dataset/commit`), or edit mappings later (`PUT /api/dataset/mapping`).

### FR-5: Data Readiness Centre (0–100 Score & 4-State Engine)
Implemented in `assessDataReadiness` (`server/mlEngine.ts`) and rendered via `DataReadinessPanel.tsx`:

- **FR-5.1 Weighted 100-Point Readiness Score (`scoreBreakdown`):**
  1. **Churn Definition Confirmation (`0–15 pts`)**: Confirmed rules (`15`), unconfirmed (`5`).
  2. **Core Feature Completeness (`0–25 pts`)**: Evaluates presence of customer identifier, revenue/value, tenure/lifecycle, segment/plan, and usable feature columns.
  3. **Date & Hygiene Quality (`0–20 pts`)**: Scores valid date parsing, low missing cell rates, low duplicate counts, and clean categorical consistency.
  4. **Historical Outcome Labels (`0–25 pts`)**: Evaluates target column mapping and labeled row coverage.
  5. **Sample Size & Class Balance (`0–15 pts`)**: Evaluates minority class count and labeled sample-to-feature ratio.

- **FR-5.2 Four Explicit Readiness States (`OverallReadinessTier`):**
  1. **Analytics Ready (`analytics_ready`):** Valid tabular rows + core descriptors -> unlocks KPI summaries, segment breakdowns, revenue/tenure distributions, and data hygiene reports.
  2. **Behaviour Monitoring Ready (`behaviour_monitoring_ready`):** Valid date or usage/frequency columns -> unlocks activity tracking, dormancy thresholds, and rule-based **Engagement & Inactivity Watchlists**.
  3. **Prediction Ready (`prediction_ready`):** Requires **all** statistical gates:
     - `churnDefinition.confirmedByUser === true`
     - Valid binary/mappable historical churn labels (`churnedCount` & `retainedCount`)
     - Minority class count `>= 4` (`minorityClassCount >= 4`)
     - Labeled rows `>= Math.max(8, usableFeatureCount + 4)`
     - Recommended validation strategy selection: **Chronological Split** (when valid temporal dates span chronologically and plan permits) or **Stratified Split**.
  4. **More Data Required (`more_data_required`):** Explicitly lists `missingItems` and actionable `collectionGuidance` whenever rows, features, or labels are insufficient.

### FR-6: Automated Prediction Intelligence & Model Quality Gates
- **FR-6.1:** Triggered automatically on dataset commit, churn-definition update, outcome recording, or manual refresh (`POST /api/model/auto-build`), plus advanced manual mode (`POST /api/model/train`).
- **FR-6.2 Supported Algorithms (`MLModelType`):**
  - `logistic_regression` (L2-regularized gradient descent with standardized numeric & one-hot categorical features)
  - `decision_tree` (CART-style Gini impurity splitter with configurable max depth)
  - `random_forest` (Bootstrapped ensemble of decision trees)
- **FR-6.3 Automated Preprocessing:**
  - Median imputation for missing numeric values; mode/`Unknown` imputation + category normalization for categoricals; z-score standardization for numeric features; post-churn leakage exclusion.
- **FR-6.4 Candidate Selection & Quality Gate:**
  - Evaluates permitted algorithms for the tenant's subscription tier on the held-out validation fold (`accuracy`, `precision`, `recall`, `f1Score`, `rocAuc`, `confusionMatrix`, `featureImportance`).
  - **Strict Quality Gate:** If the best candidate model predicts zero positives on a test fold containing actual churn (`testChurnRate > 0 && recall === 0 && f1Score === 0`), ChurnSight **refuses to publish broken predictions**, clears `activeModel`, and surfaces an actionable data-collection notice (`AutomationPipelineStage: 'more_historical_data_required'` or `'setup_failed'`).

### FR-7: Cold-Start Behaviour Monitoring & Outcome Recording
- **FR-7.1 Cold-Start Analytics Mode (`isUnlabeledColdStart === true`):**
  - Displays active monitored account counts, portfolio spend mean, low-engagement accounts, and **Engagement & Inactivity Watchlist** (`BehaviourMonitoringSummary`) across Dashboard, Data Analysis, and Customer Intelligence views.
  - Hides invalid supervised churn rates and churn-status filters when labels do not exist.
- **FR-7.2 Longitudinal Outcome Recording (`POST /api/dataset/record-outcome`):**
  - Accepts single or batched `{ customerId, outcome: 'Churned' | 'Retained' }` updates directly in the Data Readiness Centre.
  - Automatically creates/updates the target column, re-profiles dataset hygiene and readiness, recomputes analytics, and **automatically builds and activates the ML model** the moment `predictionReady` thresholds and quality gates are satisfied.

### FR-8: Customer Intelligence, Single & Batch Scoring
- **FR-8.1 Single Customer Prediction (`POST /api/model/predict-single`):** Dynamically renders form inputs from the trained model's active feature schema, returns churn probability (`0–100%`), Risk Tier (`High`, `Medium`, `Low`), top contributing risk factors, and tailored retention recommendations.
- **FR-8.2 Batch Scoring (`POST /api/model/batch-score`):** Scores uploaded customer CSV/Excel files against the active model, stores `BatchScoreResult` history, and enables CSV export (`GET /api/model/export-batch/:batchId` and `GET /api/model/export-predictions`).

### FR-9: Exploratory Data Analysis, Performance & Reporting
- **FR-9.1 Exploratory Data Analysis (`POST /api/analytics/filter`):** Interactive filtering by segment/contract tier, tenure band, monthly spend band, churn status (when labeled), and search query; renders segment churn rates, tenure/revenue distributions, and paginated customer table (`GET /api/dataset/rows`).
- **FR-9.2 Model Performance & Technical Workbench:** Displays active model metrics, confusion matrix (`TP/FP/TN/FN`), top predictive drivers (`FeatureImportanceItem[]`), historical model comparison table, and optional advanced algorithm/split selection (`stratified` vs. `chronological`) for technical reviewers.
- **FR-9.3 Reports (`ReportsView` + `reportExporter.ts`):** Generates multi-section executive PDF reports (`jsPDF`) and CSV exports summarizing dataset health, churn definitions, key drivers, and high-risk watchlists (gated by plan tier).

### FR-10: Data Privacy & Cross-Company Governance
- **FR-10.1:** Managed in `CompanySettingsView` via `PUT /api/company/privacy`:
  - `allowSharedModelContribution` (default `false`)
  - `optInCrossCompanyBaseline` (default `false`)
  - `crossCompanyValidationStatus`: Displays honest status (`not_enabled`, `awaiting_opt_in_and_validation`, `unvalidated_architecture_only`) and guarantees that **no unvalidated cross-company weights are used in tenant predictions**.

---

## 6. Subscription Plans & Workspace Quotas

Enforced server-side via `src/utils/subscriptionPlans.ts` and `server.ts`:

| Plan Tier | Monthly Price | Max Records | Max Users | Max Storage | Allowed ML Models | Batch Scoring | PDF Reports | Audit Logs | Chronological Split |
| :--- | :--- | ---: | ---: | ---: | :--- | :---: | :---: | :---: | :---: |
| **Free Trial** (`free_trial`) | `$0 / 14-day evaluation` | `1,000` | `3` | `5 MB` | Logistic Regression, Decision Tree | No | No | No | No |
| **Starter** (`starter`) | `$79 / month` | `10,000` | `10` | `25 MB` | Logistic, Decision Tree, Random Forest | Yes | Yes | No | Yes |
| **Professional** (`professional`) | `$249 / month` | `100,000` | `50` | `100 MB` | Logistic, Decision Tree, Random Forest | Yes | Yes | Yes | Yes |
| **Enterprise** (`enterprise`) | `Custom SLA` | `1,000,000` | `500` | `500 MB` | Logistic, Decision Tree, Random Forest | Yes | Yes | Yes | Yes |

---

## 7. UI/UX, Visual System & 3D Architecture

- **Typography Hierarchy:**
  - Headings: `Sora` (bold architectural display hierarchy)
  - Body Copy: `DM Sans` / `IBM Plex Sans`
  - Telemetry / Metrics / Code: `JetBrains Mono`
- **3D Interactive Elements (Three.js):**
  - `HeroScene3D.tsx`: Real-time WebGL 3D neural/predictive customer intelligence centerpiece on the executive hero banner.
  - `PredictiveScene3D.tsx`: Interactive 3D predictive analytics visualization inside predictive modules.
- **Navigation Tabs (`NavTab`):**
  - `overview` (Dashboard)
  - `intelligence` (Customer Intelligence & Watchlist)
  - `data` (Customer Data, Churn Rules, Templates, Staging & Readiness Centre)
  - `analytics` (Exploratory Data Analysis)
  - `predictions` (Single & Batch Scoring)
  - `performance` (Model Performance)
  - `reports` (Executive Reports)
  - `settings` (Workspace, Company Profile, Privacy, Users & Profile)
  - `technical` (Technical Workbench — optional/advanced view)
  - `platform` (Platform Governance — `PLATFORM_OWNER` only)
  - `about` (About ChurnSight Architecture)

---

## 8. System Architecture & Repository Layout

```text
/
├── api/index.ts                  # Vercel Serverless Function wrapper exporting Express app
├── vercel.json                   # Vercel build & /api/* -> /api/index rewrite config
├── server.ts                     # Express API factory (createApiApp) & local Vite/static server
├── server/
│   ├── authStore.ts              # Multi-tenant companies, users, salted scrypt auth & sessions
│   ├── workspaceStore.ts         # Isolated per-company dataset, analytics & model artifact store
│   ├── mlEngine.ts               # Parsing, profiling, readiness scoring, preprocessing & ML engine
│   ├── industryTemplates.ts      # CSV & 2-sheet Excel template generator
│   ├── sampleDataset.ts          # Industry-specific demonstration datasets
│   └── security.ts               # Rate limiters & company/platform audit log store
└── src/
    ├── App.tsx                   # Main workspace state coordinator & RBAC-aware navigation shell
    ├── types/churn.ts            # Shared strict TypeScript domain contracts
    ├── utils/                    # apiClient, industryConfig, subscriptionPlans, churnIntelligence, reportExporter
    └── components/               # Modular React views, Recharts dashboards, DataReadinessPanel & Three.js scenes
```

### Persistence & Deployment Architecture
1. **Stateful Node Hosting (Recommended for Zero-Setup Persistence):** Run `npm run build` followed by `npm start` (`node server.ts`) with persistent disk storage mounted on `.data/` (or `CHURNSIGHT_DATA_DIR`).
2. **Vercel Serverless Hosting (`vercel.json` + `api/index.ts`):** Builds `dist/` via Vite and routes `/api/*` to the Express serverless function (`createApiApp()`), automatically falling back to writable `os.tmpdir()/churnsight-data` (`VERCEL=1`). *Note: Serverless `/tmp` storage is ephemeral across cold starts until migrated to a hosted database.*

---

## 9. Complete REST API Specification

### 9.1 Health & Authentication
| Method | Endpoint | Auth / Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Liveness check (`{ status: 'ok' }`) |
| `GET` | `/api/auth/status` | Public | Checks whether any workspaces exist |
| `POST` | `/api/auth/register-company` | Public (Rate-limited) | Creates isolated company workspace + Firm Admin user |
| `POST` | `/api/auth/login` | Public (Rate-limited) | Authenticates user, sets session cookie & returns `sessionToken` |
| `POST` | `/api/auth/logout` | Session | Revokes active session & records audit log |
| `GET` | `/api/auth/me` | Session | Returns current authenticated user & company |
| `POST` | `/api/auth/forgot-password` | Public (Rate-limited) | Checks registration status & logs password reset request |
| `PATCH` | `/api/auth/profile` | Auth | Updates own name/avatar |
| `POST` | `/api/auth/change-password` | Auth | Verifies current password & updates credentials |

### 9.2 Company, Privacy, Users & Workspace State
| Method | Endpoint | Auth / Role | Purpose |
| :--- | :--- | :--- | :--- |
| `PUT` | `/api/company` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Updates company profile, industry, relationship type, branding |
| `PUT` | `/api/company/churn-definition` | `canUploadAndAnalyse` | Saves & confirms churn trigger, period, denominator & inactivity rules |
| `PUT` | `/api/company/privacy` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Updates opt-in cross-company governance flags |
| `GET` | `/api/workspace/usage` | Auth | Returns plan quotas, user/record/storage counts |
| `GET` | `/api/state` | Auth | Hydrates full workspace (company, dataset, analytics, active model, history, pipeline) |
| `GET` | `/api/audit-logs` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Retrieves tenant audit trail (plan-gated) |
| `GET` | `/api/users` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Lists team members in company workspace |
| `POST` | `/api/users` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Invites/creates analyst or admin account within quota |
| `PATCH` | `/api/users/:userId` | `FIRM_ADMIN`, `PLATFORM_OWNER` | Updates user role, active status, permissions, or resets password |

### 9.3 Dataset Templates, Ingestion, Readiness & Outcome Recording
| Method | Endpoint | Auth / Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/dataset/sample-csv` | Auth | Downloads sample CSV for workspace industry |
| `GET` | `/api/dataset/template` | Auth | Generates industry CSV or multi-sheet `.xlsx` (`labeled` / `cold_start`) |
| `GET` | `/api/dataset/readiness` | Auth | Returns current `DataReadinessAssessment`, template specs & privacy state |
| `POST` | `/api/dataset/load-sample` | `canUploadAndAnalyse` | Loads industry demo dataset & runs automated prediction setup |
| `POST` | `/api/dataset/stage` | `canUploadAndAnalyse` | Parses CSV/Excel, profiles hygiene/dates/casing, suggests mappings & rationales |
| `POST` | `/api/dataset/commit` | `canUploadAndAnalyse` | Commits staged dataset with user-confirmed mapping & churn rules |
| `POST` | `/api/dataset/upload` | `canUploadAndAnalyse` | Direct CSV/Excel ingestion fallback |
| `PUT` | `/api/dataset/mapping` | `canUploadAndAnalyse` | Updates column mapping & re-evaluates readiness/model |
| `POST` | `/api/dataset/record-outcome` | `canUploadAndAnalyse` | Records observed `Churned` / `Retained` outcomes & auto-builds ML when ready |
| `GET` | `/api/dataset/rows` | Auth | Paginated, searchable dataset rows |
| `POST` | `/api/analytics/filter` | Auth | Filtered exploratory analytics & cold-start watchlist recalculation |

### 9.4 Machine Learning, Predictions & Exports
| Method | Endpoint | Auth / Role | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/model/auto-build` | `canGeneratePredictions` | Runs automated candidate model selection & quality gates |
| `POST` | `/api/model/train` | `canGeneratePredictions` | Manual model training with algorithm & split strategy choice |
| `POST` | `/api/model/predict-single` | `canGeneratePredictions` | Scores a single customer profile with risk breakdown |
| `POST` | `/api/model/batch-score` | `canGeneratePredictions` | Batch scores uploaded CSV/Excel file (plan-gated) |
| `GET` | `/api/model/export-batch/:batchId` | Auth | Downloads scored CSV for a batch job (formula-injection escaped) |
| `GET` | `/api/model/export-predictions` | Auth | Exports high-risk predictions from active workspace dataset |

### 9.5 Platform Governance (`PLATFORM_OWNER`)
| Method | Endpoint | Auth / Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/platform/overview` | `PLATFORM_OWNER` | Multi-tenant summary, plan list, platform audit logs & billing status |
| `PATCH` | `/api/platform/companies/:companyId/plan` | `PLATFORM_OWNER` | Assigns subscription plan tier to a tenant company |

---

## 10. Non-Functional Requirements

| Category | Requirement |
| :--- | :--- |
| **Security & Isolation** | All tenant reads/writes strictly scoped by `req.auth.company.id`. CSV exports neutralize formula injection (`=`, `+`, `-`, `@`). Password hashes use random salt + `scrypt`. |
| **Data Integrity** | Never coerce missing/blank churn outcomes or inactive accounts into `"Churned"` unless explicitly configured; never silently discard invalid dates (`invalidDateCount` surfaced to user). |
| **Model Integrity** | Exclude identifier, raw date, and post-churn leakage columns before model training; withhold models scoring `0%` churn recall on positive test folds. |
| **Performance** | Express JSON body limit `25 MB` for large CSV/Excel uploads; in-memory workspace cache backed by per-tenant disk snapshots; responsive sub-second UI filtering. |
| **Compatibility** | Modern evergreen desktop & mobile browsers (Chrome, Edge, Safari, Firefox) with responsive Tailwind layout. |

---

## 11. Current Implementation Status & Future Roadmap

### 11.1 Currently Implemented & Verified
- Complete multi-tenant auth, RBAC, session management, and audit logging.
- All 9 industry profiles, pre-upload churn definitions, and CSV/Excel template exports.
- Staging workflow with mapping rationales, invalid date detection, and category hygiene checks.
- 0–100 Data Readiness Centre with 4 readiness tiers, cold-start behaviour monitoring watchlists, and longitudinal outcome recording.
- Automated ML pipeline (Logistic Regression, Decision Tree, Random Forest), hold-out evaluation, quality gates, single/batch prediction, and PDF/CSV reporting.
- Vercel serverless compatibility (`api/index.ts`, `vercel.json`, `/tmp` fallback) and stateful Node server (`server.ts`).

### 11.2 Architectural / Planned Enhancements
1. **Hosted Database Backend (PostgreSQL / Firestore):** Migrate `.data/` JSON file persistence (`authStore`, `workspaceStore`, `security`) to a durable cloud database so Vercel serverless deployments persist across cold starts and scale horizontally.
2. **Live Stripe Billing & Webhooks:** Wire `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to live Stripe Checkout sessions and automated tier upgrades.
3. **Validated Cross-Company Baseline Corpus:** Build an opt-in, differentially private / anonymized cross-company training pipeline before flipping `crossCompanyValidationStatus` from `unvalidated_architecture_only` to active transfer baselines.
4. **Scheduled CRM / Billing Connectors:** Automated webhook & API ingestion from Stripe, HubSpot, Salesforce, and Shopify into the staging/readiness pipeline.
