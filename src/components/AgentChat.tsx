import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, Loader2, RotateCcw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { guests as mockGuests, incidents as mockIncidents, excursions as mockExcursions, venues as mockVenues, agentRecommendations as mockRecommendations, shipInfo as mockShipInfo } from "@/data/mockData";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface AgentChatProps {
  agentType?: "guest-recovery" | "port-disruption" | "onboard-ops" | "general";
  className?: string;
  onCommand?: (command: string) => void;
}

interface VectorQueryMeta {
  retrievalMode?: string;
  indexesUsed?: string[];
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ COUCHBASE INTEGRATION: NLP Chat — Mock Response Engine                     │
// │                                                                             │
// │ Replace MOCK_RESPONSES with live Couchbase-powered query pipeline:         │
// │                                                                             │
// │ OPTION A — Couchbase Capella + Capella AI Services:                        │
// │   1. User query → Capella AI Services (RAG pipeline)                       │
// │      Docs: https://docs.couchbase.com/ai/get-started/intro.html           │
// │   2. AI Services performs vector search on embeddings stored in Capella    │
// │      Docs: https://docs.couchbase.com/cloud/vector-search/vector-search.html │
// │   3. Retrieved context (guest profiles, incidents, venues) assembled       │
// │   4. LLM generates natural language response with cited data               │
// │   5. Response streamed back to the UI                                      │
// │                                                                             │
// │   Example flow:                                                             │
// │   const searchResult = await scope.search("voyageops-vectors", {           │
// │     vector: await embed(userQuery),                                         │
// │     fields: ["*"], limit: 5                                                │
// │   });                                                                       │
// │   const context = searchResult.rows.map(r => r.fields);                    │
// │   const answer = await llm.chat({ context, query: userQuery });            │
// │                                                                             │
// │ OPTION B — Couchbase Server + Full-Text Search (FTS):                      │
// │   1. User query → Couchbase FTS Service for keyword/semantic search        │
// │      Docs: https://docs.couchbase.com/server/current/fts/fts-introduction.html │
// │   2. FTS supports vector search indexes for embedding-based retrieval      │
// │   3. SQL++ (N1QL) queries for structured data retrieval                    │
// │   4. External LLM API call with assembled context                          │
// │   5. Store conversation history in voyageops.operations.chat_history       │
// │                                                                             │
// │   Example FTS query:                                                        │
// │   const ftsResult = await cluster.searchQuery("voyageops-fts",             │
// │     SearchQuery.match(userQuery), { limit: 10, fields: ["*"] }             │
// │   );                                                                        │
// │                                                                             │
// │ Both Options: Implement an Edge Function / API endpoint that:              │
// │   - Accepts user query + agent context                                      │
// │   - Queries relevant Couchbase collections                                 │
// │   - Calls LLM with retrieved context                                       │
// │   - Returns structured response for UI rendering                           │
// └─────────────────────────────────────────────────────────────────────────────┘
const FALLBACK_RESPONSE = "I'm analyzing the available data but couldn't find a specific match for your query. Try asking about:\n\n- **Guest incidents** and recovery plans\n- **Port disruptions** and excursion status\n- **Venue capacity** and staffing\n- **Ship status** and recommendations\n\nFor example: *\"What's the status of the Santorini excursion?\"* or *\"Show me active incidents\"*";

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ COUCHBASE INTEGRATION: Query Routing Function                              │
// │                                                                             │
// │ Replace getMockResponse() with a call to your backend API that:            │
// │                                                                             │
// │ OPTION A — Couchbase Capella:                                              │
// │   async function getAgentResponse(query: string, agentType: string) {      │
// │     const res = await fetch("/api/agent-query", {                           │
// │       method: "POST",                                                       │
// │       body: JSON.stringify({ query, agentType }),                           │
// │     });                                                                     │
// │     return res.json(); // { response: string, sources: string[] }          │
// │   }                                                                         │
// │   Backend uses Capella AI Services for RAG + Capella SQL++ for data        │
// │                                                                             │
// │ OPTION B — Couchbase Server:                                               │
// │   Same API shape; backend uses Server FTS + N1QL + external LLM           │
// │   Backend can run as Couchbase Eventing Function or external service       │
// └─────────────────────────────────────────────────────────────────────────────┘
interface LiveChatData {
  guests: typeof mockGuests;
  incidents: typeof mockIncidents;
  excursions: typeof mockExcursions;
  venues: typeof mockVenues;
  recommendations: typeof mockRecommendations;
  shipInfo: typeof mockShipInfo;
}

function getGuestDisplayName(guest: LiveChatData["guests"][number] | undefined) {
  return guest?.fullName || guest?.name || "Unknown";
}

function getIncidentIdentifier(incident: LiveChatData["incidents"][number]) {
  return incident.incidentId || incident.id || "Unknown";
}

function findGuestById(data: LiveChatData, guestId: string | undefined) {
  if (!guestId) return undefined;
  return data.guests.find(g => g.guestId === guestId || g.id === guestId);
}

function findVenueForIncident(data: LiveChatData, incident: LiveChatData["incidents"][number] | undefined) {
  if (!incident?.description) return undefined;
  const description = incident.description.toLowerCase();
  return data.venues.find(venue => description.includes(String(venue.name).toLowerCase()));
}

function formatCurrency(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unknown";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function getLoyaltyValueMultiplier(loyaltyTier: string | undefined) {
  switch (String(loyaltyTier).toUpperCase()) {
    case "DIAMOND":
      return 11;
    case "EMERALD":
      return 9;
    case "PLATINUM":
      return 8;
    case "GOLD":
      return 5;
    case "SILVER":
      return 3;
    default:
      return 2;
  }
}

function getSeverityRisk(incident: LiveChatData["incidents"][number] | undefined) {
  switch (String(incident?.severity).toLowerCase()) {
    case "critical":
      return 18;
    case "high":
      return 12;
    case "medium":
      return 7;
    default:
      return 3;
  }
}

function buildRecoveryPlanResponse(
  data: LiveChatData,
  recommendation: LiveChatData["recommendations"][number] | undefined,
  incident: LiveChatData["incidents"][number] | undefined,
  guest: LiveChatData["guests"][number] | undefined,
) {
  if (!recommendation) {
    return FALLBACK_RESPONSE;
  }

  const guestName = getGuestDisplayName(guest);
  const incidentLabel = incident ? `${incident.type}: ${incident.category}` : "No active incident found";
  const incidentDescription = incident?.description || "No incident description available.";
  const bookingId = guest?.bookingId || "Unknown";
  const loyaltyTier = guest?.loyaltyTier || "Unknown";
  const onboardSpend = formatCurrency(guest?.onboardSpend);
  const sailingHistory = typeof guest?.sailingHistory === "number" ? `${guest.sailingHistory} voyages` : "Unknown";
  const venue = findVenueForIncident(data, incident);
  const occupancyPct = venue && typeof venue.currentOccupancy === "number" && typeof venue.capacity === "number" && venue.capacity > 0
    ? Math.round((venue.currentOccupancy / venue.capacity) * 100)
    : undefined;
  const staffingGapPct = venue && typeof venue.staffCount === "number" && typeof venue.optimalStaff === "number" && venue.optimalStaff > 0
    ? Math.max(0, Math.round(((venue.optimalStaff - venue.staffCount) / venue.optimalStaff) * 100))
    : undefined;
  const analysisSegments = [
    `booking profile (${bookingId})`,
    `loyalty tier (${loyaltyTier})`,
    `sailing history (${sailingHistory})`,
    `onboard spend (${onboardSpend})`,
  ];

  if (incident) {
    analysisSegments.push(`incident severity (${String(incident.severity).toUpperCase()})`);
    analysisSegments.push(`incident status (${incident.status})`);
  }

  if (venue) {
    const venueMetrics = [
      `${venue.name} status (${venue.status})`,
      occupancyPct !== undefined ? `occupancy (${occupancyPct}% of capacity)` : undefined,
      typeof venue.waitTime === "number" ? `wait time (${venue.waitTime} minutes)` : undefined,
      staffingGapPct !== undefined && staffingGapPct > 0 ? `staffing gap (${staffingGapPct}%)` : undefined,
    ].filter(Boolean).join(", ");
    analysisSegments.push(`venue context (${venueMetrics})`);
  }

  const analysisDetails = `Agent correlated ${analysisSegments.join(", ")}.`;
  const actionList = recommendation.actions
    .map((action, index) => `${index + 1}. **${action.label}**${action.estimatedValue ? ` (${action.estimatedValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})` : ""}  \n   ${action.description}`)
    .join("\n");
  const actionValue = recommendation.actions.reduce((total, action) => total + (action.estimatedValue ?? 0), 0);
  const spendValue = typeof guest?.onboardSpend === "number" ? guest.onboardSpend : 0;
  const protectedValue = Math.round((spendValue + actionValue) * getLoyaltyValueMultiplier(guest?.loyaltyTier));
  const venueRisk = venue?.status === "overloaded" ? 8 : venue?.status === "busy" ? 4 : 0;
  const beforeRisk = Math.min(48, getSeverityRisk(incident) + venueRisk + (String(guest?.loyaltyTier).toUpperCase() === "PLATINUM" ? 10 : 0) + (String(guest?.loyaltyTier).toUpperCase() === "DIAMOND" ? 12 : 0));
  const afterRisk = Math.max(4, beforeRisk - Math.round(recommendation.confidence / 3) - Math.min(8, recommendation.actions.length * 2));
  const outcomeDetails = `Estimated ${formatCurrency(protectedValue)} in future value protected. Churn risk reduced from ${beforeRisk}% to ${afterRisk}% based on guest value, incident severity, and the ${recommendation.actions.length}-step recovery plan.`;

  return `### ${recommendation.title}\n\n**Guest:** ${guestName}  \n**Incident:** ${incidentLabel}  \n**Status:** \`${recommendation.status}\`  \n**Confidence:** ${recommendation.confidence}%\n\n**Trigger**\n${incidentDescription}\n\n**Analysis**\n${analysisDetails}\n\n**Recovery Plan**\n${actionList}\n\n**Outcome**\n${outcomeDetails}`;
}

function getAgentResponse(input: string, agentType: string, data: LiveChatData): string {
  const text = input.toLowerCase();
  const pending = data.recommendations.filter(r => r.status === "pending" || r.status === "reviewing");

  if (agentType === "guest-recovery") {
    if (/analyze\s+jane\s+doe('?s)?\s+incident/.test(text) || (text.includes("jane doe") && text.includes("incident"))) {
      const recommendation = data.recommendations.find(r => /jane doe/i.test(r.title) || /jane doe/i.test(r.summary));
      const guest = findGuestById(data, recommendation?.relatedEntityId);
      const incident = data.incidents.find(i => i.guestId === recommendation?.relatedEntityId && i.status !== "closed")
        || data.incidents.find(i => i.guestId === recommendation?.relatedEntityId);
      return buildRecoveryPlanResponse(data, recommendation, incident, guest);
    }

    if (/show\s+stark\s+family\s+recovery\s+plan/.test(text) || (text.includes("stark") && text.includes("recovery") && text.includes("plan"))) {
      const recommendation = data.recommendations.find(r => /stark/i.test(r.title) || /stark/i.test(r.summary));
      const guest = findGuestById(data, recommendation?.relatedEntityId);
      const incident = data.incidents.find(i => i.guestId === recommendation?.relatedEntityId && i.status !== "closed")
        || data.incidents.find(i => i.guestId === recommendation?.relatedEntityId);
      return buildRecoveryPlanResponse(data, recommendation, incident, guest);
    }
  }

  if (/ship|vessel|status/.test(text)) {
    return `### Ship Status\n\n| Detail | Value |\n|---|---|\n| Name | ${data.shipInfo.name} |\n| Voyage | ${data.shipInfo.currentVoyage} |\n| Location | ${data.shipInfo.currentLocation} |\n| Day | ${data.shipInfo.voyageDay}/${data.shipInfo.totalDays} |\n| Passengers | ${data.shipInfo.passengers.toLocaleString()} |\n| Crew | ${data.shipInfo.crew.toLocaleString()} |\n| Next Port | ${data.shipInfo.nextPort} (ETA: ${data.shipInfo.nextPortETA}) |\n| Weather | ${data.shipInfo.weatherCondition} |\n| Sea State | ${data.shipInfo.seaState} |`;
  }

  if (/recommend|suggestion|action/.test(text)) {
    return `### Active Recommendations\n\nPending or reviewing: **${pending.length}**\n\n${pending.map(r => `- **${r.title}** (${r.agentType}) | Confidence ${r.confidence}% | Status \`${r.status}\``).join("\n")}`;
  }

  if (agentType === "guest-recovery" && /incident|open|active|guest|recovery/.test(text)) {
    const activeIncidents = data.incidents.filter(i => i.status !== "closed");
    return `### Active Guest Incidents\n\n${activeIncidents.map(i => {
      const guest = findGuestById(data, i.guestId);
      return `- **${getIncidentIdentifier(i)}** | ${String(i.severity).toUpperCase()} | ${getGuestDisplayName(guest)}\n  ${i.type}: ${i.category}\n  Status: \`${i.status}\``;
    }).join("\n\n")}`;
  }

  if (agentType === "port-disruption" && /excursion|port|weather|disrupt|cancel/.test(text)) {
    return `### Excursion Status\n\n| Excursion | Port | Status | Booked |\n|---|---|---|---|\n${data.excursions.map(e => `| ${e.name} | ${e.port} | \`${e.status}\` | ${e.booked}/${e.capacity} |`).join("\n")}`;
  }

  if (agentType === "onboard-ops" && /venue|capacity|staff|dining|pool|ops/.test(text)) {
    const overloaded = data.venues.filter(v => v.status === "overloaded");
    const busy = data.venues.filter(v => v.status === "busy");
    return `### Venue Operations\n\n| Venue | Occupancy | Wait | Staff | Status |\n|---|---|---|---|---|\n${data.venues.map(v => `| ${v.name} | ${v.currentOccupancy}/${v.capacity} | ${v.waitTime}m | ${v.staffCount}/${v.optimalStaff} | \`${v.status}\` |`).join("\n")}\n\nOverloaded: **${overloaded.length}**\nBusy: **${busy.length}**`;
  }

  return FALLBACK_RESPONSE;
}

const SUGGESTED_QUERIES: Record<string, string[]> = {
  "general": ["Show ship status", "List active recommendations", "What incidents are open?"],
  "guest-recovery": ["Analyze Jane Doe's incident", "Show Stark family recovery plan", "List all active incidents"],
  "port-disruption": ["Santorini weather disruption status", "What happened with Crete excursion?", "Show all excursion status"],
  "onboard-ops": ["Dining capacity status", "Pool deck and spa status", "Show all venue overview"],
};

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
      aria-label="Copy response"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function AgentChat({ agentType = "general", className, onCommand }: AgentChatProps) {
  const guestsQuery = useQuery({ queryKey: ["guests"], queryFn: api.guests });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: api.incidents });
  const excursionsQuery = useQuery({ queryKey: ["excursions"], queryFn: api.excursions });
  const venuesQuery = useQuery({ queryKey: ["venues"], queryFn: api.venues });
  const recommendationsQuery = useQuery({ queryKey: ["recommendations"], queryFn: () => api.recommendations() });
  const shipInfoQuery = useQuery({ queryKey: ["shipInfo"], queryFn: api.shipInfo });

  const liveData: LiveChatData = {
    guests: guestsQuery.data ?? mockGuests,
    incidents: incidentsQuery.data ?? mockIncidents,
    excursions: excursionsQuery.data ?? mockExcursions,
    venues: venuesQuery.data ?? mockVenues,
    recommendations: recommendationsQuery.data ?? mockRecommendations,
    shipInfo: shipInfoQuery.data ?? mockShipInfo,
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [vectorMeta, setVectorMeta] = useState<VectorQueryMeta | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSendRef = useRef<(text?: string) => void>(() => {});

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const simulateStreaming = useCallback((fullText: string, msgId: string) => {
    setIsStreaming(true);
    let charIndex = 0;
    const chunkSize = 3;

    const interval = setInterval(() => {
      charIndex += chunkSize;
      if (charIndex >= fullText.length) {
        clearInterval(interval);
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, content: fullText, isStreaming: false } : m)
        );
        setIsStreaming(false);
        return;
      }
      setMessages(prev =>
        prev.map(m => m.id === msgId ? { ...m, content: fullText.slice(0, charIndex) } : m)
      );
    }, 12);
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isStreaming) return;

    onCommand?.(messageText);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");

    let response = "";
    if (agentType === "guest-recovery") {
      try {
        const vectorResult = await api.agentQuery(messageText, agentType);
        response = vectorResult.response;
        setVectorMeta(vectorResult.metadata ?? null);
      } catch {
        response = getAgentResponse(messageText, agentType, liveData);
        setVectorMeta({ retrievalMode: "local-fallback", indexesUsed: [] });
      }
    } else {
      response = getAgentResponse(messageText, agentType, liveData);
    }

    setTimeout(() => simulateStreaming(response, assistantId), 400);
  }, [input, isStreaming, agentType, simulateStreaming, liveData, onCommand]);

  // Keep ref in sync and listen for guided demo events
  handleSendRef.current = handleSend;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentType === agentType && detail?.query) {
        setTimeout(() => handleSendRef.current(detail.query), 300);
      }
    };
    window.addEventListener("guided-demo-query", handler);
    return () => window.removeEventListener("guided-demo-query", handler);
  }, [agentType]);

  const agentLabels: Record<string, string> = {
    "general": "VoyageOps AI",
    "guest-recovery": "Guest Recovery Agent",
    "port-disruption": "Port Disruption Agent",
    "onboard-ops": "Onboard Ops Agent",
  };

  const suggestions = SUGGESTED_QUERIES[agentType] || SUGGESTED_QUERIES["general"];

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{agentLabels[agentType]}</p>
          <p className="text-[10px] text-muted-foreground">
            Powered by Couchbase Capella AI Services • Natural Language Interface
          </p>
          {agentType === "guest-recovery" && vectorMeta?.retrievalMode ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                Vector Mode: {vectorMeta.retrievalMode}
              </span>
              {vectorMeta.indexesUsed && vectorMeta.indexesUsed.length > 0 ? (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground">
                  {vectorMeta.indexesUsed.length} index{vectorMeta.indexesUsed.length > 1 ? "es" : ""} active
                </span>
              ) : (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
                  fallback active
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-[10px] text-success font-medium">Online</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin min-h-[300px] max-h-[500px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Ask me anything about operations</p>
            <p className="text-xs text-muted-foreground mb-4 max-w-xs">
              I can analyze guest incidents, port disruptions, venue capacity, and provide AI-powered recommendations.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex gap-3 group", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div className="flex flex-col gap-1 max-w-[85%]">
              <div className={cn(
                "rounded-xl px-4 py-3 text-sm relative",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted/50 text-foreground rounded-bl-sm"
              )}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-td:text-foreground prose-th:text-foreground prose-li:text-foreground [&_table]:text-xs [&_table]:w-full [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:text-left [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/50">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                    {msg.isStreaming && (
                      <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
              <div className={cn(
                "flex items-center gap-2",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}>
                <span className="text-[10px] text-muted-foreground">
                  {format(msg.timestamp, "h:mm a")}
                </span>
                {msg.role === "assistant" && !msg.isStreaming && msg.content && (
                  <CopyButton content={msg.content} />
                )}
              </div>
            </div>
            {msg.role === "user" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary mt-0.5">
                <User className="h-3.5 w-3.5 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.content === "" && (
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="bg-muted/50 rounded-xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-10 w-10"
              onClick={() => setMessages([])}
              disabled={isStreaming}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask the agent..."
            disabled={isStreaming}
            className="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            className="shrink-0 h-10 w-10"
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
