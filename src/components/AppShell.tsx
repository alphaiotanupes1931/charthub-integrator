import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LayoutDashboard,
  BookOpen,
  NotebookPen,
  Library,
  Users,
  Mic,
  BarChart3,
  MessageSquare,
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
  Menu,
  X,
  Sun,
  Moon,
} from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import { Tutorial } from "@/components/Tutorial";
import { useTheme } from "@/hooks/useTheme";
import { useProfile } from "@/hooks/useProfile";

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
  // Chat lives beside the dashboard; full chat is still reachable at /chat
  // { to: "/chat", label: "Chat", icon: MessageSquare },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useProfile();
  const nav = NAV.filter((n) => n.to !== "/admin" || isAdmin);

  async function handleSignOut() {
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (e) {
      console.error(e);
      toast.error("Failed to sign out");
    }
  }

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mobileOpen]);

  const SidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2.5 px-4 py-5">
        <Link to="/dashboard" className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full blur-md bg-primary/40" />
            <img src={logoAsset.url} alt="TradeMind" className="relative h-12 w-12 object-contain" />
          </div>
          {!collapsed && (
            <span className="font-display text-xl font-semibold tracking-tight truncate">
              <span className="text-foreground">Trade</span>
              <span className="text-gold-gradient">Mind</span>
            </span>
          )}
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                active
                  ? "bg-gradient-to-r from-primary/15 via-primary/8 to-transparent text-primary ring-gold"
                  : item.accent
                  ? "text-primary/80 hover:bg-accent/40"
                  : "text-foreground/80 hover:bg-accent/40 hover:text-foreground"
              }`}
              title={item.label}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-gold-gradient" />}
              <Icon className={`h-4 w-4 shrink-0 ${active ? "drop-shadow-[0_0_6px_color-mix(in_oklab,var(--gold)_60%,transparent)]" : ""}`} />
              {!collapsed && <span className="font-medium truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/60 pt-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Active Coach
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="h-7 w-7 shrink-0 rounded-full bg-rose-300/70 flex items-center justify-center">
                <Brain className="h-4 w-4 text-rose-900" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">The Analyst</div>
                <div className="text-[11px] text-muted-foreground truncate">Smart, institutional</div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground px-1"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen w-full text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={`${
          collapsed ? "w-16" : "w-64"
        } hidden md:flex shrink-0 border-r border-border/60 glass flex-col transition-[width] duration-300 ease-out`}
      >
        {SidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-sm animate-in fade-in"
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border/60 bg-background flex flex-col animate-in slide-in-from-left duration-200">
            {SidebarContent}
          </aside>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 px-4 md:px-6 py-3 border-b border-border/60 bg-background/80 backdrop-blur-xl">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden h-9 w-9 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          {/* Desktop collapse */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden md:flex h-9 w-9 rounded-md border border-border items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <HeaderSearch nav={nav} />
          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="h-9 w-9 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {/* Mobile logo */}
          <Link to="/dashboard" className="md:hidden flex items-center gap-1.5 shrink-0">
            <img src={logoAsset.url} alt="TradeMind" className="h-10 w-10 object-contain" />
          </Link>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>

        <footer className="border-t border-border/60 px-4 md:px-6 py-3 text-center text-[11px] md:text-xs text-muted-foreground">
          Educational analysis only, not financial advice.
        </footer>
      </div>
      <Tutorial />
    </div>
  );
}
