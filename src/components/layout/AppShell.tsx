import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { FireBackground } from "@/fire/FireBackground";
import { Sidebar, SidebarContent } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { useLanguage } from "@/store/language";
import { CreateWorkspaceProvider } from "@/features/workspace/CreateWorkspace";

export function AppShell() {
  return (
    <CreateWorkspaceProvider>
      <AppShellInner />
    </CreateWorkspaceProvider>
  );
}

function AppShellInner() {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const { isPersian } = useLanguage();

  // Global shortcut: ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Warm the page chunks while the browser is idle so navigation feels instant.
  useEffect(() => {
    const warm = () => {
      void import("@/pages/AssistantsPage");
      void import("@/pages/KnowledgePage");
      void import("@/pages/PlaygroundPage");
      void import("@/pages/SettingsPage");
      void import("@/pages/AnalyticsPage");
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const id = idle(warm, { timeout: 4000 });
      return () => (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // Close transient UI when the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Scroll the content region to the top on navigation.
  useEffect(() => {
    // The window is the scroll container; #app-scroll is not scrollable.
    window.scrollTo({ top: 0, behavior: "auto" });
    document.getElementById("app-scroll")?.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div dir={isPersian ? "rtl" : "ltr"} className="relative min-h-screen bg-base">
      <FireBackground />

      <div className="relative z-10 flex min-h-screen">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenNav={() => setNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
          {/* A translucent scrim lets the particle atmosphere sit behind the
              interface without reducing content contrast. */}
          <main
            id="app-scroll"
            className="min-w-0 flex-1 bg-gradient-to-b from-base/20 via-base/10 to-base/30 px-3 pb-24 pt-4 sm:px-5"
          >
            <div className="mx-auto w-full max-w-[1400px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/* Mobile navigation: a drawer rather than a squeezed rail, so every
          destination stays reachable with full-size tap targets. */}
      {navOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[2px]"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="nav-drawer surface-panel absolute inset-y-0 start-0 w-[272px] animate-[slide-in-left_0.26s_var(--ease-out-soft)_both] border-y-0 border-s-0 rounded-none"
          >
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
