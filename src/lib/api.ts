import { useQuery } from "@tanstack/react-query";
import type {
  AgentRecommendation,
  Excursion,
  OperationalKPI,
  TimelineEvent,
  Venue,
} from "@/data/mockData";

export interface GuestProfile {
  guestId: string;
  id?: string;
  fullName: string;
  name?: string;
  loyaltyTier: string;
  loyaltyNumber: string;
  cabinNumber: string;
  bookingId: string;
  onboardSpend: number;
  sailingHistory?: number;
  sailingHistoryAvg?: number;
  notes?: string;
  email?: string;
  avatar?: string;
}

export interface IncidentRecord {
  incidentId: string;
  id?: string;
  guestId: string;
  type: string;
  category: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "reviewing" | "approved" | "executed" | "closed" | "pending";
  createdAt: string;
  updatedAt: string;
}

export interface ShipInfo {
  name: string;
  currentVoyage: string;
  currentLocation: string;
  passengers: number;
  crew: number;
  departurePort: string;
  nextPort: string;
  nextPortETA: string;
  voyageDay: number;
  totalDays: number;
  weatherCondition: string;
  seaState: string;
}

interface GuestWithIncidents {
  guest: GuestProfile;
  incidents: IncidentRecord[];
}

export interface PrioritizedIncident {
  incident: IncidentRecord;
  guest: GuestProfile;
  potential: number;
}

export interface ActionProposalAction {
  actionId: string;
  label: string;
  description?: string;
  estimatedValue?: number;
}

export interface ActionProposal {
  proposalId: string;
  agentRunId: string;
  runId: string;
  guestId: string;
  incidentId: string;
  status: string;
  summary?: string;
  reasoning?: string;
  priority?: string;
  actions: ActionProposalAction[];
  interactive?: {
    operatorMessage?: string;
    followUpQuestions?: string[];
    alternativeActions?: ActionProposalAction[];
  };
  approval?: {
    required?: boolean;
    approverRole?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentQueryMetadata {
  sessionId?: string;
  recentTurnsUsed?: number;
  sessionAnchorIncidentId?: string;
  sessionAnchorGuestId?: string;
  llmModel?: string;
  embeddingSource?: string;
  retrievalMode?: string;
  requestedIncidentId?: string;
  incidentLookupStatus?: string;
  requestedGuestId?: string;
  guestLookupStatus?: string;
  indexesAttempted?: string[];
  indexesUsed?: string[];
  contextUsed?: {
    incidentId?: string;
    guestId?: string;
    proposalId?: string;
    hasDefinedActions?: boolean;
    hasDefinedPlaybooks?: boolean;
    chatSessionDocId?: string;
    recentTurnMessageIds?: string[];
    policyRuleIds?: string[];
    playbookIds?: string[];
    allowedActionIds?: string[];
    citations?: string[];
  };
}

export interface AgentQueryResponse {
  response: string;
  incidents?: IncidentRecord[];
  metadata?: AgentQueryMetadata;
}

function parseVoyageNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const matches = value.match(/\d+/g);
  if (!matches || matches.length === 0) {
    return undefined;
  }

  const parsed = matches
    .map((segment) => Number.parseInt(segment, 10))
    .filter((num) => Number.isFinite(num));

  if (parsed.length === 0) {
    return undefined;
  }

  return Math.max(...parsed);
}

function normalizeGuest(guest: Record<string, unknown>): GuestProfile {
  const guestId = String(guest.guestId ?? guest.id ?? "");
  const fullName = String(guest.fullName ?? guest.name ?? "Unknown guest");
  const loyaltyTier = String(guest.loyaltyTier ?? "GOLD").toUpperCase();
  const sailingHistory = parseVoyageNumber(guest.sailingHistory ?? guest.sailingHistoryAvg);

  return {
    guestId,
    id: guest.id ? String(guest.id) : undefined,
    fullName,
    name: guest.name ? String(guest.name) : undefined,
    loyaltyTier,
    loyaltyNumber: String(guest.loyaltyNumber ?? "Unknown"),
    cabinNumber: String(guest.cabinNumber ?? "Unknown"),
    bookingId: String(guest.bookingId ?? "Unknown"),
    onboardSpend: Number(guest.onboardSpend ?? 0),
    sailingHistory,
    sailingHistoryAvg: typeof guest.sailingHistoryAvg === "number" ? guest.sailingHistoryAvg : undefined,
    notes: guest.notes ? String(guest.notes) : undefined,
    email: guest.email ? String(guest.email) : undefined,
    avatar: guest.avatar ? String(guest.avatar) : undefined,
  };
}

function normalizeIncident(incident: Record<string, unknown>): IncidentRecord {
  const nowIso = new Date().toISOString();
  const incidentId = String(incident.incidentId ?? incident.id ?? "");
  const severityValue = String(incident.severity ?? "low").toLowerCase();
  const statusValue = String(incident.status ?? "open").toLowerCase();

  const severity: IncidentRecord["severity"] =
    severityValue === "critical" || severityValue === "high" || severityValue === "medium" || severityValue === "low"
      ? severityValue
      : "low";

  const status: IncidentRecord["status"] =
    statusValue === "open" ||
    statusValue === "reviewing" ||
    statusValue === "approved" ||
    statusValue === "executed" ||
    statusValue === "closed" ||
    statusValue === "pending"
      ? statusValue
      : "open";

  return {
    incidentId,
    id: incident.id ? String(incident.id) : undefined,
    guestId: String(incident.guestId ?? ""),
    type: String(incident.type ?? "unknown"),
    category: String(incident.category ?? "Unknown"),
    description: String(incident.description ?? ""),
    severity,
    status,
    createdAt: String(incident.createdAt ?? nowIso),
    updatedAt: String(incident.updatedAt ?? nowIso),
  };
}

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || "";
}

