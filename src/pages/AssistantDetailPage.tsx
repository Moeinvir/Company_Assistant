import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Blocks,
  Bot,
  Braces,
  Cpu,
  Database,
  Library,
  Palette,
  Play,
  Sliders,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  StatusDot,
  TabBar,
  TabPanel,
  type TabDefinition,
  type Tone,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { GeneralTab } from "@/features/assistant/GeneralTab";
import { ModelTab, PromptTab } from "@/features/assistant/ModelPromptTabs";
import { KnowledgeTab, RagTab } from "@/features/assistant/RetrievalTabs";
import { AppearanceTab, WidgetTab } from "@/features/assistant/ExperienceTabs";
import { TestingTab } from "@/features/assistant/TestingTab";
import { useWorkspaceData } from "@/store/workspaceData";
import { useSession } from "@/store/session";
import { providerLabel } from "@/lib/api/providers";
import { formatRelative } from "@/lib/format";
import type { AssistantStatus } from "@/lib/api/types";

const STATUS_TONE: Record<AssistantStatus, Tone> = {
  active: "success",
  draft: "neutral",
  paused: "warn",
  error: "danger",
};

type TabId =
  | "general"
  | "model"
  | "prompt"
  | "rag"
  | "knowledge"
  | "appearance"
  | "widget"
  | "testing";

export default function AssistantDetailPage() {
  const { assistantId } = useParams<{ assistantId: string }>();
  const navigate = useNavigate();
  const { loading, assistantById, knowledgeBases, documentsByKb, loadDocuments, updateAssistant, deleteAssistant, duplicateAssistant } =
    useWorkspaceData();
  const { credentials } = useSession();
  const [tab, setTab] = useState<TabId>("general");

  const assistant = assistantId ? assistantById(assistantId) : undefined;

  // Register every knowledge base so the knowledge tab can show document state.
  useEffect(() => {
    for (const knowledgeBase of knowledgeBases) {
      if (!documentsByKb[knowledgeBase.id]) void loadDocuments(knowledgeBase.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBases]);

  if (!assistant) {
    return loading ? (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    ) : (
      <EmptyState
        icon={<Bot className="size-4" aria-hidden />}
        title="Assistant not found"
        description="It may have been deleted, or it belongs to a different workspace."
        action={
          <Button size="sm" variant="primary" onClick={() => navigate("/assistants")}>
            Back to assistants
          </Button>
        }
      />
    );
  }

  const tabs: TabDefinition<TabId>[] = [
    { id: "general", label: "General", icon: <Bot className="size-3.5" aria-hidden /> },
    { id: "model", label: "Model", icon: <Cpu className="size-3.5" aria-hidden /> },
    { id: "prompt", label: "System prompt", icon: <Braces className="size-3.5" aria-hidden /> },
    { id: "rag", label: "RAG", icon: <Sliders className="size-3.5" aria-hidden /> },
    {
      id: "knowledge",
      label: "Knowledge",
      icon: <Database className="size-3.5" aria-hidden />,
      count: assistant.knowledgeBaseIds.length,
    },
    { id: "appearance", label: "Appearance", icon: <Palette className="size-3.5" aria-hidden /> },
    { id: "widget", label: "Widget", icon: <Blocks className="size-3.5" aria-hidden /> },
    { id: "testing", label: "Testing", icon: <Play className="size-3.5" aria-hidden /> },
  ];

  const save = (patch: Parameters<typeof updateAssistant>[1]) =>
    updateAssistant(assistant.id, patch);

  const passages = knowledgeBases
    .filter((knowledgeBase) => assistant.knowledgeBaseIds.includes(knowledgeBase.id))
    .reduce((sum, knowledgeBase) => sum + knowledgeBase.chunkCount, 0);

  const providerKeyState = (() => {
    if (assistant.model.provider === "ollama") return { tone: "info" as Tone, label: "Local runtime" };
    return credentials[assistant.model.provider]?.apiKey
      ? { tone: "success" as Tone, label: "Key stored on this device" }
      : { tone: "warn" as Tone, label: "No key — extractive answers only" };
  })();

  return (
    <>
      <PageHeader
        title={assistant.name}
        description={assistant.description || "No description yet."}
        crumbs={[{ label: "Assistants", to: "/assistants" }, { label: assistant.name }]}
        meta={
          <>
            <Badge tone={STATUS_TONE[assistant.status]} icon={<StatusDot tone={STATUS_TONE[assistant.status]} pulse={assistant.status === "active"} />}>
              {assistant.status}
            </Badge>
            <Badge tone="neutral">
              {providerLabel(assistant.model.provider)} · {assistant.model.model}
            </Badge>
            <Badge tone={providerKeyState.tone}>{providerKeyState.label}</Badge>
            <Badge tone="neutral">{passages.toLocaleString()} passages</Badge>
            {assistant.stats.lastActivityAt ? (
              <span className="text-2xs text-ink-faint">
                last activity {formatRelative(assistant.stats.lastActivityAt)}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              iconLeft={<Play className="size-3.5" aria-hidden />}
              onClick={() => setTab("testing")}
            >
              Test
            </Button>
            <Button
              variant="secondary"
              iconLeft={<Blocks className="size-3.5" aria-hidden />}
              onClick={() => navigate(`/widget-builder/${assistant.id}`)}
            >
              Widget builder
            </Button>
          </>
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      <TabPanel id="general" active={tab === "general"}>
        <GeneralTab
          assistant={assistant}
          onSave={save}
          onDelete={() => deleteAssistant(assistant.id)}
          onDuplicate={() => duplicateAssistant(assistant.id)}
        />
      </TabPanel>
      <TabPanel id="model" active={tab === "model"}>
        <ModelTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="prompt" active={tab === "prompt"}>
        <PromptTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="rag" active={tab === "rag"}>
        <RagTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="knowledge" active={tab === "knowledge"}>
        <KnowledgeTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="appearance" active={tab === "appearance"}>
        <AppearanceTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="widget" active={tab === "widget"}>
        <WidgetTab assistant={assistant} onSave={save} />
      </TabPanel>
      <TabPanel id="testing" active={tab === "testing"}>
        <TestingTab assistant={assistant} />
      </TabPanel>

      <Card className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <Library className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        <p className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-mute">
          Documents live in knowledge bases, not in assistants. Editing a document re-indexes it for
          every assistant attached to that base.
        </p>
        <Link to="/knowledge" className="text-2xs font-medium text-accent hover:text-accent-strong">
          Knowledge centre →
        </Link>
      </Card>
    </>
  );
}
