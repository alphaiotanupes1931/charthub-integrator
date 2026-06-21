import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  BookOpen,
  NotebookPen,
  Library,
  Users,
  Mic,
  BarChart3,
  Brain,
  Activity,
  Settings as SettingsIcon,
  UserCog,
  ShieldCheck,
  Search,
  Sparkles,
  BellOff,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import logoAsset from "@/assets/trademind-logo.png.asset.json";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  accent?: boolean;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/guide", label: "Guide", icon: BookOpen },
  { to: "/journal", label: "Trade Journal", icon: NotebookPen },
  { to: "/strategies", label: "Strategies", icon: Library },
  { to: "/coaches", label: "AI Coaches", icon: Users },
  { to: "/voice-coach", label: "Voice Coach", icon: Mic },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/memory", label: "Trading Memory", icon: Brain },
  { to: "/system-status", label: "System Status", icon: Activity },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/mentor", label: "Coach Dashboard", icon: UserCog },
  { to: "/admin", label: "Admin", icon: ShieldCheck, accent: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`${
          collapsed ? "w-16" : "w-64"
        } shrink-0 border-r border-border bg-background flex flex-col transition-[width] duration-200`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logoAsset.url} alt="TradeMind" className="h-8 w-8 object-contain" />
          {!collapsed && (
            <span className="font-display text-xl font-semibold tracking-tight">
              <span className="text-foreground">Trade</span>
              <span className="text-foreground/90">Mind</span>
            </span>
          )}
        </div>

        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border border-primary/60 bg-primary/5 text-primary"
                    : item.accent
                    ? "text-primary/80 hover:bg-accent/40"
                    : "text-foreground/80 hover:bg-accent/40 hover:text-foreground"
                }`}
                title={item.label}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="px-3 pb-3 space-y-3">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">
                <Sparkles className="h-3 w-3" /> AI Coach
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Active
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="h-7 w-7 rounded-full bg-rose-300/70 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-rose-900" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">The Analyst</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    Smart, institutional, measu…
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
              <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold">Telegram alerts</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  Get instant signals on…
                </div>
              </div>
              <button className="rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10">
                Connect
              </button>
            </div>

            <div className="text-xs text-muted-foreground px-1">terellebony@gmail.com</div>
            <button className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground px-1">
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-6 py-3 border-b border-border/60">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="h-9 w-9 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search"
              className="w-full h-9 rounded-lg border border-border bg-card/50 pl-9 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>

        <footer className="border-t border-border/60 px-6 py-3 text-center text-xs text-muted-foreground">
          This is educational analysis only, not financial advice. Past performance does not predict future results.
        </footer>
      </div>
    </div>
  );
}
