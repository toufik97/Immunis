function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("immunis-session");
    return t ? { "x-api-token": t } : {};
  } catch {
    return {};
  }
}

function saveSession(token: string): void {
  try {
    localStorage.setItem("immunis-session", token);
  } catch {
    /* private mode: session lasts this tab */
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem("immunis-session");
  } catch {
    /* nothing stored */
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...init,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export interface Child {
  id: string;
  familyName: string;
  givenName: string;
  birthDate: string;
  sex?: "M" | "F" | null;
  fatherName?: string;
  motherName?: string;
  address?: string;
  localIds: { centreId: string; value: string }[];
}

export interface Dose {
  id?: string;
  encounterId?: string;
  productGroupId: string;
  administeredOn: string;
  origin: "CENTRE" | "EXTERNAL" | "CAMPAIGN";
  lotId?: string;
  overridden: boolean;
  recordedBy: string;
  invalidatedAt?: string | null;
  invalidatedReason?: string | null;
}

export interface EncounterHistory {
  id: string;
  childId: string;
  date: string;
  screening: string;
  doseIds: string[];
  voidRequestedBy: string | null;
  voidRequestedAt: string | null;
  voidRequestReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  reinstatedAt: string | null;
  reinstatedBy: string | null;
  reinstatedReason: string | null;
  products: string[];
}

export interface ReviewQueue {
  flagged: Record<string, unknown>[];
  voided: Record<string, unknown>[];
  invalidated: Record<string, unknown>[];
}

export interface Lot {
  id: string;
  productGroupId: string;
  lotNumber: string;
  expiryDate: string;
  coldChainOk: boolean;
  qtyOnHand: number;
}

export interface Appointment {
  id: string;
  childId: string;
  childName?: string;
  localIds?: { centreId: string; value: string }[];
  address?: string | null;
  dueDate: string;
  expectedProducts: string[];
  kept: boolean | null;
  lastVisitDate?: string | null;
  daysOverdue?: number;
  slot?: "AM" | "PM" | null;
}

export interface SchedulingRule {
  scope: string;
  weekday: number;
  slot: "AM" | "PM";
  cap: number;
}

export interface ClosureDate {
  date: string;
  label: string;
  source: "auto" | "manual";
}

export interface SchedulingIssue {
  code: "closed_day" | "slot_full" | "closure_day" | "beyond_horizon";
  productGroupId: string | null;
  booked: number | null;
  cap: number | null;
  limit: string | null;
}

export interface DuplicateChild extends Child {
  localIds: { centreId: string; value: string }[];
}

export interface PlannedDose {
  programId: string;
  doseNumber: number;
  amount?: { value: number; unit: string };
}

export interface PlannedVisit {
  visitNumber: number;
  date: string;
  products: string[];
  status: string;
  doses?: PlannedDose[];
}

export interface AntigenNeed {
  programId: string;
  status: string;
  dosesNeeded: number;
  validDosesReceived: number;
  counterId: string;
  targetProduct?: string | null;
  matchedRuleId?: string | null;
  warnings: string[];
}

export interface ValidatedDose {
  doseNumber: number;
  productGroupId: string;
  administeredOn: string;
  valid: boolean;
  reasons: string[];
  warnings: string[];
}

export interface EvaluateResult {
  antigenNeeds: AntigenNeed[];
  productSelection: { primarySlots: { products: { productGroupId: string }[] }[] };
  visitPlan: { visits: PlannedVisit[]; warnings: string[] };
  doseValidations: Record<string, { counterId: string; doses: ValidatedDose[]; validDoseCount: number }>;
  assumptions?: string[];
  inputWarnings?: string[];
}

export interface GateIssue {
  doseIndex: number;
  productGroupId: string;
  administeredOn: string;
  code: string;
  message: string;
  overridable: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: "nurse" | "admin" | "reader";
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
  authStatus: () => req<{ needsBootstrap: boolean; userCount: number }>("/api/auth/status"),
  login: async (username: string, password: string) => {
    const r = await req<{ user: AuthUser; sessionId: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    saveSession(r.sessionId);
    return r;
  },
  logout: async () => {
    try {
      await req<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
    } finally {
      clearSession();
    }
  },
  me: () => req<{ user: AuthUser }>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  bootstrap: (body: { username: string; fullName: string; password: string }) =>
    req<{ user: AuthUser }>("/api/auth/bootstrap", { method: "POST", body: JSON.stringify(body) }),
  users: () => req<AuthUser[]>("/api/users"),
  createUser: (body: { username: string; fullName: string; role: string; password: string }) =>
    req<{ user: AuthUser }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: { active?: boolean; role?: string; password?: string }) =>
    req<{ ok: boolean }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionGrants: () => req<{ id: string; userId: string; expiresAt: string }[]>("/api/transition-grants"),
  grantHistory: () => req<{ id: string; userId: string; username: string; grantedByName: string; reason: string; expiresAt: string; revokedAt: string | null; createdAt: string }[]>("/api/transition-grants?history=1"),
  grantTransition: (body: { userId: string; reason: string; expiresAt: string }) =>
    req<{ id: string }>("/api/transition-grants", { method: "POST", body: JSON.stringify(body) }),
  revokeGrant: (id: string) => req<{ ok: boolean }>(`/api/transition-grants/${id}/revoke`, { method: "POST", body: "{}" }),
  overrides: (limit = 200) => req<{ id: string; childId: string; childName: string; encounterId?: string; encounterDate: string | null; author: string; what: string; reason: string; createdAt: string }[]>(`/api/overrides?limit=${limit}`),
  auditLog: (params: { q?: string; action?: string; username?: string; from?: string; to?: string; sort?: string; order?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    return req<{ rows: { id: string; createdAt: string; userId: string | null; username: string; action: string; details: string | null; childId: string | null; childName: string | null }[]; total: number }>(`/api/audit${s ? `?${s}` : ""}`);
  },
  auditActions: () => req<string[]>("/api/audit/actions"),
  /** Whole-centre JSON dump (admin only): fetched as a file, not parsed. */
  backup: async (): Promise<Blob> => {
    const res = await fetch("/api/backup", { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Backup failed (${res.status})`);
    return res.blob();
  },
  pack: () =>
    req<{
      country: string;
      packId: string;
      version: string;
      status: string;
      clinicalApproval: string;
      productGroups: { id: string; label_fr?: string }[];
      programs: { id: string; label_fr?: string }[];
    }>("/api/pack"),
  searchChildren: (q: string) =>
    req<Child[]>(`/api/children?q=${encodeURIComponent(q)}`),
  allChildren: () => req<Child[]>("/api/children"),
  child: (id: string) => req<Child>(`/api/children/${id}`),
  childDoses: (childId: string) => req<Dose[]>(`/api/children/${childId}/doses`),
  childEncounters: (childId: string) => req<EncounterHistory[]>(`/api/children/${childId}/encounters`),
  childAppointments: (childId: string) => req<Appointment[]>(`/api/children/${childId}/appointments`),
  updateAppointment: async (id: string, body: { dueDate: string; slot?: "AM" | "PM"; expectedProducts: string[]; overrideReason?: string }) => {
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Appointment & { error?: string; issues?: SchedulingIssue[] };
    if (!res.ok) {
      const e = new Error(data.error ?? `Request failed (${res.status})`) as Error & {
        issues?: SchedulingIssue[];
      };
      e.issues = data.issues;
      throw e;
    }
    return data as Appointment;
  },
  flagVoid: (encounterId: string, reason: string) =>
    req<{ ok: boolean }>(`/api/encounters/${encounterId}/flag-void`, { method: "POST", body: JSON.stringify({ reason }) }),
  voidEncounter: (encounterId: string, reason: string) =>
    req<{ ok: boolean }>(`/api/encounters/${encounterId}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
  reinstateEncounter: (encounterId: string, reason: string) =>
    req<{ ok: boolean }>(`/api/encounters/${encounterId}/reinstate`, { method: "POST", body: JSON.stringify({ reason }) }),
  invalidateDose: (doseId: string, reason: string) =>
    req<{ ok: boolean }>(`/api/doses/${doseId}/invalidate`, { method: "POST", body: JSON.stringify({ reason }) }),
  revalidateDose: (doseId: string, reason: string) =>
    req<{ ok: boolean }>(`/api/doses/${doseId}/revalidate`, { method: "POST", body: JSON.stringify({ reason }) }),
  reviewQueue: () => req<ReviewQueue>("/api/review-queue"),
  childGrowth: (childId: string) =>
    req<{
      points: {
        date: string;
        ageDays: number;
        ageMonths: number;
        weightKg: number | null;
        heightCm: number | null;
        bmi: number | null;
        z: { wfa: number | null; lhfa: number | null; bfa: number | null; wfl: number | null };
      }[];
      refs: Record<"wfa" | "lhfa" | "bfa" | "wfl", { xs: number[]; neg2: number[]; med: number[]; pos2: number[] }>;
      wflKind: "length" | "height";
    }>(`/api/children/${childId}/growth`),

  outbox: () => req<{ id: string; kind: string }[]>("/api/outbox"),
  outboxCount: () => req<{ pending: number }>("/api/outbox/count"),
  /** Registration with duplicate surfacing: 409 carries possible matches. */
  registerChildDetailed: async (
    body: Record<string, unknown>
  ): Promise<{ status: "created"; child: Child } | { status: "duplicate"; duplicates: DuplicateChild[] }> => {
    const res = await fetch("/api/children", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Child & { error?: string; duplicates?: DuplicateChild[] };
    if (res.status === 409) return { status: "duplicate", duplicates: data.duplicates ?? [] };
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return { status: "created", child: data };
  },
  /** Recording with engine-gate surfacing: 400/422 with issues become gated. */
  recordEncounterDetailed: async (
    body: Record<string, unknown>
  ): Promise<{ status: "recorded" } | { status: "gated"; issues: GateIssue[]; error: string }> => {
    const res = await fetch("/api/encounters", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string; issues?: GateIssue[] };
    if ((res.status === 422 || res.status === 400) && data.issues?.length) {
      return { status: "gated", issues: data.issues, error: data.error ?? "" };
    }
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return { status: "recorded" };
  },
  evaluate: (body: unknown) => req<EvaluateResult>("/api/evaluate", { method: "POST", body: JSON.stringify(body) }),
  session: (date: string) =>
    req<{
      date: string;
      expected: Appointment[];
      probable?: (Appointment & { likelihood?: string; daysOverdue?: number })[];
      possible?: (Appointment & { likelihood?: string; daysOverdue?: number })[];
      counters: { children: number; dosesByProduct: Record<string, number> };
      tiers?: {
        due: { children: number; dosesByProduct: Record<string, number> };
        probable: { children: number; dosesByProduct: Record<string, number> };
        possible: { children: number; dosesByProduct: Record<string, number> };
      };
      backlog?: { children: number; doses: number };
      results?: {
        planned: number;
        plannedChildren: number;
        plannedDoses?: Record<string, number>;
        kept: number;
        childrenSeen: number;
        dosesByProduct: Record<string, number>;
        seen?: { childId: string; childName: string; localIds?: { centreId: string; value: string }[]; address?: string | null; dosesGiven: string[]; bookedToday?: boolean; expectedToday?: string[] }[];
        missed?: Appointment[];
      };
    }>(`/api/sessions?date=${date}`),
  agenda: (from?: string, to?: string) => {
    const q = [from ? `from=${from}` : "", to ? `to=${to}` : ""].filter(Boolean).join("&");
    return req<{ date: string; children: number; doses: number }[]>(`/api/sessions/agenda${q ? `?${q}` : ""}`);
  },
  noShows: (asOf: string) => req<Appointment[]>(`/api/no-shows?asOf=${asOf}`),
  createAppointment: async (body: { childId: string; dueDate: string; expectedProducts: string[]; slot?: "AM" | "PM"; overrideReason?: string; engineDate?: string }) => {
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Appointment & { error?: string; issues?: SchedulingIssue[] };
    if (!res.ok) {
      const e = new Error(data.error ?? `Request failed (${res.status})`) as Error & {
        issues?: SchedulingIssue[];
      };
      e.issues = data.issues;
      throw e;
    }
    return data as Appointment;
  },
  scheduling: () =>
    req<{ rules: SchedulingRule[]; horizonDays: number | null }>("/api/scheduling"),
  suggestSlot: (from: string, products: string[], slot: "AM" | "PM" = "AM") =>
    req<{ date: string; slot: "AM" | "PM" } | null>(
      `/api/scheduling/suggest?from=${from}&products=${products.join(",")}&slot=${slot}`
    ),
  saveScheduling: (body: { rules: SchedulingRule[]; horizonDays: number | null }) =>
    req<{ rules: SchedulingRule[]; horizonDays: number | null }>("/api/scheduling", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  closures: (year?: string) =>
    req<ClosureDate[]>(`/api/closures${year ? `?year=${year}` : ""}`),
  addClosure: (body: { date: string; label: string }) =>
    req<ClosureDate>("/api/closures", { method: "POST", body: JSON.stringify(body) }),
  deleteClosure: (date: string) => req<{ ok: boolean }>(`/api/closures/${date}`, { method: "DELETE" }),
  pullClosures: (year: number) =>
    req<{ added: number; holidays: ClosureDate[] }>("/api/closures/pull", {
      method: "POST",
      body: JSON.stringify({ year }),
    }),
  lots: (product?: string, usableOn?: string) =>
    req<Lot[]>(
      product
        ? `/api/lots?product=${encodeURIComponent(product)}${usableOn ? `&usableOn=${usableOn}` : ""}`
        : usableOn
          ? `/api/lots?usableOn=${usableOn}`
          : "/api/lots"
    ),
  addLot: (body: Record<string, unknown>) =>
    req<Lot>("/api/lots", { method: "POST", body: JSON.stringify(body) }),
};
