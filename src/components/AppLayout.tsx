import { useLocation } from "react-router-dom";
import { StickyHeader } from "@/components/StickyHeader";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator
} from "@/components/ui/breadcrumb";

const breadcrumbMap: Record<string, { label: string; parent?: string }> = {
  "/": { label: "Dashboard" },
  "/guest-recovery": { label: "Guest Recovery", parent: "/" },
  "/architecture": { label: "Architecture", parent: "/" },
};

export function AppLayout({ children }: { children: React.ReactNode }) {
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
    <div className="flex h-screen flex-col overflow-hidden">
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
  );
}
