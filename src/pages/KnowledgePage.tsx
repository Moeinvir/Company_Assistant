import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowDownWideNarrow,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cpu,
  Database,
  FilePlus2,
  FileStack,
  FileText,
  Globe,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Slider,
  Table,
  TD,
  TH,
  TR,
  Textarea,
} from "@/components/ui";
import { isProcessing } from "@/features/knowledge/status";
import { useWorkspaceData } from "@/store/workspaceData";
import { DEFAULT_TONE, TONES, type AssistantTone } from "@/lib/rag/tone";
import { htmlToText } from "@/lib/rag/html";
import { useLanguage } from "@/store/language";
import type {
  Assistant,
  DocumentRecord,
  DocumentStatus,
  EmbeddingConfig,
} from "@/lib/api/types";
import type { FilePayload } from "@/lib/api/client";

type AddMode = "file" | "url" | "text" | null;
type StatusFilter = "all" | "processing" | "indexed" | "failed";
type SortMode = "updated" | "name" | "size" | "chunks";

const FA_NUMBER = new Intl.NumberFormat("fa-IR");
const TONE_NAMES: Record<AssistantTone, string> = {
  professional: "حرفه‌ای",
  friendly: "صمیمی",
  formal: "رسمی",
  casual: "محاوره‌ای",
  concise: "کوتاه و مستقیم",
  empathetic: "همدلانه",
};

const PIPELINE: { id: DocumentStatus; label: string }[] = [
  { id: "uploading", label: "بارگذاری" },
  { id: "processing", label: "استخراج متن" },
  { id: "chunking", label: "قطعه‌بندی" },
  { id: "embedding", label: "Embedding" },
  { id: "indexing", label: "ایندکس" },
  { id: "indexed", label: "تکمیل" },
];

function faNumber(value: number, isPersian = document.documentElement.lang === "fa") {
  return (isPersian ? FA_NUMBER : new Intl.NumberFormat("en-US")).format(value);
}

function fileSize(bytes: number, isPersian: boolean) {
  if (bytes < 1024) return `${faNumber(bytes, isPersian)} ${isPersian ? "بایت" : "bytes"}`;
  const units = isPersian ? ["کیلوبایت", "مگابایت", "گیگابایت"] : ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(isPersian ? "fa-IR" : "en-US", { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}

function updatedLabel(value: string, isPersian: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return isPersian ? "همین حالا" : "Just now";
  if (elapsed < 3_600_000) return `${faNumber(Math.floor(elapsed / 60_000), isPersian)} ${isPersian ? "دقیقه پیش" : "minutes ago"}`;
  if (elapsed < 86_400_000) return `${faNumber(Math.floor(elapsed / 3_600_000), isPersian)} ${isPersian ? "ساعت پیش" : "hours ago"}`;
  return new Intl.DateTimeFormat(isPersian ? "fa-IR-u-ca-persian" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function documentType(document: DocumentRecord, isPersian = globalThis.document.documentElement.lang === "fa") {
  if (document.source === "url") return "URL";
  if (document.source === "text") return isPersian ? "متن خام" : "Plain text";
  const extension = document.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf" || document.mimeType === "application/pdf") return "PDF";
  if (extension === "docx") return "DOCX";
  if (extension === "txt" || document.mimeType.startsWith("text/")) return "TXT";
  return extension ? extension.toUpperCase() : isPersian ? "فایل" : "File";
}

function currentStage(status: DocumentStatus): number {
  if (status === "failed") return -1;
  if (status === "queued") return 0;
  return PIPELINE.findIndex((stage) => stage.id === status);
}

function stageLabel(status: DocumentStatus) {
  if (status === "queued") return "در صف";
  if (status === "processing") return "استخراج متن";
  if (status === "chunking") return "قطعه‌بندی";
  if (status === "embedding") return "Embedding";
  if (status === "indexing") return "ایندکس";
  if (status === "indexed") return "تکمیل شده";
  if (status === "failed") return "ناموفق";
  return "در حال بارگذاری";
}

function sourceIcon(source: DocumentRecord["source"]) {
  if (source === "url") return Globe;
  if (source === "text") return FileText;
  return FileStack;
}

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "yaml", "yml", "log", "html", "htm"]);

/** Decode bytes as UTF-8, falling back to Windows-1256 (legacy Persian/Arabic .txt files). */
function decodeText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

async function extractFileText(file: File, onProgress: (progress: number) => void) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("حجم فایل بیشتر از ۳۰ مگابایت است.");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf" || file.type === "application/pdf") {
    const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    GlobalWorkerOptions.workerSrc = worker.default;
    const loadingTask = getDocument({ data: await file.arrayBuffer() });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        let text = "";
        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          // Keep the PDF's own line breaks so paragraphs survive chunking.
          text += item.str + (item.hasEOL ? "\n" : " ");
        }
        pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
        page.cleanup();
        onProgress(pageNumber / pdf.numPages);
      }
    } finally {
      await loadingTask.destroy();
    }
    return pages.filter(Boolean).join("\n\n").trim();
  }

  if (extension === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    onProgress(0.6);
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    onProgress(1);
    return result.value.trim();
  }

  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith("text/") || file.type === "application/json") {
    onProgress(0.7);
    const text = decodeText(await file.arrayBuffer());
    onProgress(1);
    return (extension === "html" || extension === "htm" ? htmlToText(text) : text).trim();
  }

  throw new Error("فقط فایل‌های PDF، DOCX، TXT و فایل‌های متنی (MD، CSV، JSON، HTML) پشتیبانی می‌شوند.");
}

