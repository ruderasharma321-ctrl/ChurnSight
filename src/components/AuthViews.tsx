import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import {
  AuthSessionPayload,
  BusinessModel,
  BusinessType,
  CustomerRelationshipType,
  IndustryKey,
} from '../types/churn';
import {
  BUSINESS_MODEL_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  CUSTOMER_RELATIONSHIP_OPTIONS,
  INDUSTRY_OPTIONS,
  getDefaultRelationshipForIndustry,
} from '../utils/industryConfig';
import { apiFetch } from '../utils/apiClient';

type AuthMode = 'login' | 'register' | 'forgot';

interface AuthViewsProps {
  onAuthenticated: (payload: AuthSessionPayload) => void;
  sessionNotice?: string | null;
}

export const AuthViews: React.FC<AuthViewsProps> = ({ onAuthenticated, sessionNotice }) => {
  const [mode, setMode] = useState<AuthMode>('login');

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Company Registration State
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [industry, setIndustry] = useState<IndustryKey>('telecommunications');
  const [customIndustryName, setCustomIndustryName] = useState('');
  const [country, setCountry] = useState('Malaysia');
  const [businessType, setBusinessType] = useState<BusinessType>('B2C');
  const [businessModel, setBusinessModel] = useState<BusinessModel>('Subscription / Recurring');
  const [customerRelationshipType, setCustomerRelationshipType] =
    useState<CustomerRelationshipType>('Contractual / Recurring Subscription');
  const [relationshipTouched, setRelationshipTouched] = useState(false);
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Forgot Password State
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const [hasRegisteredWorkspaces, setHasRegisteredWorkspaces] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.hasRegisteredWorkspaces === 'boolean') {
          setHasRegisteredWorkspaces(data.hasRegisteredWorkspaces);
        }
      })
      .catch(() => {
        // Ignore non-critical check failure
      });
    return () => {
      active = false;
    };
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setLoginError(null);
    setRegError(null);
    setForgotError(null);
    setForgotMessage(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSuccess(null);

    const emailTrimmed = loginEmail.trim();
    if (!emailTrimmed) {
      setLoginError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setLoginError('Please enter a valid email address.');
      return;
    }
    if (!loginPassword) {
      setLoginError('Please enter your password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailTrimmed,
          password: loginPassword,
          rememberMe,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Unable to sign in. Please check your credentials.');
        return;
      }
      onAuthenticated({
        user: data.user,
        company: data.company,
        expiresAt: data.expiresAt,
        sessionToken: data.sessionToken,
      });
    } catch {
      setLoginError('Unable to reach the authentication server. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    if (companyName.trim().length < 2) {
      setRegError('Company name must be at least 2 characters long.');
      return;
    }
    if (industry === 'other' && !customIndustryName.trim()) {
      setRegError('Please specify your custom industry name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail.trim())) {
      setRegError('Please provide a valid company email address.');
      return;
    }
    if (adminFullName.trim().length < 2) {
      setRegError('Administrator full name must be at least 2 characters long.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) {
      setRegError('Please provide a valid administrator email address.');
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters long.');
      return;
    }
    if (regPassword !== confirmPassword) {
      setRegError('Password and confirm password do not match.');
      return;
    }

    setIsRegistering(true);
    try {
      const res = await apiFetch('/api/auth/register-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          companyEmail: companyEmail.trim(),
          registrationNumber: registrationNumber.trim() || undefined,
          industry,
          customIndustryName: industry === 'other' ? customIndustryName.trim() : undefined,
          country: country.trim() || 'Malaysia',
          businessType,
          businessModel,
          customerRelationshipType,
          adminFullName: adminFullName.trim(),
          adminEmail: adminEmail.trim(),
          password: regPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || 'Company registration failed.');
        return;
      }

      const registeredEmail = data.user?.email || adminEmail.trim();
      const registeredCompany = data.company?.name || companyName.trim();

      setHasRegisteredWorkspaces(true);
      setLoginEmail(registeredEmail);
      setLoginPassword('');
      setLoginSuccess(
        `Workspace "${registeredCompany}" and Firm Admin account for ${data.user?.fullName || adminFullName.trim()} were created. Sign in below to launch your workspace.`
      );
      setCompanyName('');
      setCompanyEmail('');
      setRegistrationNumber('');
      setCustomIndustryName('');
      setAdminFullName('');
      setAdminEmail('');
      setRegPassword('');
      setConfirmPassword('');
      setMode('login');
    } catch {
      setRegError('Network error while creating company workspace.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
      setForgotError('Please enter a valid email address.');
      return;
    }

    setIsSendingReset(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.error || 'Unable to process request.');
        return;
      }
      setForgotMessage(data.message);
    } catch {
      setForgotError('Network error while contacting the server.');
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F3FF] flex flex-col lg:flex-row">
      {/* Left Brand Showcase Panel */}
      <aside className="relative lg:w-[46%] xl:w-[48%] bg-[#11142B] text-white p-8 sm:p-12 flex flex-col justify-between overflow-hidden shrink-0">
        {/* Vibrant Gradient Ambient Orbs */}
        <div className="absolute -top-28 -left-24 w-96 h-96 rounded-full bg-[#7655E8]/35 blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full bg-[#E84FA8]/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-96 h-96 rounded-full bg-[#397BFF]/25 blur-3xl pointer-events-none" />

        {/* Brand Lockup */}
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7655E8] via-[#B84DE0] to-[#E84FA8] flex items-center justify-center shadow-lg shadow-[#7655E8]/40 shrink-0">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-xl font-bold tracking-tight text-white">ChurnSight</div>
              <div className="text-xs font-medium text-indigo-200/80">
                Customer Churn Analysis &amp; Prediction
              </div>
            </div>
          </div>

          <div className="pt-4 lg:pt-8 space-y-4 max-w-lg">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#E84FA8] tracking-wide">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Multi-Industry Customer Intelligence SaaS</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.15] text-balance">
              Turn Customer Data Into Smarter Decisions.
            </h1>
            <p className="text-sm sm:text-base text-indigo-100/80 leading-relaxed">
              Configurable tenant-isolated workspaces across Telecom, Banking, Retail, SaaS,
              Healthcare, Insurance, Education, and Fitness—complete with custom churn definitions,
              CSV &amp; Excel ingestion, and supervised ML scoring.
            </p>
          </div>
        </div>

        {/* Decorative Analytics Illustration */}
        <div className="relative z-10 my-8 hidden sm:block">
          <div className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-5 shadow-2xl max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-white/90">
                  Retention Risk Intelligence
                </div>
                <div className="text-[11px] text-indigo-200/70">
                  Logistic Regression, Decision Tree &amp; Random Forest
                </div>
              </div>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-white/[0.06] border border-white/10 p-3">
                <div className="text-[11px] text-indigo-200/70">Isolation</div>
                <div className="text-sm font-bold text-white mt-0.5">Per-Firm</div>
              </div>
              <div className="rounded-xl bg-white/[0.06] border border-white/10 p-3">
                <div className="text-[11px] text-indigo-200/70">Access Control</div>
                <div className="text-sm font-bold text-[#397BFF] mt-0.5">Role-Based</div>
              </div>
              <div className="rounded-xl bg-white/[0.06] border border-white/10 p-3">
                <div className="text-[11px] text-indigo-200/70">ML Scoring</div>
                <div className="text-sm font-bold text-[#E84FA8] mt-0.5">Real-Time</div>
              </div>
            </div>

            {/* Abstract Gradient Spark Bars */}
            <div className="flex items-end gap-2 h-16 px-1 pt-2 border-t border-white/10">
              <div className="flex-1 h-[40%] rounded-t-md bg-[#397BFF]/45" />
              <div className="flex-1 h-[62%] rounded-t-md bg-[#7655E8]/60" />
              <div className="flex-1 h-[48%] rounded-t-md bg-[#B84DE0]/60" />
              <div className="flex-1 h-[78%] rounded-t-md bg-gradient-to-t from-[#7655E8] to-[#397BFF]" />
              <div className="flex-1 h-[58%] rounded-t-md bg-[#E84FA8]/65" />
              <div className="flex-1 h-[94%] rounded-t-md bg-gradient-to-t from-[#B84DE0] to-[#E84FA8]" />
            </div>
          </div>
        </div>

        {/* Quiet Footer */}
        <div className="relative z-10 text-xs text-indigo-200/65 flex flex-wrap items-center gap-2 pt-4 border-t border-white/10">
          <span>ChurnSight Enterprise SaaS</span>
          <span aria-hidden="true">·</span>
          <span>Secure Workspace Authentication</span>
        </div>
      </aside>

      {/* Right Authentication Form Canvas */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-lg space-y-6">
          {/* Mode Switcher (Sign In / Register Company) */}
          {mode !== 'forgot' && (
            <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-white border border-purple-100 rounded-2xl shadow-sm shadow-purple-950/[0.03]">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-2.5 px-4 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-gradient-to-r from-[#7655E8] to-[#B84DE0] text-white shadow-sm shadow-[#7655E8]/25'
                    : 'text-slate-600 hover:text-[#11142B]'
                }`}
              >
                Sign In to Workspace
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-2.5 px-4 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-gradient-to-r from-[#7655E8] to-[#E84FA8] text-white shadow-sm shadow-[#7655E8]/25'
                    : 'text-slate-600 hover:text-[#11142B]'
                }`}
              >
                Register Company
              </button>
            </div>
          )}

          {/* Session Expired / Logout Notice */}
          {sessionNotice && (
            <div className="bg-[#397BFF]/10 border border-[#397BFF]/30 rounded-2xl px-4 py-3 flex items-start gap-2.5 text-xs text-[#11142B]">
              <Info className="w-4 h-4 text-[#397BFF] shrink-0 mt-0.5" />
              <span>{sessionNotice}</span>
            </div>
          )}

          {/* LOGIN CARD */}
          {mode === 'login' && (
            <div className="bg-white border border-purple-100/90 rounded-3xl shadow-xl shadow-purple-950/[0.06] p-7 sm:p-9 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-[#11142B] tracking-tight">Welcome back</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Sign in with your company account credentials to access your ChurnSight workspace.
                </p>
              </div>

              {hasRegisteredWorkspaces === false && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-amber-950 leading-relaxed">
                  <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p>
                      <strong>No company workspaces exist on this server yet.</strong> Local
                      workspace storage is currently empty (for example, after an environment
                      reset).
                    </p>
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="font-bold text-[#7655E8] hover:text-[#E84FA8] underline underline-offset-2 cursor-pointer"
                    >
                      Register a Company Workspace to create your Firm Admin login →
                    </button>
                  </div>
                </div>
              )}

              {loginSuccess && (
                <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-[#065F46]">
                  <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
                  <span>{loginSuccess}</span>
                </div>
              )}

              {loginError && (
                <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
                  <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#7655E8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#7655E8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showLoginPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-10 pr-11 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPw((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                      aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                    >
                      {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-purple-300 text-[#7655E8] accent-[#7655E8]"
                    />
                    <span>Remember me (30 days)</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(loginEmail);
                      switchMode('forgot');
                    }}
                    className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-[#7655E8] via-[#B84DE0] to-[#E84FA8] hover:opacity-95 text-white text-sm font-bold rounded-xl shadow-lg shadow-[#7655E8]/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <span>{isLoggingIn ? 'Signing In...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="pt-4 border-t border-purple-100 text-center text-xs text-slate-500">
                New organisation on ChurnSight?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="font-bold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                >
                  Create a Company Workspace
                </button>
              </div>
            </div>
          )}

          {/* COMPANY REGISTRATION CARD */}
          {mode === 'register' && (
            <div className="bg-white border border-purple-100/90 rounded-3xl shadow-xl shadow-purple-950/[0.06] p-7 sm:p-8 space-y-5">
              <div>
                <h2 className="text-2xl font-bold text-[#11142B] tracking-tight">
                  Register Company Workspace
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Provision a private company environment and its initial Firm Administrator account.
                </p>
              </div>

              {regError && (
                <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
                  <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} className="space-y-4" noValidate>
                <div className="space-y-3">
                  <div className="text-xs font-bold text-[#7655E8] tracking-wide">
                    Company Details
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="reg-company-name"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Company Name <span className="text-[#E04F44]">*</span>
                      </label>
                      <div className="relative">
                        <Building2 className="w-4 h-4 text-[#7655E8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="reg-company-name"
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="e.g., ABC Telecom Sdn. Bhd."
                          className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-company-email"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Company Email <span className="text-[#E04F44]">*</span>
                      </label>
                      <input
                        id="reg-company-email"
                        type="email"
                        value={companyEmail}
                        onChange={(e) => setCompanyEmail(e.target.value)}
                        placeholder="analytics@company.com"
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="reg-company-regno"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Registration No. (Optional)
                      </label>
                      <input
                        id="reg-company-regno"
                        type="text"
                        value={registrationNumber}
                        onChange={(e) => setRegistrationNumber(e.target.value)}
                        placeholder="e.g., 202401012345"
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] font-mono focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="reg-industry"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Industry Sector <span className="text-[#E04F44]">*</span>
                      </label>
                      <select
                        id="reg-industry"
                        value={industry}
                        onChange={(e) => {
                          const nextIndustry = e.target.value as IndustryKey;
                          setIndustry(nextIndustry);
                          if (!relationshipTouched) {
                            setCustomerRelationshipType(
                              getDefaultRelationshipForIndustry(nextIndustry)
                            );
                          }
                        }}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      >
                        {INDUSTRY_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-country"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Country / Region
                      </label>
                      <input
                        id="reg-country"
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="e.g., Malaysia, Singapore, US"
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      />
                    </div>

                    {industry === 'other' && (
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="reg-custom-industry"
                          className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                        >
                          Custom Industry Name <span className="text-[#E04F44]">*</span>
                        </label>
                        <input
                          id="reg-custom-industry"
                          type="text"
                          value={customIndustryName}
                          onChange={(e) => setCustomIndustryName(e.target.value)}
                          placeholder="e.g., Logistics & Fleet Operations"
                          className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                        />
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor="reg-business-type"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Business Type
                      </label>
                      <select
                        id="reg-business-type"
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      >
                        {BUSINESS_TYPE_OPTIONS.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-business-model"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Business Model
                      </label>
                      <select
                        id="reg-business-model"
                        value={businessModel}
                        onChange={(e) => setBusinessModel(e.target.value as BusinessModel)}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      >
                        {BUSINESS_MODEL_OPTIONS.map((bm) => (
                          <option key={bm} value={bm}>
                            {bm}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="reg-relationship-type"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Customer Relationship Type
                      </label>
                      <select
                        id="reg-relationship-type"
                        value={customerRelationshipType}
                        onChange={(e) => {
                          setRelationshipTouched(true);
                          setCustomerRelationshipType(e.target.value as CustomerRelationshipType);
                        }}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      >
                        {CUSTOMER_RELATIONSHIP_OPTIONS.map((rt) => (
                          <option key={rt} value={rt}>
                            {rt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-purple-100 space-y-3">
                  <div className="text-xs font-bold text-[#397BFF] tracking-wide">
                    Administrator Account (FIRM ADMIN)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="reg-admin-name"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Administrator Full Name <span className="text-[#E04F44]">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-[#397BFF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="reg-admin-name"
                          type="text"
                          value={adminFullName}
                          onChange={(e) => setAdminFullName(e.target.value)}
                          placeholder="e.g., Ruder Sharma"
                          className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-admin-email"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Administrator Email <span className="text-[#E04F44]">*</span>
                      </label>
                      <input
                        id="reg-admin-email"
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="admin@company.com"
                        className="w-full px-3 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="reg-password"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Password (min 8 chars) <span className="text-[#E04F44]">*</span>
                      </label>
                      <div className="relative">
                        <input
                          id="reg-password"
                          type={showRegPw ? 'text' : 'password'}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          className="w-full pl-3 pr-9 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPw((p) => !p)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                          aria-label={showRegPw ? 'Hide password' : 'Show password'}
                        >
                          {showRegPw ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-confirm-password"
                        className="block text-xs font-semibold text-[#4C4A6E] mb-1"
                      >
                        Confirm Password <span className="text-[#E04F44]">*</span>
                      </label>
                      <div className="relative">
                        <input
                          id="reg-confirm-password"
                          type={showConfirmPw ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          className="w-full pl-3 pr-9 py-2 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPw((p) => !p)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#7655E8] p-1 cursor-pointer"
                          aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          {showConfirmPw ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isRegistering}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-[#7655E8] via-[#B84DE0] to-[#E84FA8] hover:opacity-95 text-white text-sm font-bold rounded-xl shadow-lg shadow-[#7655E8]/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <span>
                    {isRegistering ? 'Creating Workspace...' : 'Create Company & Admin Account'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="pt-3 border-t border-purple-100 text-center text-xs text-slate-500">
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-bold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                >
                  Sign In Instead
                </button>
              </div>
            </div>
          )}

          {/* FORGOT PASSWORD PANEL */}
          {mode === 'forgot' && (
            <div className="bg-white border border-purple-100/90 rounded-3xl shadow-xl shadow-purple-950/[0.06] p-7 sm:p-9 space-y-5">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Sign In</span>
              </button>

              <div>
                <h2 className="text-2xl font-bold text-[#11142B] tracking-tight">
                  Password Recovery
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Enter your account email to check password recovery options for your workspace.
                </p>
              </div>

              {forgotError && (
                <div className="bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-[#9A2E25]">
                  <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
                  <span>{forgotError}</span>
                </div>
              )}

              {forgotMessage && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
                  <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>{forgotMessage}</span>
                </div>
              )}

              <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="block text-xs font-semibold text-[#4C4A6E] mb-1.5"
                  >
                    Account Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-purple-200 bg-[#F5F3FF]/40 text-[#11142B] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSendingReset}
                  className="w-full px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#397BFF] hover:opacity-95 text-white text-sm font-bold rounded-xl shadow-md shadow-[#7655E8]/25 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSendingReset ? 'Checking...' : 'Request Password Reset'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
