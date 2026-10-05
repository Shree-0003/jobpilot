// Shared document and domain types. Fields named *Enc hold AES-256-GCM ciphertext
// produced by lib/crypto.ts with the owning user's data key.

export type Role = "owner";

export interface UserDoc {
  _id: string;
  email: string; // login identifier (lower-cased)
  passwordHash: string; // Argon2id
  role: Role;
  wrappedDek: string; // per-user data key wrapped by MASTER_KEY
  mfaSecretEnc?: string;
  mfaPendingSecretEnc?: string;
  mfaEnabled: boolean;
  mfaLastStep?: number; // last accepted TOTP step (replay protection)
  recoveryCodeHashes: string[];
  failedLogins: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
}

export interface SessionDoc {
  _id: string;
  tokenHash: string;
  userId: string;
  mfaVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date; // absolute expiry
  ip: string;
  userAgent: string;
}

export interface ProfilePlain {
  currentLocation: string;
  preferredLocations: string[];
  currentDesignation: string;
  links: { linkedin?: string; naukri?: string; portfolio?: string; github?: string; website?: string };
  employmentTypePref: string[];
}
export interface ProfileSensitive {
  fullName: string;
  email: string;
  phone: string;
  dob?: string;
  address?: string;
}
export interface ProfileDoc {
  _id: string; // = userId
  userId: string;
  plain: ProfilePlain;
  sensitiveEnc: string; // JSON(ProfileSensitive)
  updatedAt: Date;
}

