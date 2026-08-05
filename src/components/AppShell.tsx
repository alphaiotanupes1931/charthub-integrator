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
  BarChart3,
  Brain,
  Bell,
  MessageSquare,
  Settings as SettingsIcon,
  UserCog,
  ShieldCheck,
  Search,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Radar,
  FlaskConical,
  Send,
  Calculator,
  GraduationCap,
  Footprints,
  Building2,
  Trophy,
  Bot,
  Newspaper,
  Plug,
  ChevronDown,

} from "lucide-react";
import { LogoLink } from "@/components/LogoLink";
import { Tutorial } from "@/components/Tutorial";
import { WelcomeBackGreeter, WelcomeBackProvider } from "@/components/WelcomeBackGreeter";
import { useProfile } from "@/hooks/useProfile";
import { NotificationBell } from "@/components/NotificationBell";
import { NewsMarquee } from "@/components/NewsMarquee";

import { OnboardingTour } from "@/components/OnboardingTour";


type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  accent?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
};

// Pinned links, always visible at the top of the sidebar.
const TOP_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

// Everything else is nested inside a small number of groups so the sidebar
// stays short. Groups auto-open when the active route lives inside them.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "trade",
    label: "Trade",
    icon: Radar,
    items: [
      { to: "/signals",    label: "AI Signals",      icon: Radar },
      { to: "/journal",    label: "Trade Journal",   icon: NotebookPen },
      { to: "/alerts",     label: "Price Alerts",    icon: Bell },
      { to: "/calculator", label: "Risk Calculator", icon: Calculator },
      { to: "/autopilot",  label: "Autopilot",       icon: Bot },
      { to: "/testing",    label: "Paper Testing",   icon: FlaskConical },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart3,
    items: [
      { to: "/analytics",   label: "Analytics",      icon: BarChart3 },
      { to: "/backtest",    label: "Backtest",       icon: FlaskConical },
      { to: "/memory",      label: "Trading Memory", icon: Brain },
      { to: "/news",        label: "News",           icon: Newspaper },
      { to: "/leaderboard", label: "Leaderboard",    icon: Trophy },
    ],
  },
  {
    id: "coaching",
    label: "Coaching",
    icon: Users,
    items: [
      { to: "/coaches",    label: "AI Coaches", icon: Users },
      { to: "/strategies", label: "Strategies", icon: Library },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    icon: GraduationCap,
    items: [
      { to: "/academy",    label: "Academy",    icon: GraduationCap },
      { to: "/flashcards", label: "Flashcards", icon: BookOpen },
      { to: "/guide",      label: "Guide",      icon: BookOpen },
      { to: "/first-week", label: "First Week", icon: Footprints },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: Plug,
    items: [
      { to: "/connections", label: "Broker Connections", icon: Plug },
      { to: "/broker",      label: "OANDA",              icon: Building2 },
      { to: "/discord",     label: "Discord",            icon: MessageSquare },
    ],
  },
];

// Pinned links at the bottom.
const BOTTOM_NAV: NavItem[] = [
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/admin",    label: "Admin",    icon: ShieldCheck, accent: true },
];

// Flat list used by search, the collapsed icon rail, and the mobile drawer.
const NAV: NavItem[] = [
  ...TOP_NAV,
  ...NAV_GROUPS.flatMap((g) => g.items),
  ...BOTTOM_NAV,
];

const GROUP_STORAGE_KEY = "trademind.sidebar.groups.v1";

// Robinhood-style bottom tab bar (mobile only). Four primary tabs + More.
const MOBILE_TABS: { to: string; label: string; icon: typeof LayoutDashboard }[] = [
  { to: "/dashboard", label: "Chart",     icon: LayoutDashboard },
  { to: "/journal",   label: "Journal",   icon: NotebookPen },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/coaches",   label: "Coaches",   icon: Users },
];



export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDashboard = pathname === "/dashboard";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, profile } = useProfile();
  const nav = NAV.filter((n) => n.to !== "/admin" || isAdmin);

  // Which sidebar groups are expanded. Persisted, and the group holding the
  // active route is always opened so the user never loses their place.
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(GROUP_STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw) as string[];
    } catch { /* ignore */ }
    return ["trade"];
  });

  useEffect(() => {
    const owning = NAV_GROUPS.find((g) =>
      g.items.some((i) => pathname === i.to || pathname.startsWith(i.to + "/")),
    );
    if (owning && !openGroups.includes(owning.id)) {
      setOpenGroups((prev) => [...prev, owning.id]);
    }
  }, [pathname, openGroups]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try { localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };




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
        <LogoLink
          to="/dashboard"
          size="lg"
          variant="brand"
          glow
          showText={!collapsed}
          textClassName="text-xl"
          className="gap-2.5"
        />
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pb-2">
          <SidebarSearch nav={nav} />
        </div>
      )}

      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {collapsed ? (
          // Collapsed rail: flat icon list, no group headers.
          nav.map((item) => (
            <NavLinkRow key={item.to} item={item} pathname={pathname} collapsed />
          ))
        ) : (
          <>
            {TOP_NAV.map((item) => (
              <NavLinkRow key={item.to} item={item} pathname={pathname} />
            ))}
            {NAV_GROUPS.map((group) => (
              <NavGroupBlock
                key={group.id}
                group={group}
                pathname={pathname}
                open={openGroups.includes(group.id)}
                onToggle={() => toggleGroup(group.id)}
              />
            ))}
            <div className="pt-2 mt-2 border-t border-border/60 space-y-0.5">
              {BOTTOM_NAV.filter((n) => n.to !== "/admin" || isAdmin).map((item) => (
                <NavLinkRow key={item.to} item={item} pathname={pathname} />
              ))}
            </div>
          </>
        )}
      </nav>

      {!collapsed ? (
        <div className="px-3 pb-3 space-y-2 border-t border-border/60 pt-3">
          {profile?.email && (
            <div className="text-[11px] text-muted-foreground truncate px-1" title={profile.email}>
              {profile.email}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground px-1"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      ) : (
        <div className="px-2 pb-3 pt-3 border-t border-border/60 flex flex-col items-center gap-2">
          <button
            onClick={handleSignOut}
            className="h-9 w-9 rounded-md text-muted-foreground hover:text-foreground flex items-center justify-center"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );


  return (
    <WelcomeBackProvider>
      <div className={`flex w-full text-foreground ${isDashboard ? "h-screen overflow-hidden" : "min-h-screen"}`}>
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
          <NewsMarquee />
          <div className="flex-1 md:hidden" />
          <TestingBanner />

          <NotificationBell />
          {/* Mobile logo */}
          <LogoLink to="/dashboard" size="md" showText={false} className="md:hidden shrink-0" />

        </header>

        <main className={`flex-1 min-w-0 ${isDashboard ? "h-full overflow-hidden pb-24 md:pb-0" : "overflow-x-hidden pb-24 md:pb-0 pt-6 sm:pt-8 md:pt-10 px-3 sm:px-4 md:px-6"}`}>{children}</main>

        <footer className="hidden md:block border-t border-border/60 px-4 md:px-6 py-3 text-center text-[11px] md:text-xs text-muted-foreground">
          Educational analysis only, not financial advice.
        </footer>
        {/* Mobile compliance footer - sits above the tab bar */}
        <div
          className="md:hidden fixed bottom-16 inset-x-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur-xl px-3 py-1.5 text-center text-[10px] text-muted-foreground"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4px)" }}
        >
          Educational analysis only, not financial advice.
        </div>
      </div>
      <ComplianceGate />
      <OnboardingTour />


      {/* Mobile bottom tab bar (Robinhood-style). Fixed to the viewport, safe-area aware. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="grid grid-cols-5 h-16">
          {MOBILE_TABS.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "drop-shadow-[0_0_6px_color-mix(in_oklab,var(--gold)_60%,transparent)]" : ""}`} />
                {t.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground"
            aria-label="More"
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      <Tutorial />
      <WelcomeBackGreeter />
    </div>
    </WelcomeBackProvider>
  );
}

function NavLinkRow({
  item,
  pathname,
  collapsed,
  nested,
}: {
  item: NavItem;
  pathname: string;
  collapsed?: boolean;
  nested?: boolean;
}) {
  const active = pathname === item.to || pathname.startsWith(item.to + "/");
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={`group relative flex items-center gap-3 rounded-lg text-sm transition-all duration-200 ${
        nested ? "pl-9 pr-3 py-2" : "px-3 py-2.5"
      } ${
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
}

function NavGroupBlock({
  group,
  pathname,
  open,
  onToggle,
}: {
  group: NavGroup;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = group.icon;
  const hasActive = group.items.some((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
          hasActive ? "text-primary" : "text-foreground/80 hover:bg-accent/40 hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="font-medium truncate flex-1 text-left">{group.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavLinkRow key={item.to} item={item} pathname={pathname} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function ComplianceGate() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const seen = localStorage.getItem("trademind.compliance.ack.v1");
      if (!seen) setOpen(true);
    } catch { /* ignore */ }
  }, []);
  if (!open) return null;
  const accept = () => {
    try { localStorage.setItem("trademind.compliance.ack.v1", new Date().toISOString()); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="text-lg font-semibold mb-2">Welcome to TradeMind</div>
        <p className="text-sm text-muted-foreground mb-4">
          TradeMind provides educational analysis and coaching tools only. Nothing here is financial,
          investment, or trading advice. Trading involves risk of loss. You are solely responsible for
          your decisions.
        </p>
        <button
          onClick={accept}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
        >
          I understand
        </button>
      </div>
    </div>
  );
}

function SidebarSearch({ nav }: { nav: NavItem[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return nav.slice(0, 6);
    return nav.filter((n) => n.label.toLowerCase().includes(term) || n.to.toLowerCase().includes(term)).slice(0, 8);
  }, [q, nav]);

  // ⌘K / Ctrl+K to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => { setActive(0); }, [q]);

  const go = (to: string) => {
    setOpen(false);
    setQ("");
    navigate({ to });
  };

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); const r = results[active]; if (r) go(r.to); }
        }}
        placeholder="Search pages…"
        className="w-full h-9 rounded-lg border border-border bg-card/50 pl-9 pr-3 md:pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
      />
      <kbd className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground pointer-events-none">
        ⌘K
      </kbd>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 rounded-lg border border-border bg-card shadow-xl z-50 overflow-hidden">
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <button
                key={r.to}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.to)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition ${
                  i === active ? "bg-accent/60 text-foreground" : "text-foreground/85 hover:bg-accent/40"
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{r.label}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{r.to}</span>
              </button>
            );
          })}
        </div>
      )}
      {open && results.length === 0 && (
        <div className="absolute left-0 right-0 mt-1.5 rounded-lg border border-border bg-card shadow-xl z-50 px-3 py-2.5 text-xs text-muted-foreground">
          No pages match "{q}".
        </div>
      )}
    </div>
  );
}

function TestingBanner() {
  const [active, setActive] = useState(false);
  const [equity, setEquity] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { if (!cancelled) setActive(false); return; }
        const { getPaperState } = await import("@/lib/paper-engine.functions");
        const s: any = await getPaperState();
        if (cancelled) return;
        setActive(Boolean(s?.account?.testing_mode));
        setEquity(s?.account?.balance != null ? Number(s.account.balance) : null);
      } catch {
        if (!cancelled) setActive(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    const onChange = () => load();
    window.addEventListener("trademind:testing-mode-changed", onChange);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("trademind:testing-mode-changed", onChange);
    };
  }, []);
  if (!active) return null;
  return (
    <Link
      to="/testing"
      className="hidden sm:inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-500 hover:bg-amber-500/20"
      title="You are in paper trading mode. Click to manage the test account."
    >
      <FlaskConical className="h-3.5 w-3.5" />
      Testing mode
      {equity != null && (
        <span className="text-amber-400/80 normal-case tracking-normal">
          · ${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      )}
    </Link>
  );
}
