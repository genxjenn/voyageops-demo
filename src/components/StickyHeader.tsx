import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Search, LayoutDashboard, UserCheck, Ship, Settings2, FileText, Command } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Guest Recovery", to: "/guest-recovery", icon: UserCheck },
  { label: "Port & Excursions", to: "/port-disruption", icon: Ship },
  { label: "Onboard Ops", to: "/onboard-ops", icon: Settings2 },
  { label: "Architecture", to: "/architecture", icon: FileText },
];

const searchableItems = [
  { label: "Dashboard", to: "/", keywords: ["home", "overview", "kpi", "metrics"] },
  { label: "Guest Recovery Agent", to: "/guest-recovery", keywords: ["guest", "recovery", "incident", "complaint", "jane doe", "service"] },
  { label: "Port & Excursion Disruption Agent", to: "/port-disruption", keywords: ["port", "excursion", "weather", "disruption", "santorini", "itinerary"] },
  { label: "Onboard Operations Agent", to: "/onboard-ops", keywords: ["onboard", "operations", "venue", "staffing", "maintenance", "capacity"] },
  { label: "Architecture", to: "/architecture", keywords: ["architecture", "system", "design", "docs"] },
];

export function StickyHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentPage = navItems.find(i => i.to === location.pathname) ?? navItems[0];

  const results = useMemo(() => {
    if (!query.trim()) return searchableItems;
    const q = query.toLowerCase();
    return searchableItems.filter(
      item => item.label.toLowerCase().includes(q) || item.keywords.some(k => k.includes(q))
    );
  }, [query]);

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      navigate(results[selectedIndex].to);
      setSearchOpen(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-4 border-b border-border bg-background/95 backdrop-blur-sm px-6">
        {/* Left: Page tabs */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin">
          {navItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search pages…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setSearchOpen(false)}>
          <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl animate-slide-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search pages, agents, features…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No results found</p>
              ) : (
                results.map((item, idx) => {
                  const navItem = navItems.find(n => n.to === item.to);
                  const Icon = navItem?.icon ?? LayoutDashboard;
                  return (
                    <button
                      key={item.to}
                      onClick={() => { navigate(item.to); setSearchOpen(false); }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left",
                        idx === selectedIndex
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.keywords.slice(0, 3).join(", ")}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
