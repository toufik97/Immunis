async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
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
    }>("/api/pack"),
  searchChildren: (q: string) =>
    req<Child[]>(`/api/children?q=${encodeURIComponent(q)}`),
  childDoses: (childId: string) => req<Dose[]>(`/api/children/${childId}/doses`),
  registerChild: (body: Record<string, string>) =>
    req<Child>("/api/children", { method: "POST", body: JSON.stringify(body) }),
  /** Registration with duplicate surfacing: 409 carries possible matches. */
  registerChildDetailed: async (
    body: Record<string, unknown>
  ): Promise<{ status: "created"; child: Child } | { status: "duplicate"; duplicates: DuplicateChild[] }> => {
    const res = await fetch("/api/children", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Child & { error?: string; duplicates?: DuplicateChild[] };
    if (res.status === 409) return { status: "duplicate", duplicates: data.duplicates ?? [] };
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return { status: "created", child: data };
  },
  recordEncounter: (body: unknown) =>
    req<unknown>("/api/encounters", { method: "POST", body: JSON.stringify(body) }),
  /** Recording with engine-gate surfacing: 422 carries waivable issues. */
  recordEncounterDetailed: async (
    body: Record<string, unknown>
  ): Promise<{ status: "recorded" } | { status: "gated"; issues: GateIssue[]; error: string }> => {
    const res = await fetch("/api/encounters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string; issues?: GateIssue[] };
    if (res.status === 422) return { status: "gated", issues: data.issues ?? [], error: data.error ?? "" };
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
  noShows: (asOf: string) => req<Appointment[]>(`/api/no-shows?asOf=${asOf}`),
  lots: (product?: string) =>
    req<Lot[]>(product ? `/api/lots?product=${encodeURIComponent(product)}` : "/api/lots"),
  addLot: (body: Record<string, unknown>) =>
    req<Lot>("/api/lots", { method: "POST", body: JSON.stringify(body) }),
  addOverride: (childId: string, body: Record<string, string>) =>
    req<unknown>(`/api/children/${childId}/overrides`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
