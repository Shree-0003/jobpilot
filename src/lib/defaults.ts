import type { PrefsDoc, ProfilePlain } from "./types";

export function defaultPrefs(userId: string): PrefsDoc {
  return {
    _id: userId,
    userId,
    targetTitles: [],
    keywords: [],
    excludedKeywords: [],
    preferredIndustries: [],
    preferredCompanies: [],
    excludedCompanies: [],
    preferredLocations: [],
    workModes: ["remote", "hybrid", "onsite"],
    experienceMin: 0,
    experienceMax: 50,
    salaryMinLpa: 0,
    salaryPreferredLpa: 0,
    employmentTypes: ["full-time"],
    careerBoards: [],
    excludePreviouslyRejected: true,
    limits: { maxPerDay: 20, maxPerHour: 5, maxPerCompanyPerDay: 3, minMatchScore: 80 },
    autoApplyEnabled: false, // MVP: Human Approval Required for every application
    automationState: "running",
    notifications: { browser: false, highMatchThreshold: 85 },
    updatedAt: new Date(),
  };
}

export const defaultProfilePlain = (): ProfilePlain => ({
  currentLocation: "",
  preferredLocations: [],
  currentDesignation: "",
  links: {},
  employmentTypePref: ["full-time"],
});
