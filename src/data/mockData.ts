// VoyageOps AI - Mock Data Layer
// Designed to map to Couchbase document model

export interface Guest {
  id: string;
  name: string;
  email: string;
  loyaltyTier: "Platinum" | "Gold" | "Silver" | "Bronze";
  loyaltyNumber: string;
  cabinNumber: string;
  bookingId: string;
  onboardSpend: number;
  sailingHistory: number;
  avatar?: string;
}

export interface Booking {
  id: string;
  guestId: string;
  shipName: string;
  voyageNumber: string;
  departureDate: string;
  returnDate: string;
  cabinType: string;
  cabinNumber: string;
  totalValue: number;
  status: "active" | "completed" | "cancelled";
}

export interface Incident {
  id: string;
  guestId: string;
  type: string;
  category: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "reviewing" | "approved" | "executed" | "closed";
  createdAt: string;
  updatedAt: string;
}

export interface Excursion {
  id: string;
  name: string;
  port: string;
  date: string;
  time: string;
  capacity: number;
  booked: number;
  pricePerPerson: number;
  status: "scheduled" | "disrupted" | "cancelled" | "rebooked";
  vendor: string;
}

export interface Venue {
  id: string;
  name: string;
  type: string;
  deck: number;
  capacity: number;
  currentOccupancy: number;
  waitTime: number;
  staffCount: number;
  optimalStaff: number;
  status: "normal" | "busy" | "overloaded" | "maintenance";
}

