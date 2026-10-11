function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("immunis-token");
    return t ? { "x-api-token": t } : {};
  } catch {
    return {};
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
  fatherName?: string;
  motherName?: string;
  address?: string;
  localIds: { centreId: string; value: string }[];
}

export interface Dose {
  productGroupId: string;
  administeredOn: string;
  origin: "CENTRE" | "EXTERNAL" | "CAMPAIGN";
  lotId?: string;
  overridden: boolean;
  recordedBy: string;
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
}

export interface DuplicateChild extends Child {
  localIds: { centreId: string; value: string }[];
}

export interface GateIssue {
  doseIndex: number;
  productGroupId: string;
  administeredOn: string;
  code: string;
  message: string;
  overridable: boolean;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
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
  outbox: () => req<{ id: string; kind: string }[]>("/api/outbox"),
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
  evaluate: (body: unknown) =>
    req<{
      antigenNeeds: { programId: string; status: string; dosesNeeded: number }[];
      productSelection: { primarySlots: { products: { productGroupId: string }[] }[] };
      visitPlan: { visits: { date: string; products: string[]; status: string }[] };
    }>("/api/evaluate", { method: "POST", body: JSON.stringify(body) }),
  session: (date: string) =>
    req<{ expected: Appointment[]; counters: { children: number; dosesByProduct: Record<string, number> } }>(
      `/api/sessions?date=${date}`
    ),
  agenda: (from?: string, to?: string) => {
    const q = [from ? `from=${from}` : "", to ? `to=${to}` : ""].filter(Boolean).join("&");
    return req<{ date: string; children: number; doses: number }[]>(`/api/sessions/agenda${q ? `?${q}` : ""}`);
  },
  noShows: (asOf: string) => req<Appointment[]>(`/api/no-shows?asOf=${asOf}`),
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
