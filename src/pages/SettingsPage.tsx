import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  Database,
  Eraser,
  Flame,
  HardDrive,
  LogOut,
  Server,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DetailRow,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  StatusDot,
  TabBar,
  TabPanel,
  type TabDefinition,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { FireThemePanel } from "@/features/fire/FireThemePanel";
import { useSession } from "@/store/session";
import { useWorkspaceData } from "@/store/workspaceData";
import { formatBytes, formatNumber, formatRelative } from "@/lib/format";
import type { Workspace } from "@/lib/api/types";

type TabId = "workspace" | "appearance" | "data" | "account";

export default function SettingsPage() {
  const navigate = useNavigate();
  const {
    user,
    workspace,
    workspaces,
    client,
    signOut,
    updateWorkspace,
    removeWorkspace,
    selectWorkspace,
  } = useSession();
  const {
    members,
    assistants,
    knowledgeBases,
    activity,
    clearSampleData,
  } = useWorkspaceData();

  const [tab, setTab] = useState<TabId>("workspace");
  const [name, setName] = useState(workspace?.name ?? "");
  const [plan, setPlan] = useState<Workspace["plan"]>(workspace?.plan ?? "trial");
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setPlan(workspace?.plan ?? "trial");
  }, [workspace?.id, workspace?.name, workspace?.plan]);

  // Honest storage reporting: the offline data layer lives in localStorage.
  const storage = useMemo(() => {
    if (typeof localStorage === "undefined") return { bytes: 0, share: 0 };
    let bytes = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      bytes += (localStorage.getItem(key)?.length ?? 0) * 2;
    }
    const quota = 5 * 1024 * 1024;
    return { bytes, share: Math.min(1, bytes / quota) };
  }, [assistants.length, knowledgeBases.length, activity.length]);

  const tabs: TabDefinition<TabId>[] = [
    { id: "workspace", label: "Workspace", icon: <Building2 className="size-3.5" aria-hidden /> },
    { id: "appearance", label: "Fire theme", icon: <Flame className="size-3.5" aria-hidden /> },
    { id: "data", label: "Data & privacy", icon: <Database className="size-3.5" aria-hidden /> },
    { id: "account", label: "Account", icon: <UserCog className="size-3.5" aria-hidden /> },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace identity, members, appearance and the data this build keeps on your device."
        meta={
          <>
            <Badge tone={workspace?.isSample ? "warn" : "neutral"}>
              {workspace?.isSample ? "sample workspace" : `${workspace?.plan} plan`}
            </Badge>
            <Badge tone={client.mode === "demo" ? "info" : "success"} icon={<Server className="size-3" aria-hidden />}>
              {client.mode === "demo" ? "offline data layer" : "remote API"}
            </Badge>
          </>
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      <TabPanel id="workspace" active={tab === "workspace"}>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader title="Workspace" description="Names and plan shown across the product." />
            <CardBody className="space-y-3.5">
              <Field label="Workspace name" htmlFor="settings-name">
                <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Plan" hint="Plan labels are cosmetic in this build; they do not gate features.">
                <SegmentedControl
                  value={plan}
                  onChange={(value) => setPlan(value as Workspace["plan"])}
                  options={[
                    { value: "trial", label: "Trial" },
                    { value: "team", label: "Team" },
                    { value: "scale", label: "Scale" },
                  ]}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={
                    !workspace ||
                    (name === workspace.name && plan === workspace.plan) ||
                    name.trim().length === 0
                  }
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await updateWorkspace({ name: name.trim(), plan });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save workspace
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Members"
              description="Everyone with access to this workspace's knowledge."
              icon={<Users className="size-3.5" aria-hidden />}
              actions={<Badge tone="neutral">{members.length}</Badge>}
            />
            <CardBody className="space-y-2">
              {members.length === 0 ? (
                <p className="text-2xs text-ink-faint">No members resolved for this workspace.</p>
              ) : (
                members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center gap-3 rounded-card border border-hairline bg-black/20 px-3 py-2.5"
                  >
                    <Avatar name={member.name} size="sm" variant="initials" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-2xs text-ink">{member.name}</p>
                      <p className="truncate text-[10px] text-ink-faint">{member.email}</p>
                    </div>
                    <Badge tone={member.role === "owner" ? "accent" : "neutral"}>{member.role}</Badge>
                    <span className="hidden text-[10px] text-ink-faint sm:block">
                      joined {formatRelative(member.joinedAt)}
                    </span>
                  </div>
                ))
              )}
              <p className="text-[10px] leading-relaxed text-ink-faint">
                Inviting colleagues requires a hosted deployment with real authentication; this build
                keeps a single local account.
              </p>
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title="Workspace isolation"
              description="How the data layer keeps tenants apart."
              icon={<Database className="size-3.5" aria-hidden />}
            />
            <CardBody>
              <dl>
                <DetailRow label="Isolation boundary">
                  <span className="text-2xs">
                    Every assistant, knowledge base, document, passage, provider key, conversation and
                    usage event carries a workspace identifier. Reads are checked against your
                    memberships before anything is returned.
                  </span>
                </DetailRow>
                <DetailRow label="Retrieval scope">
                  <span className="text-2xs">
                    A query only scans passages whose knowledge base is attached to the requesting
                    assistant, inside its own workspace. There is no cross-workspace index.
                  </span>
                </DetailRow>
                <DetailRow label="Widget scope">
                  <span className="text-2xs">
                    A public widget key resolves to exactly one assistant and cannot reach anything
                    else in the workspace.
                  </span>
                </DetailRow>
                <DetailRow label="Your workspaces" hint="Switch at any time from the top bar.">
                  <span className="flex flex-wrap gap-1.5">
                    {workspaces.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => selectWorkspace(entry.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-[10px] text-ink-mute transition-colors hover:border-accent/40 hover:text-ink-soft"
                      >
                        <StatusDot tone={entry.id === workspace?.id ? "accent" : "neutral"} />
                        {entry.name}
                      </button>
                    ))}
                  </span>
                </DetailRow>
              </dl>
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="appearance" active={tab === "appearance"}>
        <div className="grid gap-3 xl:grid-cols-[minmax(320px,420px)_1fr]">
          <Card>
            <CardHeader
              title="Fire theme"
              description="One configuration controls the bed, the interface accent and the cursor."
              icon={<Flame className="size-3.5" aria-hidden />}
            />
            <CardBody>
              <FireThemePanel />
            </CardBody>
          </Card>

          <div className="space-y-3">
            <Card>
              <CardHeader
                title="How the fire layer works"
                description="Why it never blocks the interface and never costs you frames."
              />
              <CardBody>
                <dl>
                  <DetailRow label="Composition" hint="A single fixed stage behind the interface.">
                    <span className="text-2xs">
                      A dark atmospheric gradient and soft charcoal haze sit behind a canvas of
                      clustered, softly lit dust particles. The stage is{" "}
                      <code className="font-mono">pointer-events: none</code>, so it can never
                      intercept a click.
                    </span>
                  </DetailRow>
                  <DetailRow label="Interaction">
                    <span className="text-2xs">
                      A shared pointer tracker reports position and velocity once for the whole app.
                      Nearby particles feel a distance-weighted repulsion, then spring back with
                      damping and a small amount of drift.
                    </span>
                  </DetailRow>
                  <DetailRow label="Performance budget">
                    <span className="text-2xs">
                      A capped canvas pixel ratio, spatially indexed interactions and pooled spark
                      particles keep the animation lightweight. Particle budgets scale with screen
                      area and device capability.
                    </span>
                  </DetailRow>
                  <DetailRow label="Accessibility">
                    <span className="text-2xs">
                      With <code className="font-mono">prefers-reduced-motion</code> particles remain
                      still. Touch devices keep the native cursor and use a reduced particle field.
                    </span>
                  </DetailRow>
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      </TabPanel>

      <TabPanel id="data" active={tab === "data"}>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Where your data lives"
              description="This build is honest about its boundaries."
              icon={<HardDrive className="size-3.5" aria-hidden />}
            />
            <CardBody className="space-y-3">
              <dl>
                <DetailRow label="Storage">
                  <span className="text-2xs">
                    Documents, passages and vectors are stored in this browser profile's local
                    storage. Vectors are quantised, so a passage costs about 0.5 KB instead of 8 KB.
                  </span>
                </DetailRow>
                <DetailRow label="Current usage">
                  <span className="text-2xs">
                    {formatBytes(storage.bytes)} of an approximate 5 MB browser quota
                    {storage.share > 0.7 ? " — consider deleting documents or sample data." : "."}
                  </span>
                </DetailRow>
                <DetailRow label="Never uploaded">
                  <span className="text-2xs">
                    Provider keys stay on this device. The only outbound requests are the ones you
                    trigger: provider calls for connected keys, and page fetches for URL ingestion.
                  </span>
                </DetailRow>
                <DetailRow label="Not included">
                  <span className="text-2xs">
                    No server-side authentication, no encryption at rest, no cross-device sync, and no
                    PDF or Office parsing. Those are server responsibilities and the API interface is
                    the seam where they attach.
                  </span>
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <div className="space-y-3">
            <Card>
              <CardHeader
                title="Sample data"
                description="Remove the generated history without touching your own content."
                icon={<Eraser className="size-3.5" aria-hidden />}
              />
              <CardBody className="space-y-3">
                <p className="text-2xs leading-relaxed text-ink-mute">
                  Sample records are always flagged, but you can delete them outright: every document,
                  passage, conversation and usage event in this workspace is removed. Assistants and
                  knowledge bases remain so you can add your own content.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setConfirmClear(true)}
                  iconLeft={<Eraser className="size-3.5" aria-hidden />}
                >
                  Remove sample documents and history
                </Button>
                {storageNote ? <p className="text-2xs text-success">{storageNote}</p> : null}
              </CardBody>
            </Card>

            <Card className="border-danger/25">
              <CardHeader
                title="Delete this workspace"
                description="Removes every assistant, document, passage and event permanently."
                icon={<AlertTriangle className="size-3.5 text-danger" aria-hidden />}
              />
              <CardBody className="space-y-3">
                <p className="text-2xs leading-relaxed text-ink-mute">
                  {assistants.length} assistants, {knowledgeBases.length} knowledge bases and{" "}
                  {formatNumber(activity.length)} activity entries will be deleted. This cannot be
                  undone.
                </p>
                <Button
                  variant="danger"
                  disabled={workspaces.length <= 1}
                  onClick={() => setConfirmDeleteWorkspace(true)}
                  iconLeft={<Trash2 className="size-3.5" aria-hidden />}
                >
                  Delete workspace
                </Button>
                {workspaces.length <= 1 ? (
                  <p className="text-[10px] text-ink-faint">
                    A workspace cannot be deleted while it is your only one.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </div>
        </div>
      </TabPanel>

      <TabPanel id="account" active={tab === "account"}>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader title="Account" description="The local identity attached to this browser profile." />
            <CardBody>
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={user?.name ?? "?"} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-micro text-ink">{user?.name}</p>
                  <p className="truncate text-2xs text-ink-faint">{user?.email}</p>
                </div>
                <Badge tone="accent" className="ms-auto">
                  {user?.role}
                </Badge>
              </div>
              <dl>
                <DetailRow label="User ID">
                  <code className="font-mono text-2xs text-ink-mute">{user?.id}</code>
                </DetailRow>
                <DetailRow label="Member since">
                  <span className="text-2xs">
                    {user ? new Date(user.createdAt).toLocaleDateString("en-US", { dateStyle: "long" }) : "—"}
                  </span>
                </DetailRow>
                <DetailRow label="Password" hint="Hashed with SHA-256 and a per-account salt before storage.">
                  <span className="text-2xs">Stored locally, never transmitted</span>
                </DetailRow>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  iconLeft={<LogOut className="size-3.5" aria-hidden />}
                  onClick={() => void signOut()}
                >
                  Sign out
                </Button>
                <Button variant="ghost" onClick={() => navigate("/assistants")}>
                  Back to assistants
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Keyboard and access" description="Everything is reachable without a mouse." />
            <CardBody>
              <dl>
                <DetailRow label="Command palette">
                  <span className="text-2xs">⌘K or Ctrl+K from anywhere</span>
                </DetailRow>
                <DetailRow label="Tab navigation">
                  <span className="text-2xs">
                    Arrow keys move between configuration tabs; Escape closes dialogs and panels.
                  </span>
                </DetailRow>
                <DetailRow label="Playground shortcut">
                  <span className="text-2xs">
                    Enter sends a question, Shift+Enter adds a line break.
                  </span>
                </DetailRow>
                <DetailRow label="Contrast">
                  <span className="text-2xs">
                    Interface text targets at least 4.5:1 against its surface; the fire layer never sits
                    behind text.
                  </span>
                </DetailRow>
              </dl>
              {activity.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    compact
                    title="No activity recorded"
                    description="Actions you take in this workspace will be listed here and in the dashboard feed."
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Remove sample documents and history?"
        description="Every document, passage, conversation and recorded event in this workspace is deleted. Assistants and knowledge bases stay."
        confirmLabel="Remove sample data"
        onConfirm={async () => {
          await clearSampleData();
          setConfirmClear(false);
          setStorageNote("Sample data removed.");
        }}
      />

      <ConfirmDialog
        open={confirmDeleteWorkspace}
        onClose={() => setConfirmDeleteWorkspace(false)}
        title={`Delete “${workspace?.name}”?`}
        description="Every record in this workspace is permanently removed, including provider keys stored for it."
        confirmLabel="Delete workspace"
        onConfirm={async () => {
          if (!workspace) return;
          const target = workspace;
          setConfirmDeleteWorkspace(false);
          await removeWorkspace(target.id);
          navigate("/dashboard");
        }}
      />
    </>
  );
}
