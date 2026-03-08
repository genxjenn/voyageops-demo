import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, Loader2, RotateCcw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { guests, incidents, excursions, venues, agentRecommendations, shipInfo } from "@/data/mockData";
import { format } from "date-fns";
import { toast } from "sonner";

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
}

const MOCK_RESPONSES: Record<string, { patterns: RegExp[]; response: string }[]> = {
  "general": [
    {
      patterns: [/ship|vessel|status/i],
      response: `### 🚢 ${shipInfo.name} — Current Status\n\n| Detail | Value |\n|---|---|\n| **Voyage** | ${shipInfo.currentVoyage} |\n| **Location** | ${shipInfo.currentLocation} |\n| **Day** | ${shipInfo.voyageDay} of ${shipInfo.totalDays} |\n| **Passengers** | ${shipInfo.passengers.toLocaleString()} |\n| **Crew** | ${shipInfo.crew.toLocaleString()} |\n| **Next Port** | ${shipInfo.nextPort} (ETA: ${shipInfo.nextPortETA}) |\n| **Weather** | ${shipInfo.weatherCondition} |\n| **Sea State** | ${shipInfo.seaState} |\n\nAll three AI agents are **active** and monitoring operations in real-time.`,
    },
    {
      patterns: [/recommend|suggestion|action/i],
      response: `### 📋 Active Recommendations\n\nI found **${agentRecommendations.filter(r => r.status === "pending" || r.status === "reviewing").length}** pending recommendations across all agents:\n\n${agentRecommendations.filter(r => r.status === "pending" || r.status === "reviewing").map(r => `- **${r.title}** — Confidence: ${r.confidence}% | Impact: ${r.impact} | Status: \`${r.status}\``).join("\n")}\n\nWould you like me to drill into any specific recommendation?`,
    },
  ],
  "guest-recovery": [
    {
      patterns: [/margaret|chen|platinum.*guest|dining/i],
      response: `### 🎯 Guest Recovery — Margaret Chen (Platinum)\n\n**Incident:** INC-3021 — Dining service failure at Le Bordeaux\n\n**Guest Profile:**\n- Loyalty: **Platinum** (12 voyages)\n- Onboard Spend: **$4,820** (top 5% this voyage)\n- Lifetime Value: **$58,000+**\n- First complaint in 12 sailings\n\n**Root Cause Analysis:**\nLe Bordeaux was operating at **96% capacity** with **25% understaffing**. Average wait time: 35 min (normal: 8 min).\n\n**Recommended Recovery (94% confidence):**\n1. ✅ Issue **$200** onboard credit\n2. ✅ Personal apology from Hotel Director (within 2 hrs)\n3. ✅ Complimentary **Chef's Table** dinner ($450 value)\n4. ✅ Priority reservation guarantee for remaining voyage\n\n⚠️ Risk: Platinum guest churn after unresolved failures is **34%**. Recommend immediate action.`,
    },
    {
      patterns: [/rossi|suite|ac|cabin|critical/i],
      response: `### 🔴 Critical — Suite Recovery: Rossi Family\n\n**Incident:** INC-3022 — AC malfunction in Suite A-102\n\n**Guest Profile:**\n- **Sophia & Marco Rossi** — Platinum (18 voyages)\n- Current spend: **$6,340** | Booking value: **$12,400**\n- Top 1% guest value\n\n**Situation:**\n- Temperature reached **82°F** in suite\n- Exterior temp: 88°F\n- Maintenance ETA: **18 hours** (part required)\n\n**Recommended Recovery (97% confidence):**\n1. 🏠 Upgrade to **Owner's Suite A-001** (currently vacant) — $2,800 value\n2. 💰 **$500 credit** + complimentary couples spa day — $750 value\n3. 🎫 Future voyage **20% discount** — $2,400 value\n\nSuite-level failures have **42% rebooking risk**. Immediate escalation recommended.`,
    },
    {
      patterns: [/incident|open|active/i],
      response: `### 📊 Active Incidents Summary\n\n${incidents.filter(i => i.status !== "closed").map(i => {
        const guest = guests.find(g => g.id === i.guestId);
        return `- **${i.id}** | ${i.severity.toUpperCase()} | ${guest?.name || "Unknown"} (${guest?.loyaltyTier})\n  ${i.description.slice(0, 80)}…\n  Status: \`${i.status}\``;
      }).join("\n\n")}\n\nI can provide detailed recovery plans for any of these. Which incident should I analyze?`,
    },
  ],
  "port-disruption": [
    {
      patterns: [/santorini|weather|wind|disrupt/i],
      response: `### ⛈️ Santorini Port Disruption Alert\n\n**Forecast:** NOAA maritime advisory — winds **35-40 knots** expected March 16, 06:00-18:00\n\n**Impact Assessment:**\n- Tendering operations: **HIGH RISK**\n- Historical cancellation rate under similar conditions: **78%**\n- Guests affected: **142** (14 Platinum/Gold tier)\n- Revenue at risk: **$18,500**\n\n**Mitigation Plan (87% confidence):**\n1. 📱 Pre-notify **142 affected guests** via in-app + cabin notification\n2. 🔄 Activate **Mykonos rebooking** at no additional cost\n3. 🎭 Deploy **onboard alternatives** (cooking class, wine tasting, movie marathon)\n4. 💰 Process **automatic refunds** ($7,182)\n\nShall I execute any of these actions?`,
    },
    {
      patterns: [/crete|vendor|wine|cancel/i],
      response: `### 🍷 Vendor Cancellation — Crete Wine Experience\n\n**Vendor:** Cretan Flavors Co. cancelled due to staffing issues\n**Bookings affected:** 25 guests (8 premium packages)\n**Revenue impact:** $3,625 + $1,200 premium add-ons\n\n**Resolution (91% confidence):**\n1. ✅ Rebooked with **Cretan Heritage Wines** (92% satisfaction rating)\n   - Same itinerary, higher-rated guide\n2. ⭐ 8 premium guests upgraded to **private wine cave experience** at no extra cost\n\nStatus: **Approved** — awaiting execution.`,
    },
    {
      patterns: [/excursion|port|schedule/i],
      response: `### 🗺️ Excursion Status Overview\n\n| Excursion | Port | Status | Booked |\n|---|---|---|---|\n${excursions.map(e => `| ${e.name} | ${e.port} | \`${e.status}\` | ${e.booked}/${e.capacity} |`).join("\n")}\n\n**⚠️ Alerts:**\n- Santorini Sunset Catamaran: **DISRUPTED** (weather)\n- Crete Wine Experience: **CANCELLED** (vendor)\n\nI can provide detailed mitigation plans for any disrupted excursion.`,
    },
  ],
  "onboard-ops": [
    {
      patterns: [/dining|restaurant|bordeaux|capacity|staff/i],
      response: `### 🍽️ Dining Operations — Critical Alert\n\n**Le Bordeaux:** 🔴 OVERLOADED\n- Occupancy: **115/120** (96%)\n- Wait time: **35 min** (normal: 8 min)\n- Staffing: **12/16** (25% understaffed)\n\n**Lido Buffet:** 🟡 BUSY\n- Occupancy: **310/350** (89%)\n- Wait time: **20 min** (normal: 5 min)\n\n**Compass Bar:** 🟢 UNDERUTILIZED\n- Occupancy: **34/80** (43%)\n- Excess staff available: **2**\n\n**Rebalancing Plan (92% confidence):**\n1. 👥 Redeploy **4 staff** from Compass Bar → Le Bordeaux\n2. 🪑 Open **Atlas Lounge** as overflow dining\n3. 📱 Push **Compass Bar Happy Hour** notification (redirect 15-20% traffic)\n4. ⏰ Extend **Ocean Grill** hours to 22:00\n\nPrediction: Without action, Le Bordeaux exceeds capacity in **25 minutes**.`,
    },
    {
      patterns: [/pool|deck|spa|recreation/i],
      response: `### 🏊 Recreation & Wellness Status\n\n**Sky Pool:** 🔴 OVERLOADED (148/150 — 99%)\n- Filtration system flagged: pressure **+15%** above normal\n- Last serviced: 12 days ago (interval: 10 days)\n\n**Serenity Spa:** 🟡 BUSY\n- Wait time: **45 min**\n- Occupancy: 38/40\n\n**Action Plan (88% confidence):**\n1. 🔧 Schedule pool maintenance for **23:00** (overnight)\n2. 🏊 Open **Deck 14 overflow pool** (deploy 4 attendants)\n3. 💆 Promote **20% off afternoon spa** treatments\n\nThis should reduce Sky Pool density by ~30% within the hour.`,
    },
    {
      patterns: [/venue|overview|all|status/i],
      response: `### 📊 All Venue Status — Real-Time\n\n| Venue | Type | Deck | Occupancy | Wait | Staff | Status |\n|---|---|---|---|---|---|---|\n${venues.map(v => `| ${v.name} | ${v.type} | ${v.deck} | ${v.currentOccupancy}/${v.capacity} | ${v.waitTime}m | ${v.staffCount}/${v.optimalStaff} | \`${v.status}\` |`).join("\n")}\n\n**Summary:**\n- 🔴 **${venues.filter(v => v.status === "overloaded").length}** overloaded\n- 🟡 **${venues.filter(v => v.status === "busy").length}** busy\n- 🟢 **${venues.filter(v => v.status === "normal").length}** normal\n- 🔧 **${venues.filter(v => v.status === "maintenance").length}** maintenance\n\nRecommended: Immediate staff rebalancing from underutilized to overloaded venues.`,
    },
  ],
};

const FALLBACK_RESPONSE = "I'm analyzing the available data but couldn't find a specific match for your query. Try asking about:\n\n- **Guest incidents** and recovery plans\n- **Port disruptions** and excursion status\n- **Venue capacity** and staffing\n- **Ship status** and recommendations\n\nFor example: *\"What's the status of the Santorini excursion?\"* or *\"Show me active incidents\"*";

function getMockResponse(input: string, agentType: string): string {
  const agentResponses = MOCK_RESPONSES[agentType] || [];
  const generalResponses = MOCK_RESPONSES["general"] || [];
  const allResponses = [...agentResponses, ...generalResponses];

  for (const entry of allResponses) {
    if (entry.patterns.some(p => p.test(input))) {
      return entry.response;
    }
  }
  return FALLBACK_RESPONSE;
}

const SUGGESTED_QUERIES: Record<string, string[]> = {
  "general": ["Show ship status", "List active recommendations", "What incidents are open?"],
  "guest-recovery": ["Analyze Margaret Chen's incident", "Show Rossi family recovery plan", "List all active incidents"],
  "port-disruption": ["Santorini weather disruption status", "What happened with Crete excursion?", "Show all excursion status"],
  "onboard-ops": ["Dining capacity status", "Pool deck and spa status", "Show all venue overview"],
};

export function AgentChat({ agentType = "general", className }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
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

  const handleSend = useCallback((text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isStreaming) return;

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

    const response = getMockResponse(messageText, agentType);
    setTimeout(() => simulateStreaming(response, assistantId), 400);
  }, [input, isStreaming, agentType, simulateStreaming]);

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
          <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div className={cn(
              "max-w-[85%] rounded-xl px-4 py-3 text-sm",
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
            <div className="bg-muted/50 rounded-xl rounded-bl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