export const FACT_CATEGORIES = [
  "skill",
  "certification",
  "experience_years",
  "employer",
  "job_title",
  "education",
  "project",
  "achievement",
  "industry",
  "language",
  "notice_period_days",
  "current_salary",
  "expected_salary",
  "work_authorization",
  "location",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** Categories that never leave the application (not sent to the LLM). */
export const SENSITIVE_FACT_CATEGORIES: FactCategory[] = [
  "current_salary",
  "expected_salary",
  "work_authorization",
  "notice_period_days",
];

export interface FactDoc {
  _id: string;
  userId: string;
  factId: string; // F001
  category: FactCategory;
  label: string; // e.g. "ISO/IEC 27001 Lead Auditor"
  valueEnc: string; // detail / value text
  valueNumeric?: number; // years, days, LPA
  unit?: string;
  verified: boolean;
  source: "user" | "ai_proposed";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface Fact {
  factId: string;
  category: FactCategory;
  label: string;
  value: string;
  valueNumeric?: number;
  unit?: string;
  verified: boolean;
  source: "user" | "ai_proposed";
  version: number;
  updatedAt: string;
}

export interface FactChangeDoc {
  _id: string;
  userId: string;
  factId: string;
  action: "create" | "update" | "verify" | "delete";
  oldEnc?: string;
  newEnc?: string;
  by: "user" | "ai";
  ts: Date;
}

export interface CareerBoard {
  vendor: "greenhouse" | "lever";
  token: string; // company board token, e.g. "gitlab"
}

export interface PrefsDoc {
  _id: string; // userId
  userId: string;
  targetTitles: string[];
  keywords: string[];
  excludedKeywords: string[];
  preferredIndustries: string[];
  preferredCompanies: string[];
  excludedCompanies: string[];
  preferredLocations: string[];
  workModes: ("remote" | "hybrid" | "onsite")[];
  experienceMin: number;
  experienceMax: number;
  salaryMinLpa: number;
  salaryPreferredLpa: number;
  employmentTypes: ("full-time" | "contract" | "internship" | "part-time")[];
  careerBoards: CareerBoard[];
  excludePreviouslyRejected: boolean;
  limits: {
    maxPerDay: number;
    maxPerHour: number;
    maxPerCompanyPerDay: number;
    minMatchScore: number;
  };
  autoApplyEnabled: boolean;
  automationState: "running" | "paused" | "stopped";
  notifications: { browser: boolean; highMatchThreshold: number };
  updatedAt: Date;
}

export interface ResumeDoc {
  _id: string;
  userId: string;
  label: string;
  focusKeywords: string[];
  objectKey: string;
  sha256: string;
  mime: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  size: number;
  scanStatus: "clean" | "rejected";
  scanDetail?: string;
  approved: boolean;
  approvedAt?: Date;
  createdAt: Date;
}

export type Portal = "linkedin" | "naukri" | "greenhouse" | "lever" | "adzuna" | "company" | "email" | "other";
export type JobSource = "manual" | "alert_email" | "mcp_gmail" | "gmail_imap" | "adzuna" | "career_board";

export type JobStatus =
  | "Discovered"
  | "Shortlisted"
  | "Awaiting Approval"
  | "Manual Action Required"
  | "Low Relevance"
  | "Skipped"
  | "Approved"
  | "Dismissed";

export interface JobDoc {
  _id: string;
  userId: string;
  portal: Portal;
  source: JobSource;
  externalJobId?: string;
  url?: string;
  urlCanonical?: string;
  title: string;
  company: string;
  location: string;
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  experienceText?: string;
  salaryText?: string;
  employmentType?: string;
  descriptionSanitized: string;
  applyEmail?: string;
  deadline?: string;
  injectionFlag: boolean;
  injectionSignals: string[];
  dedupeHash: string;
  status: JobStatus;
  statusReason?: string;
  latestEvaluationId?: string;
  matchScore?: number;
  decision?: PolicyDecision;
  discoveredAt: Date;
}

export type Recommendation = "AUTO_APPLY" | "USER_APPROVAL" | "MANUAL" | "SKIP";
export type PolicyDecision = "AUTO_APPLY" | "USER_APPROVAL" | "MANUAL" | "LOW_RELEVANCE" | "SKIP";

export interface RuleResult {
  rule: string;
  passed: boolean;
  detail: string;
  outcome?: PolicyDecision;
}

export interface EvaluationDoc {
  _id: string;
  userId: string;
  jobId: string;
  model: string;
  promptVersion: string;
  aiAvailable: boolean;
  matchScore: number;
  baselineScore: number;
  llmScore?: number;
  subScores: { skills: number; experience: number; location: number; industry: number; education: number };
  strongMatches: { requirement: string; factIds: string[] }[];
  notFoundInProfile: string[];
  userLacks: { requirement: string; factIds: string[] }[];
  riskFlags: string[];
  llmRecommendation?: Recommendation;
  llmReason?: string;
  policyDecision: PolicyDecision;
  policyRules: RuleResult[];
  guardrailNotes: string[];
  recommendedResumeId?: string;
  createdAt: Date;
}

export const APPLICATION_STATUSES = [
  "Discovered",
  "Shortlisted",
  "Awaiting Approval",
  "Applying",
  "Applied",
  "Application Failed",
  "Manual Action Required",
  "Rejected",
  "Interview",
  "Offer",
  "Withdrawn",
  "Closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type AnswerStatus = "drafted" | "human_review_required" | "approved";
export interface ApplicationQuestion {
  id: string;
  question: string;
  answerEnc: string;
  factIds: string[];
  status: AnswerStatus;
  reason?: string;
  sensitive: boolean;
  approvedAt?: Date;
}

export interface ApplicationDoc {
  _id: string;
  userId: string;
  appId: string; // APP-000001
  jobId: string;
  jobTitle: string;
  company: string;
  portal: Portal;
  jobUrl?: string;
  matchScore: number;
  resumeId?: string;
  resumeLabel?: string;
  status: ApplicationStatus;
  automationStatus: "Automated" | "Manual";
  channel: "human_submit" | "email";
  actionReason?: string;
  failureReason?: string;
  questions: ApplicationQuestion[];
  coverLetterEnc?: string;
  coverLetterFlags?: string[];
  followUpDate?: string;
  hiringStatus?: string;
  notesEnc?: string;
  approvedAt: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditDoc {
  _id: string;
  seq: number;
  ts: Date;
  userId: string;
  actor: "user" | "system" | "ai";
  action: string;
  entity?: string;
  entityId?: string;
  details: Record<string, unknown>; // never PII or secrets
  prevHash: string;
  rowHash: string;
}

export type Severity = "info" | "low" | "medium" | "high";
export interface SecurityEventDoc {
  _id: string;
  userId?: string;
  ts: Date;
  type: string;
  severity: Severity;
  ip?: string;
  details: Record<string, unknown>;
}

export interface AiLogDoc {
  _id: string;
  userId: string;
  ts: Date;
  provider: string;
  model: string;
  requestType: "evaluate" | "answer" | "cover_letter";
  promptVersion: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  schemaValid: boolean;
  guardrailResult: "pass" | "corrected" | "rejected" | "unavailable";
  error?: string;
}

export interface NotificationDoc {
  _id: string;
  userId: string;
  ts: Date;
  kind: "high_match" | "action_required" | "application_failed" | "applied" | "security" | "automation";
  title: string;
  body: string;
  link?: string;
  read: boolean;
}
