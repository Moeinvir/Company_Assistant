import {
  BarChart3,
  Blocks,
  Bot,
  FlaskConical,
  Library,
  LayoutDashboard,
  PlugZap,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: string;
  description: string;
  /** Extra terms used by the command palette's fuzzy match. */
  keywords?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    group: "Overview",
    description: "Platform health, usage and ingestion status",
    keywords: "home metrics status overview",
  },
  {
    to: "/assistants",
    label: "Assistants",
    icon: Bot,
    group: "Build",
    description: "Create assistants and configure model, prompt and RAG",
    keywords: "agents bots models prompt",
  },
  {
    to: "/knowledge",
    label: "Knowledge",
    icon: Library,
    group: "Build",
    description: "Documents, sources and the ingestion pipeline",
    keywords: "documents upload urls embeddings index",
  },
  {
    to: "/playground",
    label: "Playground",
    icon: FlaskConical,
    group: "Build",
    description: "Test chat RAG and semantic search against your knowledge",
    keywords: "test rag search retrieve chunks debug lab",
  },
  {
    to: "/widget-builder",
    label: "Widget Builder",
    icon: Blocks,
    group: "Ship",
    description: "Design the embeddable chat widget and copy its snippet",
    keywords: "embed snippet iframe launcher branding",
  },
  {
    to: "/integrations",
    label: "API & Integrations",
    icon: PlugZap,
    group: "Ship",
    description: "Provider keys, models and public widget access",
    keywords: "openai anthropic google ollama keys providers api",
  },
  {
    to: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    group: "Measure",
    description: "Query volume, latency, retrieval quality and cost",
    keywords: "usage metrics latency tokens charts",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    group: "Measure",
    description: "Workspace, members, appearance and data",
    keywords: "workspace members theme fire appearance account",
  },
];

export const NAV_GROUPS = ["Overview", "Build", "Ship", "Measure"];

export function navItemForPath(pathname: string) {
  return NAV_ITEMS.find(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}