export interface AgentRecommendation {
  id: string;
  agentType: "guest-recovery" | "port-disruption" | "onboard-ops";
  title: string;
  summary: string;
  reasoning: string;
  dataSourcesUsed: string[];
  confidence: number;
  impact: "high" | "medium" | "low";
  status: "pending" | "approved" | "rejected" | "executed" | "reviewing";
  actions: RecommendedAction[];
  createdAt: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

export interface RecommendedAction {
  id: string;
  label: string;
  type: string;
  estimatedValue?: number;
  description: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "alert" | "analysis" | "recommendation" | "action" | "resolution" | "info";
  title: string;
  description: string;
  actor?: string;
}

export interface OperationalKPI {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: string;
  trend?: "up" | "down" | "neutral";
}

// ─── MOCK GUESTS ───
export const guests: Guest[] = [
  {
    id: "G-10421",
    name: "Jane Doe",
    email: "j.doe@email.com",
    loyaltyTier: "Platinum",
    loyaltyNumber: "PLT-882901",
    cabinNumber: "A-214",
    bookingId: "BK-78432",
    onboardSpend: 4820,
    sailingHistory: 12,
  },
  {
    id: "G-10422",
    name: "Robert & Diana Hartwell",
    email: "r.hartwell@email.com",
    loyaltyTier: "Gold",
    loyaltyNumber: "GLD-551204",
    cabinNumber: "B-108",
    bookingId: "BK-78433",
    onboardSpend: 2150,
    sailingHistory: 5,
  },
  {
    id: "G-10423",
    name: "James Nakamura",
    email: "j.nakamura@email.com",
    loyaltyTier: "Silver",
    loyaltyNumber: "SLV-339812",
    cabinNumber: "C-302",
    bookingId: "BK-78434",
    onboardSpend: 890,
    sailingHistory: 2,
  },
  {
    id: "G-10424",
    name: "Sophia & Marco Stark",
    email: "s.stark@email.com",
    loyaltyTier: "Platinum",
    loyaltyNumber: "PLT-112087",
    cabinNumber: "A-102",
    bookingId: "BK-78435",
    onboardSpend: 6340,
    sailingHistory: 18,
  },
  {
    id: "G-10425",
    name: "David Thompson",
    email: "d.thompson@email.com",
    loyaltyTier: "Bronze",
    loyaltyNumber: "BRZ-990124",
    cabinNumber: "D-415",
    bookingId: "BK-78436",
    onboardSpend: 320,
    sailingHistory: 1,
  },
];

// ─── MOCK INCIDENTS ───
export const incidents: Incident[] = [
  {
    id: "INC-3021",
    guestId: "G-10421",
    type: "Service Failure",
    category: "Dining",
    description: "Platinum guest Jane Doe experienced 45-min wait at Le Bordeaux despite having priority reservation. Meal quality below standard. Guest expressed frustration to maître d'.",
    severity: "high",
    status: "reviewing",
    createdAt: "2024-03-15T18:32:00Z",
    updatedAt: "2024-03-15T19:10:00Z",
  },
  {
    id: "INC-3022",
    guestId: "G-10424",
    type: "Cabin Issue",
    category: "Housekeeping",
    description: "Suite A-102 AC malfunction reported. Temperature reached 82°F. Guest relocated temporarily to lounge. Maintenance dispatched but part requires ordering.",
    severity: "critical",
    status: "open",
    createdAt: "2024-03-15T14:15:00Z",
    updatedAt: "2024-03-15T14:45:00Z",
  },
  {
    id: "INC-3023",
    guestId: "G-10422",
    type: "Activity Cancellation",
    category: "Entertainment",
    description: "Evening show 'Broadway at Sea' cancelled due to performer illness. Gold-tier guests Hartwell had reserved premium seating.",
    severity: "medium",
    status: "approved",
    createdAt: "2024-03-15T12:00:00Z",
    updatedAt: "2024-03-15T13:30:00Z",
  },
  {
    id: "INC-3024",
    guestId: "G-10425",
    type: "Lost Item",
    category: "Guest Services",
    description: "Guest reports camera left at pool deck. Item logged in lost & found system. Guest expressed mild dissatisfaction with response time.",
    severity: "low",
    status: "executed",
    createdAt: "2024-03-14T16:20:00Z",
    updatedAt: "2024-03-15T09:00:00Z",
  },
];

// ─── MOCK EXCURSIONS ───
export const excursions: Excursion[] = [
  {
    id: "EXC-501",
    name: "Santorini Sunset Catamaran",
    port: "Santorini, Greece",
    date: "2024-03-16",
    time: "15:00",
    capacity: 40,
    booked: 38,
    pricePerPerson: 189,
    status: "disrupted",
    vendor: "Aegean Adventures",
  },
  {
    id: "EXC-502",
    name: "Mykonos Beach & Culture Tour",
    port: "Mykonos, Greece",
    date: "2024-03-17",
    time: "09:00",
    capacity: 55,
    booked: 52,
    pricePerPerson: 129,
    status: "scheduled",
    vendor: "Island Heritage Tours",
  },
  {
    id: "EXC-503",
    name: "Rhodes Old Town Walking Tour",
    port: "Rhodes, Greece",
    date: "2024-03-18",
    time: "10:00",
    capacity: 30,
    booked: 28,
    pricePerPerson: 79,
    status: "scheduled",
    vendor: "HistoryWalks GR",
  },
  {
    id: "EXC-504",
    name: "Crete Wine & Olive Experience",
    port: "Heraklion, Crete",
    date: "2024-03-16",
    time: "10:00",
    capacity: 25,
    booked: 25,
    pricePerPerson: 145,
    status: "cancelled",
    vendor: "Cretan Flavors Co.",
  },
];

// ─── MOCK VENUES ───
export const venues: Venue[] = [
  { id: "V-01", name: "Le Bordeaux", type: "Fine Dining", deck: 6, capacity: 120, currentOccupancy: 115, waitTime: 35, staffCount: 12, optimalStaff: 16, status: "overloaded" },
  { id: "V-02", name: "Ocean Grill", type: "Casual Dining", deck: 8, capacity: 200, currentOccupancy: 142, waitTime: 12, staffCount: 18, optimalStaff: 18, status: "normal" },
  { id: "V-03", name: "Lido Buffet", type: "Buffet", deck: 9, capacity: 350, currentOccupancy: 310, waitTime: 20, staffCount: 22, optimalStaff: 28, status: "busy" },
  { id: "V-04", name: "Compass Bar", type: "Bar/Lounge", deck: 5, capacity: 80, currentOccupancy: 34, waitTime: 0, staffCount: 6, optimalStaff: 4, status: "normal" },
  { id: "V-05", name: "Sky Pool", type: "Recreation", deck: 12, capacity: 150, currentOccupancy: 148, waitTime: 25, staffCount: 8, optimalStaff: 10, status: "overloaded" },
  { id: "V-06", name: "Serenity Spa", type: "Wellness", deck: 10, capacity: 40, currentOccupancy: 38, waitTime: 45, staffCount: 10, optimalStaff: 12, status: "busy" },
  { id: "V-07", name: "Grand Theater", type: "Entertainment", deck: 4, capacity: 800, currentOccupancy: 0, waitTime: 0, staffCount: 4, optimalStaff: 4, status: "maintenance" },
  { id: "V-08", name: "Kids Club", type: "Family", deck: 11, capacity: 60, currentOccupancy: 45, waitTime: 5, staffCount: 6, optimalStaff: 8, status: "busy" },
];

// ─── AGENT RECOMMENDATIONS ───
export const agentRecommendations: AgentRecommendation[] = [
  {
    id: "REC-001",
    agentType: "guest-recovery",
    title: "Priority Recovery: Jane Doe (Platinum)",
    summary: "High-value Platinum guest experienced dining service failure at Le Bordeaux. Combined with her 12-voyage loyalty history and $4,820 onboard spend, immediate recovery is recommended.",
    reasoning: "Agent analyzed: booking profile (BK-78432), loyalty tier (Platinum, 12 voyages), onboard spend ($4,820 — top 5% this voyage), incident history (first complaint in 12 sailings), dining reservation data, and real-time venue load. Le Bordeaux was operating at 96% capacity with 25% understaffing. The guest's lifetime value is estimated at $58,000+. Risk of churn for Platinum guests after unresolved service failures is 34%.",
    dataSourcesUsed: ["Guest Profile", "Loyalty Database", "Booking System", "POS/Spend Data", "Incident Log", "Venue Capacity Monitor"],
    confidence: 94,
    impact: "high",
    status: "reviewing",
    actions: [
      { id: "A-001", label: "Issue $200 onboard credit", type: "credit", estimatedValue: 200, description: "Immediate goodwill credit applied to folio" },
      { id: "A-002", label: "Personal apology from Hotel Director", type: "outreach", description: "Schedule in-person visit within 2 hours" },
      { id: "A-003", label: "Complimentary Chef's Table dinner", type: "upgrade", estimatedValue: 450, description: "Reserve Chef's Table for tomorrow evening" },
      { id: "A-004", label: "Priority reservation guarantee", type: "policy", description: "Flag all future reservations for immediate seating" },
    ],
    createdAt: "2024-03-15T19:15:00Z",
    relatedEntityId: "G-10421",
    relatedEntityType: "guest",
  },
  {
    id: "REC-002",
    agentType: "guest-recovery",
    title: "Suite Recovery: Rossi Family (Platinum)",
    summary: "Platinum suite guests experienced critical AC failure. Temporary relocation required. Recommend aggressive recovery given suite-level booking value.",
    reasoning: "Agent analyzed: cabin maintenance logs, guest profile (18 voyages, $6,340 current spend), booking value ($12,400 suite), weather data (exterior temp 88°F), and maintenance ETA (part arrival: 18 hours). The Rossis represent top 1% guest value. Suite-level service failures have 42% rebooking risk.",
    dataSourcesUsed: ["Maintenance System", "Guest Profile", "Cabin Sensors", "Weather API", "Parts Inventory"],
    confidence: 97,
    impact: "high",
    status: "pending",
    actions: [
      { id: "A-005", label: "Upgrade to Owner's Suite", type: "upgrade", estimatedValue: 2800, description: "Move to Owner's Suite A-001 (currently vacant) for remainder of voyage" },
      { id: "A-006", label: "Issue $500 credit + spa package", type: "credit", estimatedValue: 750, description: "Compensatory credit plus complimentary couples spa day" },
      { id: "A-007", label: "Future voyage 20% discount", type: "retention", estimatedValue: 2400, description: "Personalized rebooking offer for Mediterranean 2025" },
    ],
    createdAt: "2024-03-15T15:00:00Z",
    relatedEntityId: "G-10424",
    relatedEntityType: "guest",
  },
  {
    id: "REC-003",
    agentType: "port-disruption",
    title: "Santorini Port Weather Disruption",
    summary: "High winds forecast for Santorini (March 16). Tendering operations at risk. 38 guests booked on Sunset Catamaran excursion. 4 additional shore excursions affected.",
    reasoning: "Agent analyzed: NOAA maritime forecast (wind gusts 35-40 knots), port authority advisories, tender vessel specifications, excursion booking data, guest segment analysis (14 Platinum/Gold guests affected), and historical disruption patterns for Santorini. Similar conditions resulted in port cancellation 78% of the time in the past 3 years.",
    dataSourcesUsed: ["Weather Service API", "Port Authority Feed", "Excursion Bookings", "Guest Segments", "Historical Disruption Data", "Revenue System"],
    confidence: 87,
    impact: "high",
    status: "pending",
    actions: [
      { id: "A-008", label: "Pre-notify affected guests", type: "communication", description: "Send proactive in-app + cabin notification to 142 affected guests" },
      { id: "A-009", label: "Activate rebooking for Mykonos alternatives", type: "rebooking", estimatedValue: 18500, description: "Offer Mykonos excursion upgrades at no additional cost" },
      { id: "A-010", label: "Deploy onboard alternative programming", type: "operations", description: "Activate sea day entertainment package: cooking class, wine tasting, movie marathon" },
      { id: "A-011", label: "Process automatic refunds", type: "refund", estimatedValue: 7182, description: "Auto-refund for cancelled Santorini excursions" },
    ],
    createdAt: "2024-03-15T20:00:00Z",
    relatedEntityId: "EXC-501",
    relatedEntityType: "excursion",
  },
  {
    id: "REC-004",
    agentType: "port-disruption",
    title: "Crete Vendor Cancellation — Wine Experience",
    summary: "Vendor 'Cretan Flavors Co.' cancelled Wine & Olive Experience (March 16) due to staffing issues. 25 guests fully booked, including 8 who pre-purchased premium packages.",
    reasoning: "Agent analyzed: vendor communication logs, booking manifest, guest profiles, alternative vendor availability, and revenue impact ($3,625 in bookings, $1,200 in premium add-ons). Identified replacement vendor with 92% satisfaction rating.",
    dataSourcesUsed: ["Vendor Management System", "Booking Data", "Guest Profiles", "Vendor Rating Database"],
    confidence: 91,
    impact: "medium",
    status: "approved",
    actions: [
      { id: "A-012", label: "Rebook with 'Cretan Heritage Wines'", type: "rebooking", description: "Alternative vendor confirmed. Same itinerary, higher-rated guide." },
      { id: "A-013", label: "Upgrade premium guests to private tour", type: "upgrade", estimatedValue: 640, description: "8 premium guests get private wine cave experience at no extra cost" },
    ],
    createdAt: "2024-03-15T11:30:00Z",
    relatedEntityId: "EXC-504",
    relatedEntityType: "excursion",
  },
  {
    id: "REC-005",
    agentType: "onboard-ops",
    title: "Dining Capacity Crisis — Le Bordeaux & Lido",
    summary: "Le Bordeaux at 96% capacity with 25% understaffing. Lido Buffet at 89% with growing wait times. Compass Bar underutilized at 43%. Recommend immediate staff rebalancing.",
    reasoning: "Agent analyzed: real-time POS transactions, venue occupancy sensors, staff scheduling system, historical demand patterns (sea day peak = 18:00-20:30), and weather (outdoor venues limited). Predicted: Le Bordeaux will exceed capacity in 25 minutes. Lido wait times will reach 30+ minutes within 40 minutes.",
    dataSourcesUsed: ["Venue Sensors", "POS System", "Staff Scheduling", "Weather Data", "Historical Patterns", "Guest Flow Analytics"],
    confidence: 92,
    impact: "high",
    status: "pending",
    actions: [
      { id: "A-014", label: "Redeploy 4 staff from Compass Bar to Le Bordeaux", type: "staffing", description: "Move 2 servers + 2 runners from underutilized bar to fine dining" },
      { id: "A-015", label: "Open overflow seating in Atlas Lounge", type: "operations", description: "Convert Atlas Lounge for casual dining overflow, deploy 3 buffet staff" },
      { id: "A-016", label: "Push 'Compass Bar Happy Hour' notification", type: "demand-shaping", description: "Send targeted promo to guests in Lido queue to redirect 15-20% of traffic" },
      { id: "A-017", label: "Extend Ocean Grill hours to 22:00", type: "operations", description: "Add late seating to absorb dinner demand wave" },
    ],
    createdAt: "2024-03-15T18:45:00Z",
  },
  {
    id: "REC-006",
    agentType: "onboard-ops",
    title: "Pool Deck Overload + Maintenance Flag",
    summary: "Sky Pool at 99% capacity. Main pool filtration system flagged for maintenance. Spa wait times at 45 minutes. Recommend load balancing and preventive maintenance scheduling.",
    reasoning: "Agent analyzed: deck occupancy (148/150), pool system telemetry (filtration pressure +15% above normal), spa booking system, weather forecast (clear skies next 6 hours), and maintenance history (filter last serviced 12 days ago, recommended interval: 10 days).",
    dataSourcesUsed: ["Deck Sensors", "Pool System Telemetry", "Spa Bookings", "Maintenance Logs", "Weather Data"],
    confidence: 88,
    impact: "medium",
    status: "pending",
    actions: [
      { id: "A-018", label: "Schedule pool maintenance for 23:00", type: "maintenance", description: "Overnight filtration service to avoid guest disruption" },
      { id: "A-019", label: "Open Deck 14 overflow pool area", type: "operations", description: "Deploy 4 attendants to secondary pool area" },
      { id: "A-020", label: "Promote afternoon spa specials", type: "demand-shaping", description: "Redirect pool traffic with 20% off afternoon spa treatments" },
    ],
    createdAt: "2024-03-15T13:20:00Z",
  },
];

// ─── TIMELINE EVENTS ───
export const guestRecoveryTimeline: TimelineEvent[] = [
  { id: "T-001", timestamp: "2024-03-15T18:32:00Z", type: "alert", title: "Incident Reported", description: "Dining service complaint logged for Margaret Chen at Le Bordeaux. Priority flag: Platinum guest.", actor: "System" },
  { id: "T-002", timestamp: "2024-03-15T18:35:00Z", type: "analysis", title: "Agent Analysis Initiated", description: "Guest Recovery Agent began cross-referencing guest profile, loyalty data, spend history, and venue conditions.", actor: "AI Agent" },
  { id: "T-003", timestamp: "2024-03-15T18:38:00Z", type: "info", title: "Venue Context Retrieved", description: "Le Bordeaux: 96% capacity, 4 staff below optimal. Average wait time: 35 min (normal: 8 min).", actor: "AI Agent" },
  { id: "T-004", timestamp: "2024-03-15T19:15:00Z", type: "recommendation", title: "Recovery Plan Generated", description: "4-action recovery plan created. Confidence: 94%. Estimated retention impact: $58,000+ lifetime value.", actor: "AI Agent" },
  { id: "T-005", timestamp: "2024-03-15T19:20:00Z", type: "action", title: "Under Review", description: "Recommendation forwarded to Guest Services Director for approval.", actor: "System" },
];

export const portDisruptionTimeline: TimelineEvent[] = [
  { id: "T-010", timestamp: "2024-03-15T16:00:00Z", type: "alert", title: "Weather Advisory Received", description: "NOAA maritime forecast: Santorini area winds 35-40 knots expected March 16 06:00-18:00 local.", actor: "Weather Service" },
  { id: "T-011", timestamp: "2024-03-15T16:05:00Z", type: "analysis", title: "Impact Analysis Started", description: "Port Disruption Agent initiated impact assessment across excursions, guest segments, and revenue.", actor: "AI Agent" },
  { id: "T-012", timestamp: "2024-03-15T16:20:00Z", type: "info", title: "Guest Impact Mapped", description: "142 guests with Santorini excursions identified. 14 are Platinum/Gold tier. Total revenue at risk: $18,500.", actor: "AI Agent" },
  { id: "T-013", timestamp: "2024-03-15T20:00:00Z", type: "recommendation", title: "Disruption Plan Generated", description: "4-action mitigation plan. Includes pre-notification, rebooking, onboard alternatives, and auto-refunds.", actor: "AI Agent" },
];

export const onboardOpsTimeline: TimelineEvent[] = [
  { id: "T-020", timestamp: "2024-03-15T17:30:00Z", type: "alert", title: "Capacity Threshold Exceeded", description: "Le Bordeaux occupancy crossed 90% threshold. Staff-to-guest ratio below minimum.", actor: "Venue Sensors" },
  { id: "T-021", timestamp: "2024-03-15T17:35:00Z", type: "analysis", title: "Fleet-wide Venue Analysis", description: "Ops Agent scanning all 8 venues for capacity, staffing, and demand patterns.", actor: "AI Agent" },
  { id: "T-022", timestamp: "2024-03-15T17:45:00Z", type: "info", title: "Imbalance Detected", description: "Compass Bar at 43% occupancy with 2 excess staff. Le Bordeaux needs 4 additional staff immediately.", actor: "AI Agent" },
  { id: "T-023", timestamp: "2024-03-15T18:45:00Z", type: "recommendation", title: "Rebalancing Plan Generated", description: "4-action operational plan: staff redeployment, overflow venue, demand shaping, extended hours.", actor: "AI Agent" },
];

// ─── KPIs ───
export const dashboardKPIs: OperationalKPI[] = [
  { label: "Guest Recovery Opportunities", value: 7, change: 2, changeLabel: "from yesterday", trend: "up" },
  { label: "Disruptions Mitigated", value: 12, change: -3, changeLabel: "vs. last voyage", trend: "down" },
  { label: "Avg Handling Time Saved", value: "2.4 hrs", change: 18, changeLabel: "% improvement", trend: "up" },
  { label: "Bottlenecks Detected", value: 4, change: 1, changeLabel: "new today", trend: "up" },
  { label: "Revenue Protected", value: "$142K", change: 22, changeLabel: "% vs. manual", trend: "up" },
  { label: "Satisfaction Recovery Rate", value: "89%", change: 5, changeLabel: "pts improvement", trend: "up" },
];

export const shipInfo = {
  name: "MS Acme Voyager",
  currentVoyage: "Mediterranean Odyssey V-2024-03",
  currentLocation: "Aegean Sea — en route to Santorini",
  passengers: 2847,
  crew: 1205,
  departurePort: "Barcelona, Spain",
  nextPort: "Santorini, Greece",
  nextPortETA: "2024-03-16 07:00",
  voyageDay: 4,
  totalDays: 10,
  weatherCondition: "Partly Cloudy, 72°F",
  seaState: "Moderate (4-6 ft swells)",
};
