import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import logoAsset from "../assets/logo.png.asset.json";
import { CookieBanner } from "../components/CookieBanner";
import { Toaster } from "../components/ui/sonner";
import { VersionWatcher } from "../components/VersionWatcher";



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0a0a0a" },
      { title: "TradeMind, AI Trading Coach & Live Charts" },
      { name: "description", content: "AI trading coach with live charts, trade journaling, and performance analytics for day, swing, and prop traders." },

      { name: "robots", content: "index, follow" },

      { property: "og:title", content: "TradeMind, AI Trading Coach" },
      { property: "og:description", content: "Live charts and AI-powered coaching for serious traders." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "TradeMind" },
      { property: "og:image", content: logoAsset.url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: logoAsset.url },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: logoAsset.url },
      { rel: "apple-touch-icon", href: logoAsset.url },
      { rel: "canonical", href: "https://trademindaicoach.com/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});


function RootShell({ children }: { children: ReactNode }) {
  const themeScript = `(function(){try{localStorage.removeItem('trademind.theme');}catch(e){}document.documentElement.classList.remove('light');document.documentElement.classList.add('dark');})();`;
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Auto-recover from stale deploy: when a lazy-loaded route chunk 404s
    // (old index.html referencing hashed JS that no longer exists), reload once
    // to pull the fresh index.html + new chunk hashes.
    const RELOAD_KEY = "trademind.chunkReload";
    const isChunkError = (msg: string) =>
      /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg);
    const tryReload = (msg: string) => {
      if (!isChunkError(msg)) return;
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
        if (Date.now() - last < 10_000) return; // avoid loops
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch { /* ignore */ }
      window.location.reload();
    };
    const onPreload = (e: Event) => tryReload(String((e as CustomEvent).detail?.message ?? e.type));
    const onError = (e: ErrorEvent) => tryReload(String(e.message ?? ""));
    const onRejection = (e: PromiseRejectionEvent) => tryReload(String((e.reason as { message?: string })?.message ?? e.reason ?? ""));
    window.addEventListener("vite:preloadError", onPreload);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Single global auth state listener: invalidate router/cache on identity changes.
    let unsub: (() => void) | undefined;
    import("@/integrations/supabase/client").then(({ supabase }) => {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      });
      unsub = () => data.subscription.unsubscribe();
    });
    return () => {
      window.removeEventListener("vite:preloadError", onPreload);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      unsub?.();
    };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <CookieBanner />
      <VersionWatcher />
      <Toaster />
    </QueryClientProvider>
  );
}