export default function KnowledgePage() {
  const { isPersian, translate } = useLanguage();
  const { knowledgeBaseId } = useParams<{ knowledgeBaseId: string }>();
  const navigate = useNavigate();
  const {
    knowledgeBases,
    documentsByKb,
    loading,
    error,
    assistants,
    loadDocuments,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    addFileDocument,
    addUrlDocument,
    addTextDocument,
    updateDocument,
    documentContent,
    deleteDocument,
    deleteAllDocuments,
    reindexKnowledgeBase,
    updateAssistant,
    refresh,
  } = useWorkspaceData();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [creatingKb, setCreatingKb] = useState(false);
  const [renamingKb, setRenamingKb] = useState(false);
  const [kbName, setKbName] = useState("");
  const [kbDescription, setKbDescription] = useState("");
  const [editing, setEditing] = useState<DocumentRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentRecord | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteBase, setConfirmDeleteBase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answerAssistantId, setAnswerAssistantId] = useState("");
  const [draftTone, setDraftTone] = useState<AssistantTone>(DEFAULT_TONE);
  const [draftTemperature, setDraftTemperature] = useState(0.2);
  const [savingAnswerStyle, setSavingAnswerStyle] = useState(false);
  const [answerStyleMessage, setAnswerStyleMessage] = useState("");

  const selected = useMemo(
    () => knowledgeBases.find((entry) => entry.id === knowledgeBaseId) ?? knowledgeBases[0],
    [knowledgeBases, knowledgeBaseId],
  );
  const documents = selected ? (documentsByKb[selected.id] ?? []) : [];

  useEffect(() => {
    if (selected && !documentsByKb[selected.id]) void loadDocuments(selected.id);
  }, [selected?.id, documentsByKb, loadDocuments, selected]);

  useEffect(() => {
    if (selected && knowledgeBaseId !== selected.id) {
      navigate(`/knowledge/${selected.id}`, { replace: true });
    }
  }, [knowledgeBaseId, navigate, selected]);

  useEffect(() => {
    setSelectedIds([]);
  }, [selected?.id]);

  const liveDocuments = documents.filter((document) => isProcessing(document.status));
  useEffect(() => {
    if (!selected || liveDocuments.length === 0) return;
    const timer = window.setInterval(() => void loadDocuments(selected.id).catch(() => undefined), 900);
    return () => window.clearInterval(timer);
  }, [liveDocuments.length, loadDocuments, selected?.id]);

  const attachedAssistants = useMemo(
    () =>
      assistants.filter((assistant) =>
        selected ? assistant.knowledgeBaseIds.includes(selected.id) : false,
      ),
    [assistants, selected],
  );
  const answerAssistant =
    attachedAssistants.find((assistant) => assistant.id === answerAssistantId) ??
    attachedAssistants[0];
  const embeddingFor = useMemo<EmbeddingConfig>(
    () =>
      answerAssistant?.embedding ?? {
        provider: "local",
        model: "pyre-hash-384",
        dimensions: 384,
        chunkSize: 900,
        chunkOverlap: 150,
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(answerAssistant?.embedding)],
  );

  useEffect(() => {
    if (!attachedAssistants.some((assistant) => assistant.id === answerAssistantId)) {
      setAnswerAssistantId(attachedAssistants[0]?.id ?? "");
    }
  }, [answerAssistantId, attachedAssistants]);

  useEffect(() => {
    setDraftTone(answerAssistant?.tone ?? DEFAULT_TONE);
    setDraftTemperature(answerAssistant?.model.temperature ?? 0.2);
    // Keyed by value so a background refresh does not discard edits in progress.
  }, [answerAssistant?.id, answerAssistant?.tone, answerAssistant?.model.temperature]);

  useEffect(() => {
    setAnswerStyleMessage("");
  }, [answerAssistant?.id]);

  const stats = useMemo(
    () => ({
      chunks: documents.reduce((sum, document) => sum + document.chunkCount, 0),
      completed: documents.filter((document) => document.status === "indexed").length,
      processing: documents.filter((document) => isProcessing(document.status)).length,
      failed: documents.filter((document) => document.status === "failed").length,
    }),
    [documents],
  );

  const visibleDocuments = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("fa");
    const result = documents.filter((document) => {
      const matchesQuery =
        !term ||
        document.name.toLocaleLowerCase("fa").includes(term) ||
        document.sourceUrl?.toLocaleLowerCase("fa").includes(term);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "processing" && isProcessing(document.status)) ||
        document.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
    return result.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "fa");
      if (sortMode === "size") return b.sizeBytes - a.sizeBytes;
      if (sortMode === "chunks") return b.chunkCount - a.chunkCount;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [documents, query, sortMode, statusFilter]);

  const selectedDocuments = documents.filter((document) => selectedIds.includes(document.id));
  const allVisibleSelected =
    visibleDocuments.length > 0 &&
    visibleDocuments.every((document) => selectedIds.includes(document.id));

  const toggleDocument = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  };

  const toggleVisible = () => {
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleDocuments.some((document) => document.id === id))
        : [...new Set([...current, ...visibleDocuments.map((document) => document.id)])],
    );
  };

  const handleCreateKnowledgeBase = async () => {
    setBusy(true);
    try {
      const created = await createKnowledgeBase({
        name: kbName.trim(),
        description: kbDescription.trim(),
      });
      setKbName("");
      setKbDescription("");
      setCreatingKb(false);
      navigate(`/knowledge/${created.id}`);
    } catch {
      /* the failure toast was already shown; keep the dialog open */
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAnswerStyle = async () => {
    if (!answerAssistant) return;
    setSavingAnswerStyle(true);
    setAnswerStyleMessage("");
    try {
      await updateAssistant(answerAssistant.id, {
        model: { ...answerAssistant.model, temperature: draftTemperature },
        tone: draftTone,
      });
      setAnswerStyleMessage("تنظیمات پاسخ ذخیره شد.");
    } catch (caught) {
      setAnswerStyleMessage((caught as Error).message);
    } finally {
      setSavingAnswerStyle(false);
    }
  };

  if (loading && knowledgeBases.length === 0) {
    return (
      <div dir={isPersian ? "rtl" : "ltr"} lang={isPersian ? "fa" : "en"} className="space-y-4">
        <Skeleton className="h-52 rounded-3xl" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!loading && knowledgeBases.length === 0) {
    return (
      <main dir={isPersian ? "rtl" : "ltr"} lang={isPersian ? "fa" : "en"} className="space-y-6">
        <Hero
          name={translate("Knowledge Center")}
          subtitle={translate("Import your knowledge sources to make assistant answers accurate, grounded and traceable.")}
          onAdd={() => setCreatingKb(true)}
          addLabel={translate("Create knowledge base")}
        />
        <Card className="relative overflow-hidden border-accent/15 bg-surface/90 p-7 sm:p-10">
          <div className="pointer-events-none absolute -left-16 -top-20 size-64 rounded-full bg-accent/[0.08] blur-3xl" />
          <EmptyState
            icon={<BookOpen className="size-5" aria-hidden />}
            title={translate("No knowledge base yet")}
            description={translate("Add PDF, DOCX and TXT files, web pages or raw text to your knowledge base.")}
            action={
              <Button variant="primary" iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreatingKb(true)}>
                {translate("Create your first knowledge base")}
              </Button>
            }
          />
        </Card>
        <KnowledgeBaseModal
          open={creatingKb}
          title={translate("ساخت پایگاه دانش")}
          name={kbName}
          description={kbDescription}
          busy={busy}
          onClose={() => setCreatingKb(false)}
          onName={setKbName}
          onDescription={setKbDescription}
          onSubmit={handleCreateKnowledgeBase}
        />
      </main>
    );
  }

  return (
    <main
      dir={isPersian ? "rtl" : "ltr"}
      lang={isPersian ? "fa" : "en"}
      className="space-y-5 rounded-[26px] bg-[linear-gradient(180deg,rgba(8,8,11,0.26),rgba(8,8,11,0.58))] pb-8"
    >
      <Hero
        name={selected?.name ?? translate("Knowledge Center")}
        subtitle={selected?.description || translate("Manage your knowledge sources and see every stage of answer preparation.")}
        onAdd={() => setAddMode("file")}
        addLabel={translate("Add knowledge")}
      >
        {knowledgeBases.length > 1 ? (
          <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-ink-soft">
            <Database className="size-3.5 text-accent" aria-hidden />
            <span>{translate("پایگاه")}</span>
            <select
              aria-label={translate("انتخاب پایگاه دانش")}
              className="max-w-44 bg-transparent text-ink outline-none"
              value={selected?.id ?? ""}
              onChange={(event) => navigate(`/knowledge/${event.target.value}`)}
            >
              {knowledgeBases.map((base) => (
                <option key={base.id} value={base.id} className="bg-surface">
                  {base.name}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3 text-ink-faint" aria-hidden />
          </label>
        ) : null}
        <Button variant="outline" iconLeft={<Plus className="size-3.5" aria-hidden />} onClick={() => setCreatingKb(true)}>
          {translate("پایگاه جدید")}
        </Button>
      </Hero>

      {selected ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<FileStack className="size-4" aria-hidden />}
              label={translate("سندها")}
              value={faNumber(documents.length, isPersian)}
              hint={`${faNumber(stats.completed, isPersian)} ${translate("سند آماده جست‌وجو")}`}
            />
            <MetricCard
              icon={<Layers3 className="size-4" aria-hidden />}
              label={translate("قطعه‌های ایندکس‌شده")}
              value={faNumber(stats.chunks, isPersian)}
              hint={translate("واحدهای قابل بازیابی")}
              accent
            />
            <MetricCard
              icon={<RefreshCw className="size-4" aria-hidden />}
              label={translate("در حال پردازش")}
              value={faNumber(stats.processing, isPersian)}
              hint={translate(stats.processing ? "به‌روزرسانی زنده" : "همه‌چیز آرام است")}
            />
            <MetricCard
              icon={<AlertCircle className="size-4" aria-hidden />}
              label={translate("نیازمند بررسی")}
              value={faNumber(stats.failed, isPersian)}
              hint={translate(stats.failed ? "سندهای ناموفق" : "خطایی وجود ندارد")}
              danger={stats.failed > 0}
            />
          </div>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <Card className="min-w-0 overflow-hidden border-white/[0.07] bg-surface/90">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">{translate("اسناد پایگاه")}</h2>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-ink-mute">
                      {faNumber(documents.length, isPersian)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                    {translate("مسیر هر سند را از استخراج متن تا آماده‌شدن برای دستیار دنبال کنید.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<RefreshCw className="size-3.5" aria-hidden />}
                    onClick={() => {
                      void refresh();
                      void loadDocuments(selected.id);
                    }}
                  >
                    {translate("تازه‌سازی")}
                  </Button>
                  <Button size="sm" variant="primary" iconLeft={<FilePlus2 className="size-3.5" aria-hidden />} onClick={() => setAddMode("file")}>
                    {translate("افزودن منبع")}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-white/[0.05] px-4 py-3 sm:px-5">
                <SourceShortcut icon={<FileText className="size-3.5" />} label={translate("PDF، DOCX یا TXT")} onClick={() => setAddMode("file")} />
                <SourceShortcut icon={<Globe className="size-3.5" />} label={translate("نشانی وب")} onClick={() => setAddMode("url")} />
                <SourceShortcut icon={<FilePlus2 className="size-3.5" />} label={translate("متن خام")} onClick={() => setAddMode("text")} />
              </div>

              <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
                <div className="relative min-w-[190px] flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={translate("جست‌وجوی نام سند یا نشانی…")}
                    className="pr-9"
                    aria-label={translate("جست‌وجو در اسناد")}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label={translate("پاک‌کردن جست‌وجو")}
                      onClick={() => setQuery("")}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <label className="relative">
                  <SlidersHorizontal className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
                  <select
                    aria-label={translate("فیلتر وضعیت اسناد")}
                    className="control h-9.5 min-w-36 appearance-none pr-8 pl-3 text-xs"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  >
                    <option value="all">{translate("همه وضعیت‌ها")}</option>
                    <option value="processing">{translate("در حال پردازش")}</option>
                    <option value="indexed">{translate("تکمیل‌شده")}</option>
                    <option value="failed">{translate("ناموفق")}</option>
                  </select>
                </label>
                <label className="relative">
                  <ArrowDownWideNarrow className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
                  <select
                    aria-label={translate("مرتب‌سازی اسناد")}
                    className="control h-9.5 min-w-36 appearance-none pr-8 pl-3 text-xs"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as SortMode)}
                  >
                    <option value="updated">{translate("آخرین به‌روزرسانی")}</option>
                    <option value="name">{translate("نام سند")}</option>
                    <option value="size">{translate("حجم فایل")}</option>
                    <option value="chunks">{translate("تعداد قطعه")}</option>
                  </select>
                </label>
              </div>

              {selectedIds.length > 0 ? (
                <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/[0.055] px-3 py-2 sm:mx-5">
                  <span className="text-xs text-ink-soft">
                    {faNumber(selectedIds.length, isPersian)} {translate("سند انتخاب شده")}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                      {translate("لغو انتخاب")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      iconLeft={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setConfirmBulkDelete(true)}
                    >
                      {translate("حذف انتخاب‌شده‌ها")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="mx-4 mb-4 rounded-xl border border-danger/20 bg-danger/[0.06] p-4 sm:mx-5">
                  <p className="text-xs text-danger">{translate(error)}</p>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => void refresh()}>
                    {translate("تلاش دوباره")}
                  </Button>
                </div>
              ) : visibleDocuments.length === 0 ? (
                <div className="px-4 pb-5 sm:px-5">
                  <DocumentsEmpty
                    filtered={documents.length > 0}
                    onClear={() => {
                      setQuery("");
                      setStatusFilter("all");
                    }}
                    onAdd={() => setAddMode("file")}
                    onPaste={() => setAddMode("text")}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <thead>
                      <tr>
                        <TH className="w-10">
                          <input
                            type="checkbox"
                            aria-label={translate("انتخاب همه اسناد نمایش‌داده‌شده")}
                            checked={allVisibleSelected}
                            onChange={toggleVisible}
                            className="size-3.5 accent-[var(--accent)]"
                          />
                        </TH>
                        <TH>{translate("سند")}</TH>
                        <TH>{translate("نوع")}</TH>
                        <TH className="text-left">{translate("حجم")}</TH>
                        <TH className="text-left">{translate("قطعه‌ها")}</TH>
                        <TH>{translate("وضعیت ایندکس")}</TH>
                        <TH>{translate("آخرین تغییر")}</TH>
                        <TH className="w-14">{translate("عملیات")}</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocuments.map((document) => (
                        <TR key={document.id} className="group">
                          <TD>
                            <input
                              type="checkbox"
                              aria-label={`${translate("انتخاب")} ${document.name}`}
                              checked={selectedIds.includes(document.id)}
                              onChange={() => toggleDocument(document.id)}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                          </TD>
                          <TD>
                            <DocumentName document={document} />
                            {isProcessing(document.status) ? (
                              <div className="mt-2 max-w-48">
                                <ProgressExperience status={document.status} progress={document.progress} compact />
                              </div>
                            ) : null}
                            {document.status === "failed" && document.error ? (
                              <p className="mt-1 max-w-52 truncate text-[10px] text-danger" title={document.error}>
                                {translate(document.error)}
                              </p>
                            ) : null}
                          </TD>
                          <TD>
                            <span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1 font-mono text-[10px] text-ink-mute">
                              {translate(documentType(document, isPersian))}
                            </span>
                          </TD>
                          <TD className="text-left font-mono text-[11px] tabular-nums text-ink-mute" dir="ltr">
                            {fileSize(document.sizeBytes, isPersian)}
                          </TD>
                          <TD className="text-left font-mono text-[11px] tabular-nums text-ink-soft" dir="ltr">
                            {faNumber(document.chunkCount, isPersian)}
                          </TD>
                          <TD>
                            <div className="flex flex-col items-start gap-1.5">
                              <PersianStatusBadge status={document.status} />
                              <span className="text-[10px] text-ink-faint">{translate(stageLabel(document.status))}</span>
                            </div>
                          </TD>
                          <TD className="whitespace-nowrap text-[11px] text-ink-mute">
                            {updatedLabel(document.updatedAt, isPersian)}
                          </TD>
                          <TD>
                            <DocumentActions
                              onEdit={() => setEditing(document)}
                              onDelete={() => setPendingDelete(document)}
                            />
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              {documents.length > 0 ? (
                <div className="border-t border-white/[0.05] px-4 py-3 text-[10px] text-ink-faint sm:px-5">
                  {translate("نمایش")} {faNumber(visibleDocuments.length, isPersian)} {translate("از")} {faNumber(documents.length, isPersian)} {translate("سند")}
                </div>
              ) : null}
            </Card>

            <aside className="space-y-4">
              <Card className="overflow-hidden border-white/[0.07] bg-surface/90">
                <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-accent">{translate("وضعیت پایگاه")}</p>
                    <h2 className="mt-1.5 text-sm font-semibold text-ink">{translate("تنظیمات ایندکس")}</h2>
                  </div>
                  <IconButton
                    label={translate("نام‌گذاری دوباره پایگاه")}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setKbName(selected.name);
                      setKbDescription(selected.description);
                      setRenamingKb(true);
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </IconButton>
                </div>
                <div className="space-y-4 p-4">
                  <StatusSummary processing={stats.processing} failed={stats.failed} />
                  <InfoRow icon={<Cpu className="size-3.5" />} label={translate("مدل Embedding")} value={embeddingFor.model} />
                  <InfoRow
                    icon={<Layers3 className="size-3.5" />}
                    label={translate("اندازه قطعه")}
                    value={`${faNumber(embeddingFor.chunkSize, isPersian)} ${translate("نویسه")} · ${translate("هم‌پوشانی")} ${faNumber(embeddingFor.chunkOverlap, isPersian)}`}
                  />
                  <InfoRow icon={<Database className="size-3.5" />} label={translate("ارائه‌دهنده")} value={embeddingFor.provider} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    iconLeft={<RefreshCw className="size-3.5" aria-hidden />}
                    onClick={() => void reindexKnowledgeBase(selected.id, embeddingFor)}
                  >
                    {translate("ایندکس دوباره")}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAll(true)}
                    disabled={documents.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-danger/15 px-3 py-2 text-[11px] text-danger/80 transition-colors hover:bg-danger/[0.06] disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {translate("حذف همه اسناد")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteBase(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 text-[10px] text-ink-faint transition-colors hover:border-danger/20 hover:text-danger"
                  >
                    {translate("حذف پایگاه دانش")}
                  </button>
                </div>
              </Card>

              <AnswerStyleCard
                assistants={attachedAssistants}
                assistant={answerAssistant}
                assistantId={answerAssistant?.id ?? ""}
                temperature={draftTemperature}
                tone={draftTone}
                message={answerStyleMessage}
                saving={savingAnswerStyle}
                onAssistant={(id) => setAnswerAssistantId(id)}
                onTemperature={setDraftTemperature}
                onTone={setDraftTone}
                onSave={() => void handleSaveAnswerStyle()}
              />
              <div className="rounded-xl border border-accent/10 bg-accent/[0.025] p-3.5">
                <p className="flex items-center gap-2 text-[11px] font-medium text-ink-soft">
                  <Sparkles className="size-3.5 text-accent" aria-hidden />
                  {translate("جریان دانش شما")}
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                  {translate("ابتدا متن استخراج می‌شود، سپس برای قطعه‌ها Embedding ساخته و ایندکس می‌شود. تا پایان پردازش، سند در پاسخ‌های دستیار استفاده نمی‌شود.")}
                </p>
              </div>
            </aside>
          </section>
        </>
      ) : null}

      <KnowledgeBaseModal
        open={creatingKb || renamingKb}
        title={translate(renamingKb ? "ویرایش پایگاه دانش" : "ساخت پایگاه دانش")}
        name={kbName}
        description={kbDescription}
        busy={busy}
        onClose={() => {
          setCreatingKb(false);
          setRenamingKb(false);
        }}
        onName={setKbName}
        onDescription={setKbDescription}
        onSubmit={async () => {
          if (renamingKb && selected) {
            setBusy(true);
            try {
              await updateKnowledgeBase(selected.id, {
                name: kbName.trim(),
                description: kbDescription.trim(),
              });
              setRenamingKb(false);
            } catch {
              /* failure already reported */
            } finally {
              setBusy(false);
            }
            return;
          }
          await handleCreateKnowledgeBase();
        }}
      />

      {selected ? (
        <AddDocumentDialog
          mode={addMode}
          documents={documents}
          embedding={embeddingFor}
          onClose={() => setAddMode(null)}
          onAddFile={(file) => addFileDocument(selected.id, { file, embedding: embeddingFor })}
          onAddUrl={(url) => addUrlDocument(selected.id, { url, embedding: embeddingFor })}
          onAddText={(name, content) =>
            addTextDocument(selected.id, { name, content, embedding: embeddingFor })
          }
        />
      ) : null}

      <EditDocumentModal
        document={editing}
        onClose={() => setEditing(null)}
        loadContent={documentContent}
        onSave={async (id, patch) => {
          // Only re-index when the text actually changed; a rename is cheap.
          await updateDocument(id, {
            ...patch,
            ...(patch.content !== undefined ? { embedding: embeddingFor } : {}),
          });
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={isPersian ? `حذف «${pendingDelete?.name ?? ""}»؟` : `Delete "${pendingDelete?.name ?? ""}"?`}
        description={translate("با حذف سند، تمام قطعه‌ها و بردارهای آن نیز پاک می‌شوند و دیگر در پاسخ‌ها بازیابی نخواهد شد.")}
        confirmLabel={translate("حذف سند")}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteDocument(pendingDelete.id);
          setSelectedIds((ids) => ids.filter((id) => id !== pendingDelete.id));
          setPendingDelete(null);
        }}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        title={isPersian ? `حذف ${faNumber(selectedDocuments.length, isPersian)} سند انتخاب‌شده؟` : `Delete ${faNumber(selectedDocuments.length, isPersian)} selected documents?`}
        description={translate("این عملیات قطعه‌ها و بردارهای جست‌وجوی اسناد را نیز حذف می‌کند.")}
        confirmLabel={translate("حذف اسناد")}
        onConfirm={async () => {
          for (const document of selectedDocuments) await deleteDocument(document.id);
          setSelectedIds([]);
          setConfirmBulkDelete(false);
        }}
      />
      <ConfirmDialog
        open={confirmDeleteAll}
        onClose={() => setConfirmDeleteAll(false)}
        title={translate("حذف همه اسناد این پایگاه؟")}
        description={translate("همه سندها، قطعه‌ها و بردارهای این پایگاه حذف می‌شوند.")}
        confirmLabel={translate("حذف همه اسناد")}
        onConfirm={async () => {
          if (!selected) return;
          await deleteAllDocuments(selected.id);
          setSelectedIds([]);
          setConfirmDeleteAll(false);
        }}
      />
      <ConfirmDialog
        open={confirmDeleteBase}
        onClose={() => setConfirmDeleteBase(false)}
        title={isPersian ? `حذف پایگاه «${selected?.name ?? ""}»؟` : `Delete knowledge base "${selected?.name ?? ""}"?`}
        description={translate("همه سندها و قطعه‌های این پایگاه حذف می‌شوند. این کار قابل بازگشت نیست.")}
        confirmLabel={translate("حذف پایگاه دانش")}
        onConfirm={async () => {
          if (!selected) return;
          await deleteKnowledgeBase(selected.id);
          setConfirmDeleteBase(false);
          navigate("/knowledge");
        }}
      />
    </main>
  );
}

function Hero({
  name,
  subtitle,
  onAdd,
  addLabel,
  children,
}: {
  name: string;
  subtitle: string;
  onAdd: () => void;
  addLabel: string;
  children?: ReactNode;
}) {
  const { translate } = useLanguage();
  return (
    <header className="relative isolate overflow-hidden rounded-[22px] border border-accent/15 bg-[linear-gradient(125deg,rgba(19,16,14,0.97),rgba(15,15,19,0.94)_58%,rgba(31,18,12,0.91))] px-5 py-5 shadow-[0_18px_60px_-42px_var(--accent-glow)] sm:px-7 sm:py-6">
      <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-accent/[0.11] blur-[90px]" />
      <div className="pointer-events-none absolute bottom-[-130px] right-[20%] size-64 rounded-full bg-orange-500/[0.045] blur-[80px]" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.07] px-2.5 py-1 text-[10px] font-medium text-accent">
            <Sparkles className="size-3" aria-hidden />
            {translate("دانشِ متصل، پاسخ‌های مستند")}
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">{name}</h1>
          <p className="mt-2 max-w-xl text-xs leading-6 text-ink-mute">{subtitle}</p>
          {children ? <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div> : null}
        </div>
        <Button
          variant="primary"
          iconLeft={<Plus className="size-4" aria-hidden />}
          onClick={onAdd}
          className="shadow-[0_6px_24px_-10px_var(--accent-glow)]"
        >
          {addLabel}
        </Button>
      </div>
    </header>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  accent = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden border-white/[0.065] bg-surface/85 p-4">
      {accent ? <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/60 to-transparent" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-ink-mute">{label}</p>
          <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${danger ? "text-danger" : "text-ink"}`} dir="ltr">
            {value}
          </p>
        </div>
        <span className={`grid size-8 place-items-center rounded-lg border ${accent ? "border-accent/20 bg-accent/[0.08] text-accent" : danger ? "border-danger/20 bg-danger/[0.07] text-danger" : "border-white/[0.08] bg-white/[0.03] text-ink-mute"}`}>
          {icon}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] text-ink-faint">{hint}</p>
    </Card>
  );
}

function SourceShortcut({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-ink-mute transition-colors hover:border-accent/25 hover:bg-accent/[0.045] hover:text-ink-soft"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

function DocumentName({ document }: { document: DocumentRecord }) {
  const Icon = sourceIcon(document.source);
  return (
    <div className="flex min-w-52 max-w-[300px] items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-ink-mute">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink-soft" title={document.name}>
          {document.name}
        </span>
        {document.sourceUrl ? (
          <span className="mt-0.5 block max-w-56 truncate text-[9px] text-ink-faint" dir="ltr">
            {document.sourceUrl}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function DocumentActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { translate } = useLanguage();
  return (
    <div className="flex items-center gap-1 opacity-75 transition-opacity group-hover:opacity-100">
      <IconButton label={translate("ویرایش سند")} size="icon-sm" variant="ghost" onClick={onEdit}>
        <Pencil className="size-3.5" aria-hidden />
      </IconButton>
      <IconButton label={translate("حذف سند")} size="icon-sm" variant="ghost" onClick={onDelete}>
        <Trash2 className="size-3.5 text-danger/80" aria-hidden />
      </IconButton>
    </div>
  );
}

function StatusSummary({ processing, failed }: { processing: number; failed: number }) {
  const { isPersian, translate } = useLanguage();
  if (processing > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-warn/15 bg-warn/[0.05] px-3 py-2">
        <Loader2 className="size-3.5 animate-spin-slow text-warn" aria-hidden />
        <span className="text-[11px] text-ink-soft">{faNumber(processing, isPersian)} {translate("سند در صف پردازش")}</span>
      </div>
    );
  }
  if (failed > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger/15 bg-danger/[0.05] px-3 py-2">
        <AlertCircle className="size-3.5 text-danger" aria-hidden />
        <span className="text-[11px] text-ink-soft">{faNumber(failed, isPersian)} {translate("سند نیازمند بررسی است")}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-success/15 bg-success/[0.045] px-3 py-2">
      <CheckCircle2 className="size-3.5 text-success" aria-hidden />
      <span className="text-[11px] text-ink-soft">{translate("همه سندها آماده بازیابی هستند")}</span>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-ink-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-ink-faint">{label}</p>
        <p className="mt-1 break-words font-mono text-[10px] text-ink-soft" dir="auto">
          {value}
        </p>
      </div>
    </div>
  );
}

function AnswerStyleCard({
  assistants,
  assistant,
  assistantId,
  temperature,
  tone,
  message,
  saving,
  onAssistant,
  onTemperature,
  onTone,
  onSave,
}: {
  assistants: Assistant[];
  assistant?: Assistant;
  assistantId: string;
  temperature: number;
  tone: AssistantTone;
  message: string;
  saving: boolean;
  onAssistant: (id: string) => void;
  onTemperature: (value: number) => void;
  onTone: (value: AssistantTone) => void;
  onSave: () => void;
}) {
  const { isPersian, translate } = useLanguage();
  const [saved, setSaved] = useState(false);
  const changed =
    Boolean(assistant) &&
    (temperature !== assistant?.model.temperature || tone !== (assistant?.tone ?? DEFAULT_TONE));

  useEffect(() => setSaved(false), [temperature, tone, assistantId]);

  return (
    <Card className="border-white/[0.07] bg-surface/90 p-4">
      <div className="mb-4 flex items-start gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg border border-accent/15 bg-accent/[0.06] text-accent">
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <div>
          <h2 className="text-xs font-semibold text-ink">{translate("لحن و دمای پاسخ")}</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{translate("سبک پاسخ‌گویی دستیار متصل را تنظیم کنید.")}</p>
        </div>
      </div>
      {assistants.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-black/15 p-3 text-[10px] leading-relaxed text-ink-faint">
          {translate("هنوز دستیاری به این پایگاه متصل نیست. پس از اتصال دستیار، تنظیم لحن و دما در این بخش فعال می‌شود.")}
        </div>
      ) : (
        <div className="space-y-4">
          {assistants.length > 1 ? (
            <Field label={translate("دستیار")}>
              <Select
                aria-label={translate("انتخاب دستیار")}
                value={assistantId}
                onChange={(event) => onAssistant(event.target.value)}
                options={assistants.map((entry) => ({ value: entry.id, label: entry.name }))}
              />
            </Field>
          ) : assistant ? (
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2">
              <span className="text-[10px] text-ink-faint">{translate("دستیار متصل")}</span>
              <span className="max-w-36 truncate text-[11px] text-ink-soft">{assistant.name}</span>
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="answer-tone" className="text-[10px] font-medium text-ink-soft">
              {translate("لحن پاسخ")}
            </label>
            <Select
              id="answer-tone"
              aria-label={translate("لحن پاسخ")}
              value={tone}
              onChange={(event) => onTone(event.target.value as AssistantTone)}
              options={Object.entries(TONES).map(([value, setting]) => ({
                value,
                label: `${translate(TONE_NAMES[value as AssistantTone])} — ${translate(setting.description)}`,
              }))}
            />
          </div>
          <Slider
            value={temperature}
            onChange={onTemperature}
            min={0}
            max={2}
            step={0.1}
            label={translate("دمای پاسخ")}
            hint={translate("دمای کمتر پاسخ‌ها را دقیق‌تر و قابل‌پیش‌بینی‌تر می‌کند؛ دمای بیشتر تنوع را بالا می‌برد.")}
            format={(value) => value.toFixed(1)}
          />
          <Button
            size="sm"
            variant={changed ? "primary" : "outline"}
            className="w-full"
            loading={saving}
            disabled={!changed || saving}
            onClick={() => {
              onSave();
              setSaved(true);
            }}
          >
            {translate(saved && !changed ? "ذخیره شد" : "ذخیره تنظیمات پاسخ")}
          </Button>
          {message ? (
            <p className={`text-[10px] ${message.includes(isPersian ? "ذخیره شد" : "saved") ? "text-success" : "text-danger"}`} role="status">
              {translate(message)}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ProgressExperience({
  status,
  progress,
  compact = false,
}: {
  status: DocumentStatus;
  progress: number;
  compact?: boolean;
}) {
  const { isPersian, translate } = useLanguage();
  const active = currentStage(status);
  const percent = status === "indexed" ? 100 : Math.max(4, Math.min(99, Math.round(progress * 100)));
  return (
    <div className={compact ? "space-y-1" : "space-y-2.5"}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-soft">
          {status === "failed" ? (
            <AlertCircle className="size-3 text-danger" aria-hidden />
          ) : status === "indexed" ? (
            <Check className="size-3 text-success" aria-hidden />
          ) : (
            <Loader2 className="size-3 animate-spin-slow text-accent" aria-hidden />
          )}
          {status === "failed" ? translate("پردازش ناموفق") : status === "indexed" ? translate("آماده استفاده") : `${translate("اکنون")}: ${translate(stageLabel(status))}`}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-ink-faint" dir="ltr">
          {faNumber(percent, isPersian)}{isPersian ? "٪" : "%"}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${translate("پیشرفت")} ${translate(stageLabel(status))}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${status === "failed" ? "bg-danger" : status === "indexed" ? "bg-success" : "bg-gradient-to-l from-accent to-amber-200"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {!compact ? (
        <div className="grid grid-cols-6 gap-1">
          {PIPELINE.map((stage, index) => {
            const complete = status === "indexed" || index < active;
            const activeStep = index === active && status !== "indexed";
            return (
              <div key={stage.id} className="min-w-0 text-center">
                <span className={`mx-auto mb-1 grid size-5 place-items-center rounded-full border text-[9px] ${complete ? "border-success/25 bg-success/[0.09] text-success" : activeStep ? "border-accent/35 bg-accent/[0.1] text-accent" : "border-white/[0.08] bg-white/[0.02] text-ink-faint"}`}>
                  {complete ? <Check className="size-2.5" aria-hidden /> : faNumber(index + 1, isPersian)}
                </span>
                <span className={`block truncate text-[8px] ${activeStep ? "text-ink-soft" : "text-ink-faint"}`}>
                  {translate(stage.label)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DocumentsEmpty({
  filtered,
  onClear,
  onAdd,
  onPaste,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
  onPaste: () => void;
}) {
  const { translate } = useLanguage();
  return (
    <div className="relative my-2 overflow-hidden rounded-2xl border border-dashed border-white/[0.1] bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,132,42,0.07),transparent_65%)] px-5 py-9 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-accent/15 bg-accent/[0.05] text-accent">
        {filtered ? <Search className="size-5" aria-hidden /> : <BookOpen className="size-5" aria-hidden />}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-ink">
        {translate(filtered ? "سندی با این مشخصات پیدا نشد" : "این پایگاه آماده‌ی اولین منبع شماست")}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-ink-faint">
        {filtered
          ? translate("فیلتر یا عبارت جست‌وجو را تغییر دهید تا سندها دوباره نمایش داده شوند.")
          : translate("یک فایل بارگذاری کنید، نشانی صفحه‌ای را وارد کنید یا محتوای خام را بچسبانید. وضعیت هر مرحله را همین‌جا می‌بینید.")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Button size="sm" variant="outline" onClick={onClear}>
            {translate("پاک‌کردن فیلترها")}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="primary" iconLeft={<Upload className="size-3.5" aria-hidden />} onClick={onAdd}>
              {translate("بارگذاری فایل")}
            </Button>
            <Button size="sm" variant="outline" iconLeft={<FileText className="size-3.5" aria-hidden />} onClick={onPaste}>
              {translate("چسباندن متن")}
            </Button>
          </>
        )}
      </div>
      {!filtered ? (
        <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[9px] text-ink-faint">
          <span>PDF</span>
          <span>DOCX</span>
          <span>TXT</span>
          <span>{translate("نشانی وب")}</span>
          <span>{translate("متن خام")}</span>
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeBaseModal({
  open,
  title,
  name,
  description,
  busy,
  onClose,
  onName,
  onDescription,
  onSubmit,
}: {
  open: boolean;
  title: string;
  name: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  const { translate } = useLanguage();
  const editing = title === "ویرایش پایگاه دانش" || title === "Edit knowledge base";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={translate("منابع مرتبط را در یک پایگاه گردآوری کنید تا دستیارهای متصل بتوانند آن‌ها را بازیابی کنند.")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{translate("انصراف")}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void onSubmit()}>
            {translate(editing ? "ذخیره تغییرات" : "ساخت پایگاه")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={translate("نام پایگاه")} htmlFor="knowledge-base-name">
          <Input id="knowledge-base-name" value={name} onChange={(event) => onName(event.target.value)} placeholder={translate("راهنمای محصول")} autoFocus />
        </Field>
        <Field label={translate("توضیحات")} htmlFor="knowledge-base-description" optional>
          <Textarea
            id="knowledge-base-description"
            rows={3}
            value={description}
            onChange={(event) => onDescription(event.target.value)}
            placeholder={translate("چه محتوایی در این پایگاه قرار می‌گیرد؟")}
          />
        </Field>
      </div>
    </Modal>
  );
}

interface UploadJob {
  id: string;
  name: string;
  fallbackStatus: DocumentStatus;
  fallbackProgress: number;
}

function AddDocumentDialog({
  mode,
  documents,
  embedding,
  onClose,
  onAddFile,
  onAddUrl,
  onAddText,
}: {
  mode: AddMode;
  documents: DocumentRecord[];
  embedding: EmbeddingConfig;
  onClose: () => void;
  onAddFile: (file: FilePayload) => Promise<DocumentRecord>;
  onAddUrl: (url: string) => Promise<DocumentRecord>;
  onAddText: (name: string, content: string) => Promise<DocumentRecord>;
}) {
  const { isPersian, translate } = useLanguage();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<{ name: string; status: DocumentStatus; progress: number } | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mode) {
      setUrl("");
      setName("");
      setContent("");
      setError("");
      setActive(null);
      setJobs([]);
    }
  }, [mode]);

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    const errors: string[] = [];
    for (const file of files) {
      setActive({ name: file.name, status: "uploading", progress: 0.06 });
      try {
        setActive({ name: file.name, status: "processing", progress: 0.18 });
        const text = await extractFileText(file, (progress) => {
          setActive({ name: file.name, status: "processing", progress: 0.18 + progress * 0.24 });
        });
        if (!text) throw new Error("متنی برای ایندکس در این فایل پیدا نشد.");
        setActive({ name: file.name, status: "chunking", progress: 0.48 });
        const record = await onAddFile({
          name: file.name,
          size: file.size,
          type:
            file.type ||
            (file.name.toLowerCase().endsWith(".pdf")
              ? "application/pdf"
              : file.name.toLowerCase().endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "text/plain"),
          text,
        });
        setJobs((current) => [
          { id: record.id, name: file.name, fallbackStatus: record.status, fallbackProgress: record.progress },
          ...current,
        ]);
      } catch (caught) {
        errors.push(`${file.name}: ${translate((caught as Error).message)}`);
      }
    }
    setActive(null);
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    if (inputRef.current) inputRef.current.value = "";
  };

  const submitSource = async (kind: "url" | "text") => {
    setBusy(true);
    setError("");
    const jobName = kind === "url" ? url : name.trim() || translate("متن واردشده");
    setActive({ name: jobName, status: "uploading", progress: 0.12 });
    try {
      const record =
        kind === "url"
          ? await onAddUrl(url.trim())
          : await onAddText(name.trim() || translate("متن واردشده"), content.trim());
      setJobs((current) => [
        { id: record.id, name: jobName, fallbackStatus: record.status, fallbackProgress: record.progress },
        ...current,
      ]);
      setActive(null);
      setUrl("");
      setName("");
      setContent("");
    } catch (caught) {
      setError((caught as Error).message);
      setActive(null);
    } finally {
      setBusy(false);
    }
  };

  if (!mode) return null;

  const title = translate(
    mode === "file" ? "افزودن فایل به پایگاه" : mode === "url" ? "افزودن صفحه وب" : "افزودن متن خام",
  );

  return (
    <Modal
      open={Boolean(mode)}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      description={
        isPersian
          ? `محتوا با قطعه‌های ${faNumber(embedding.chunkSize, isPersian)} نویسه‌ای آماده و با مدل ${embedding.model} به بردار (Embedding) تبدیل می‌شود.`
          : `Content is split into ${faNumber(embedding.chunkSize, isPersian)}-character chunks and embedded with ${embedding.model}.`
      }
      size="lg"
      footer={
        mode === "file" ? (
          <Button variant="ghost" onClick={onClose} disabled={busy}>{translate("بستن")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{translate("بستن")}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={mode === "url" ? !url.trim() : !content.trim()}
              iconLeft={mode === "url" ? <Globe className="size-3.5" aria-hidden /> : <FilePlus2 className="size-3.5" aria-hidden />}
              onClick={() => void submitSource(mode)}
            >
              {translate("افزودن و ایندکس")}
            </Button>
          </>
        )
      }
    >
      {mode === "file" ? (
        <div className="space-y-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-5 py-8 text-center transition-colors ${dragging ? "border-accent/60 bg-accent/[0.07]" : "border-white/[0.12] bg-black/15 hover:border-accent/30"}`}
          >
            <span className="grid size-12 place-items-center rounded-2xl border border-accent/20 bg-accent/[0.07] text-accent">
              <Upload className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">{translate("فایل‌ها را اینجا رها کنید")}</p>
              <p className="mt-1 text-[10px] text-ink-faint">{translate("یا از دستگاه خود انتخاب کنید · PDF، DOCX، TXT")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              {translate("انتخاب فایل")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
              }}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <FormatTile format="PDF" detail={translate("استخراج متن هر صفحه")} />
            <FormatTile format="DOCX" detail={translate("خواندن متن سند")} />
            <FormatTile format="TXT" detail={translate("متن ساده")} />
          </div>
          {active ? (
            <PipelineCard name={active.name} status={active.status} progress={active.progress} />
          ) : null}
          {jobs.length ? (
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-ink-faint">{translate("سندهای افزوده‌شده")}</p>
              {jobs.map((job) => {
                const current = documents.find((document) => document.id === job.id);
                return (
                  <PipelineCard
                    key={job.id}
                    name={job.name}
                    status={current?.status ?? job.fallbackStatus}
                    progress={current?.progress ?? job.fallbackProgress}
                  />
                );
              })}
            </div>
          ) : null}
          {error ? <ErrorMessage message={error} /> : null}
        </div>
      ) : mode === "url" ? (
        <div className="space-y-4">
          <Field label={translate("نشانی صفحه")} htmlFor="knowledge-url" hint={translate("نشانی کامل صفحه را همراه https:// وارد کنید.")}>
            <Input id="knowledge-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/help" dir="ltr" autoFocus />
          </Field>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[10px] leading-relaxed text-ink-faint">
            {translate("محتوای قابل‌خواندن صفحه دریافت می‌شود. صفحاتی که درخواست مرورگر را مسدود می‌کنند، به سرویس دریافت سمت سرور نیاز دارند.")}
          </div>
          {active ? <PipelineCard name={active.name} status={active.status} progress={active.progress} /> : null}
          {jobs.map((job) => {
            const current = documents.find((document) => document.id === job.id);
            return <PipelineCard key={job.id} name={job.name} status={current?.status ?? job.fallbackStatus} progress={current?.progress ?? job.fallbackProgress} />;
          })}
          {error ? <ErrorMessage message={error} /> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={translate("عنوان سند")} htmlFor="raw-text-name" hint={translate("این عنوان کنار هر قطعه بازیابی‌شده نمایش داده می‌شود.")}>
            <Input id="raw-text-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={translate("سیاست بازگشت کالا")} autoFocus />
          </Field>
          <Field
            label={translate("محتوا")}
            htmlFor="raw-text-content"
            hint={isPersian
              ? `${faNumber(content.length, isPersian)} نویسه · حدود ${faNumber(Math.ceil(content.length / 4), isPersian)} توکن`
              : `${faNumber(content.length, isPersian)} characters · about ${faNumber(Math.ceil(content.length / 4), isPersian)} tokens`}
          >
            <Textarea id="raw-text-content" rows={11} value={content} onChange={(event) => setContent(event.target.value)} placeholder={translate("متن موردنظر را اینجا بچسبانید…")} />
          </Field>
          {active ? <PipelineCard name={active.name} status={active.status} progress={active.progress} /> : null}
          {jobs.map((job) => {
            const current = documents.find((document) => document.id === job.id);
            return <PipelineCard key={job.id} name={job.name} status={current?.status ?? job.fallbackStatus} progress={current?.progress ?? job.fallbackProgress} />;
          })}
          {error ? <ErrorMessage message={error} /> : null}
        </div>
      )}
    </Modal>
  );
}

function PersianStatusBadge({ status }: { status: DocumentStatus }) {
  const { translate } = useLanguage();
  const Icon =
    status === "indexed"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : status === "queued"
          ? Clock3
          : Loader2;
  const style =
    status === "indexed"
      ? "border-success/20 bg-success/[0.07] text-success"
      : status === "failed"
        ? "border-danger/20 bg-danger/[0.07] text-danger"
        : status === "embedding" || status === "indexing"
          ? "border-warn/20 bg-warn/[0.07] text-warn"
          : "border-info/20 bg-info/[0.07] text-info";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium ${style}`}>
      <Icon className={`size-3 ${isProcessing(status) && status !== "queued" ? "animate-spin-slow" : ""}`} aria-hidden />
      {translate(stageLabel(status))}
    </span>
  );
}

function FormatTile({ format, detail }: { format: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2">
      <FileText className="size-3.5 text-accent/80" aria-hidden />
      <span>
        <span className="block font-mono text-[10px] text-ink-soft">{format}</span>
        <span className="block text-[9px] text-ink-faint">{detail}</span>
      </span>
    </div>
  );
}

function PipelineCard({
  name,
  status,
  progress,
}: {
  name: string;
  status: DocumentStatus;
  progress: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-ink-soft">
          <FileStack className="size-3.5 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{name}</span>
        </span>
        <PersianStatusBadge status={status} />
      </div>
      <ProgressExperience status={status} progress={progress} />
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  const { translate } = useLanguage();
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/[0.055] px-3 py-2.5 text-[10px] leading-relaxed text-danger" role="alert">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {translate(message)}
    </div>
  );
}

function EditDocumentModal({
  document,
  onClose,
  onSave,
  loadContent,
}: {
  document: DocumentRecord | null;
  onClose: () => void;
  onSave: (id: string, patch: { name?: string; content?: string }) => Promise<void>;
  loadContent: (id: string) => Promise<string>;
}) {
  const { isPersian, translate } = useLanguage();
  const loadContentRef = useRef(loadContent);
  loadContentRef.current = loadContent;
  const [original, setOriginal] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!document) return;
    setName(document.name);
    setContent("");
    setLoading(true);
    setError("");
    let cancelled = false;
    // Depend on the document id only: loadContent changes identity on every
    // store update and would otherwise overwrite what the user is typing.
    void loadContentRef
      .current(document.id)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id]);

  return (
    <Modal
      open={Boolean(document)}
      onClose={onClose}
      title={translate("ویرایش سند")}
      description={translate("ذخیره تغییرات، قطعه‌های این سند را دوباره می‌سازد و ایندکس می‌کند.")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{translate("انصراف")}</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={loading || !document || !name.trim()}
            onClick={async () => {
              if (!document) return;
              setSaving(true);
              setError("");
              try {
                const patch: { name?: string; content?: string } = {};
                if (name.trim() !== document.name) patch.name = name.trim();
                if (content !== original) patch.content = content;
                if (Object.keys(patch).length > 0) await onSave(document.id, patch);
                else onClose();
              } catch (caught) {
                setError((caught as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {translate("ذخیره و ایندکس دوباره")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={translate("نام سند")} htmlFor="edit-document-name">
          <Input id="edit-document-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <Field
            label={translate("متن استخراج‌شده")}
            htmlFor="edit-document-content"
            hint={isPersian
              ? `${faNumber(content.length, isPersian)} نویسه`
              : `${faNumber(content.length, isPersian)} characters`}
          >
            <Textarea id="edit-document-content" rows={16} value={content} onChange={(event) => setContent(event.target.value)} />
          </Field>
        )}
        {error ? <ErrorMessage message={error} /> : null}
      </div>
    </Modal>
  );
}
