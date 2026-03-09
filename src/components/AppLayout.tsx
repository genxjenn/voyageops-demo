import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, UserCheck, Ship, Settings2, Brain, ChevronLeft, ChevronRight, Anchor, FileText, Home
} from "lucide-react";
import { useState } from "react";
import { GuidedDemo } from "@/components/GuidedDemo";
import { StickyHeader } from "@/components/StickyHeader";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator
} from "@/components/ui/breadcrumb";

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Guest Recovery", to: "/guest-recovery", icon: UserCheck },
  { label: "Port & Excursions", to: "/port-disruption", icon: Ship },
  { label: "Onboard Ops", to: "/onboard-ops", icon: Settings2 },
  { label: "Architecture", to: "/architecture", icon: FileText },
];

const breadcrumbMap: Record<string, { label: string; parent?: string }> = {
  "/": { label: "Dashboard" },
  "/guest-recovery": { label: "Guest Recovery", parent: "/" },
  "/port-disruption": { label: "Port & Excursions", parent: "/" },
  "/onboard-ops": { label: "Onboard Ops", parent: "/" },
  "/architecture": { label: "Architecture", parent: "/" },
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const crumbs: { label: string; to?: string }[] = [];
  let current = breadcrumbMap[location.pathname];
  if (current) {
    crumbs.unshift({ label: current.label });
    let parentPath = current.parent;
    while (parentPath && breadcrumbMap[parentPath]) {
      crumbs.unshift({ label: breadcrumbMap[parentPath].label, to: parentPath });
      parentPath = breadcrumbMap[parentPath].parent;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "flex flex-col border-r border-border bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Anchor className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">VoyageOps AI</p>
              <p className="truncate text-[10px] text-muted-foreground">Acme Cruise Line</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Agent Status */}
        {!collapsed && (
          <div className="border-t border-border p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Agent Status</p>
            {["Guest Recovery", "Port Disruption", "Onboard Ops"].map((agent) => (
              <div key={agent} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
                <span className="text-xs text-muted-foreground">{agent}</span>
              </div>
            ))}
          </div>
        )}

        {/* Collapse */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-10 items-center justify-center border-t border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <StickyHeader />
        {crumbs.length > 1 && (
          <div className="border-b border-border bg-muted/30 px-6 py-2">
            <Breadcrumb>
              <BreadcrumbList>
                {crumbs.map((crumb, idx) => (
                  <BreadcrumbItem key={idx}>
                    {idx > 0 && <BreadcrumbSeparator />}
                    {crumb.to ? (
                      <BreadcrumbLink href={crumb.to} className="text-xs">{crumb.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="text-xs">{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>
      </div>

      <GuidedDemo />
    </div>
  );
}