async function fetchJson<T>(path: string, params?: Record<string, string | undefined>) {
  const base = getApiBaseUrl();
  const url = new URL(path, base ? `${base.replace(/\/$/, "")}/` : window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
  }

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown) {
  const base = getApiBaseUrl();
  const url = new URL(path, base ? `${base.replace(/\/$/, "")}/` : window.location.origin);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

export const api = {
  kpis: () => fetchJson<OperationalKPI[]>("/api/dashboard/kpis"),
  incidents: async (filters?: { severity?: string; status?: string; guestId?: string }) => {
    const rows = await fetchJson<Record<string, unknown>[]>("/api/incidents", filters);
    return rows.map(normalizeIncident);
  },
  prioritizedIncidents: async () => {
    const rows = await fetchJson<Record<string, unknown>[]>('/api/incidents/prioritized');
    return rows.map((row) => ({
      incident: normalizeIncident((row.incident as Record<string, unknown>) ?? {}),
      guest: normalizeGuest((row.guest as Record<string, unknown>) ?? {}),
      potential: Number(row.potential ?? 0),
    })) as PrioritizedIncident[];
  },
  excursions: () => fetchJson<Excursion[]>("/api/excursions"),
  venues: () => fetchJson<Venue[]>("/api/venues"),
  recommendations: (agentType?: string) =>
    fetchJson<AgentRecommendation[]>("/api/recommendations", { agentType }),
  timeline: (agentType: "guest-recovery" | "port-disruption" | "onboard-ops") =>
    fetchJson<TimelineEvent[]>(`/api/timeline/${agentType}`),
  shipInfo: () => fetchJson<ShipInfo>("/api/ship-info"),
  guests: async () => {
    const rows = await fetchJson<Record<string, unknown>[]>("/api/guests");
    return rows.map(normalizeGuest);
  },
  guestWithIncidents: (id: string) => fetchJson<GuestWithIncidents>(`/api/guests/${id}`),
  agentQuery: (
    query: string,
    agentType: "guest-recovery" | "port-disruption" | "onboard-ops" | "general",
    sessionId?: string,
  ) => postJson<AgentQueryResponse>("/api/agent-query", { query, agentType, sessionId }),
  actionProposals: (guestId?: string, incidentId?: string) =>
    fetchJson<ActionProposal[]>("/api/action-proposals", { guestId, incidentId }),
};

export function useLiveDashboardData() {
  const kpisQuery = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  const shipInfoQuery = useQuery({ queryKey: ["shipInfo"], queryFn: api.shipInfo });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: () => api.incidents() });
  const excursionsQuery = useQuery({ queryKey: ["excursions"], queryFn: api.excursions });
  const venuesQuery = useQuery({ queryKey: ["venues"], queryFn: api.venues });
  const recommendationsQuery = useQuery({ queryKey: ["recommendations"], queryFn: () => api.recommendations() });

  return {
    kpisQuery,
    shipInfoQuery,
    incidentsQuery,
    excursionsQuery,
    venuesQuery,
    recommendationsQuery,
  };
}