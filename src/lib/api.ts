import { useQuery } from "@tanstack/react-query";
import type {
  AgentRecommendation,
  Excursion,
  Guest,
  Incident,
  OperationalKPI,
  TimelineEvent,
  Venue,
} from "@/data/mockData";

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
  guest: Guest;
  incidents: Incident[];
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

export const api = {
  kpis: () => fetchJson<OperationalKPI[]>("/api/dashboard/kpis"),
  incidents: (filters?: { severity?: string; status?: string; guestId?: string }) => fetchJson<Incident[]>("/api/incidents", filters),
  excursions: () => fetchJson<Excursion[]>("/api/excursions"),
  venues: () => fetchJson<Venue[]>("/api/venues"),
  recommendations: (agentType?: string) =>
    fetchJson<AgentRecommendation[]>("/api/recommendations", { agentType }),
  timeline: (agentType: "guest-recovery" | "port-disruption" | "onboard-ops") =>
    fetchJson<TimelineEvent[]>(`/api/timeline/${agentType}`),
  shipInfo: () => fetchJson<ShipInfo>("/api/ship-info"),
  guests: () => fetchJson<Guest[]>("/api/guests"),
  guestWithIncidents: (id: string) => fetchJson<GuestWithIncidents>(`/api/guests/${id}`),
};

export function useLiveDashboardData() {
  const kpisQuery = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  const shipInfoQuery = useQuery({ queryKey: ["shipInfo"], queryFn: api.shipInfo });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: api.incidents });
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