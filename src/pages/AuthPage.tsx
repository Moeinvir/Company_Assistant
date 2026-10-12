import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowRight, Database, Lock, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { FireBackground } from "@/fire/FireBackground";
import { Wordmark } from "@/components/brand/EmberMark";
import { Button, Field, Input } from "@/components/ui";
import { useSession } from "@/store/session";
import { cn } from "@/lib/cn";
import { LanguageSwitch, useLanguage } from "@/store/language";

type Mode = "sign-in" | "sign-up";

const HIGHLIGHTS = [
  {
    icon: Zap,
    title: "Assistants on your own knowledge",
    body: "Chunk, embed and index documents, then ground every answer in the passages that produced it.",
  },
  {
    icon: Sparkles,
    title: "A laboratory, not a chat box",
    body: "Inspect retrieved passages, relevance scores and response metadata for every single query.",
  },
  {
    icon: ShieldCheck,
    title: "Workspaces keep knowledge apart",
    body: "Every record belongs to one workspace. Retail assistants only ever read their own knowledge bases.",
  },
  {
    icon: Database,
    title: "No hidden infrastructure",
    body: "This build runs its data layer in your browser. Provider keys stay on this device and nothing is uploaded.",
  },
];

export function AuthPage() {
  const { session, signIn, signUp, client, clientReady } = useSession();
  const { translate } = useLanguage();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAccount, setHasAccount] = useState(false);

  // The offline data layer remembers whether an account exists on this device,
  // so the first screen is the right one to show.
  useEffect(() => {
    try {
      setHasAccount(Boolean(localStorage.getItem("pyre.db.v1")));
    } catch {
      setHasAccount(false);
    }
  }, []);

  if (session) return <Navigate to="/dashboard" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") await signIn(email, password);
      else await signUp(name, email, password);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const suffix = Math.random().toString(36).slice(2, 8);
      await signUp("Demo operator", `demo.${suffix}@parsis.local`, `parsis-${suffix}-${suffix}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-base">
      <FireBackground />
      <div className="absolute end-4 top-4 z-20">
        <LanguageSwitch />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-5 py-10 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <section className="min-w-0 flex-1">
          <Wordmark />
          <h1 className="mt-8 max-w-xl text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-4xl">
            {translate("AI intelligence forged in fire.")}
          </h1>
          <p className="mt-4 max-w-xl text-micro leading-relaxed text-ink-soft">
            {translate("Parsis Bridge is the control room for retrieval-augmented assistants: connect providers, index your documents, tune retrieval and ship the widget — with every answer traceable back to the passages behind it.")}
          </p>

          <dl className="mt-8 grid gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-card border border-hairline bg-black/25 p-3.5 backdrop-blur-sm"
                >
                  <dt className="flex items-center gap-2 text-2xs font-medium text-ink">
                    <Icon className="size-3.5 shrink-0 text-accent" aria-hidden />
                    {translate(item.title)}
                  </dt>
                  <dd className="mt-1.5 text-2xs leading-relaxed text-ink-mute">{translate(item.body)}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="w-full max-w-md shrink-0">
          <div className="surface-panel p-5 sm:p-6">
            <div className="flex items-center gap-1 rounded-[10px] border border-hairline bg-black/25 p-1">
              {(["sign-in", "sign-up"] as Mode[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setMode(candidate);
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 rounded-[8px] px-3 py-1.5 text-2xs font-medium transition-colors",
                    mode === candidate ? "bg-surface-3 text-ink" : "text-ink-mute hover:text-ink-soft",
                  )}
                >
                  {translate(candidate === "sign-in" ? "Sign in" : "Create account")}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3.5">
              {mode === "sign-up" ? (
                <Field label={translate("Your name")} htmlFor="auth-name">
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex Rivera"
                    autoComplete="name"
                  />
                </Field>
              ) : null}

              <Field label={translate("Work email")} htmlFor="auth-email">
                <Input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </Field>

              <Field
                label={translate("Password")}
                htmlFor="auth-password"
                hint={mode === "sign-up" ? translate("At least 8 characters.") : undefined}
              >
                <Input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                />
              </Field>

              {error ? (
                <p className="rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3 py-2 text-2xs leading-relaxed text-danger">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center"
                loading={busy}
                disabled={!clientReady}
              >
                {translate(mode === "sign-in" ? "Sign in" : "Create workspace")}
                {!busy ? <ArrowRight className="size-3.5" aria-hidden /> : null}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-hairline" />
              <span className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                {translate("or")}
              </span>
              <span className="h-px flex-1 bg-hairline" />
            </div>

            <Button
              variant="outline"
              size="lg"
              className="w-full justify-center"
              onClick={() => void createDemo()}
              loading={busy}
              iconLeft={<Sparkles className="size-3.5" aria-hidden />}
            >
              {translate("Create a private demo workspace")}
            </Button>

            <p className="mt-4 flex items-start gap-2 text-[10px] leading-relaxed text-ink-faint">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                {translate("Accounts, documents and keys are stored in this browser profile by the")}{" "}
                <code className="font-mono text-ink-mute">{client?.mode ?? "local"}</code>{" "}
                {translate("data layer. A demo account is created with a pre-populated sample workspace you can delete at any time.")}
                {hasAccount ? null : ` ${translate("Nothing leaves this device.")}`}
              </span>
            </p>
          </div>

          <p className="mt-4 text-center text-[10px] text-ink-faint">
            {mode === "sign-in" && !hasAccount
              ? translate("No account on this device yet — create one to begin.")
              : translate("Prefer to start clean? Create an account and ignore the sample workspace.")}
          </p>
        </section>
      </div>
    </div>
  );
}
