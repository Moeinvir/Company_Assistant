import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { FireThemeProvider } from "@/fire/FireThemeProvider";
import { ToastProvider } from "@/store/toast";
import { SessionProvider, useSession } from "@/store/session";
import { WorkspaceDataProvider } from "@/store/workspaceData";
import { AppShell } from "@/components/layout/AppShell";
import { EmberMark } from "@/components/brand/EmberMark";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthPage } from "@/pages/AuthPage";
import { LanguageProvider } from "@/store/language";

// Pages are code-split so the initial shell stays small.
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const AssistantsPage = lazy(() => import("@/pages/AssistantsPage"));
const AssistantDetailPage = lazy(() => import("@/pages/AssistantDetailPage"));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage"));
const PlaygroundPage = lazy(() => import("@/pages/PlaygroundPage"));
const WidgetBuilderPage = lazy(() => import("@/pages/WidgetBuilderPage"));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const WidgetRuntimePage = lazy(() => import("@/pages/WidgetRuntimePage"));

function BootingScreen({ label = "Preparing your workspace" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base">
      <EmberMark size={40} className="animate-breathe" />
      <p className="text-2xs text-ink-mute">{label}</p>
    </div>
  );
}

function ProtectedShell() {
  const { session, restoring, clientReady, workspace } = useSession();

  if (!clientReady || restoring) return <BootingScreen />;
  if (!session) return <Navigate to="/login" replace />;
  if (!workspace) return <BootingScreen label="Loading your workspace" />;

  return (
    <WorkspaceDataProvider key={workspace.id}>
      <AppShell />
    </WorkspaceDataProvider>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="skeleton h-7 w-52" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton h-24 rounded-card" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-card" />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <FireThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <SessionProvider>
              <BrowserRouter>
                <Suspense fallback={<BootingScreen />}>
                  <Routes>
                    <Route path="/login" element={<AuthPage />} />
                    <Route path="/widget/:publicKey" element={<WidgetRuntimePage />} />
                    <Route element={<ProtectedShell />}>
                      <Route
                        path="/dashboard"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <DashboardPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/assistants"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <AssistantsPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/assistants/:assistantId"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <AssistantDetailPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/knowledge"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <KnowledgePage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/knowledge/:knowledgeBaseId"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <KnowledgePage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/playground"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <PlaygroundPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/widget-builder"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <WidgetBuilderPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/widget-builder/:assistantId"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <WidgetBuilderPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/integrations"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <IntegrationsPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/analytics"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <AnalyticsPage />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/settings"
                        element={
                          <Suspense fallback={<PageFallback />}>
                            <SettingsPage />
                          </Suspense>
                        }
                      />
                    </Route>
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </SessionProvider>
          </ToastProvider>
        </LanguageProvider>
      </FireThemeProvider>
    </ErrorBoundary>
  );
}
