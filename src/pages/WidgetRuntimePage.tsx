import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ChatWidget } from "@/features/widget/ChatWidget";
import { getApiClient, type ApiClient, type PublicWidgetConfig } from "@/lib/api/client";
import { EmberMark } from "@/components/brand/EmberMark";
import "./runtime.css";

/**
 * Standalone widget runtime.
 *
 * Loaded inside the iframe that `public/embed.js` injects on the host page.
 * It talks only to the public widget endpoints, keyed by the assistant's public
 * key — no session, no workspace membership, and no access to anything the key
 * does not identify.
 */
export default function WidgetRuntimePage() {
  const { publicKey = "" } = useParams<{ publicKey: string }>();
  const [client, setClient] = useState<ApiClient | null>(null);
  const [config, setConfig] = useState<PublicWidgetConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remember the conversation so follow-ups keep their history instead of
  // starting (and counting) a brand-new conversation for every message.
  const conversationId = useRef<string | undefined>(undefined);

  useEffect(() => {
    conversationId.current = undefined;
    let cancelled = false;
    void (async () => {
      try {
        const api = await getApiClient();
        if (cancelled) return;
        setClient(api);
        const loaded = await api.widget.config(publicKey);
        if (cancelled) return;
        setConfig(loaded);
        // Let the host page know the runtime is interactive.
        window.parent?.postMessage(
          { source: "parsis-widget", type: "ready", assistantId: loaded.assistantId, publicKey },
          "*",
        );
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // Keep the host page informed so it can size or anchor the iframe.
  useEffect(() => {
    const report = () => {
      window.parent?.postMessage(
        {
          source: "parsis-widget",
          type: "resize",
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth,
        },
        "*",
      );
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, []);

  if (error) {
    return (
      <div className="runtime-shell items-center justify-center p-5">
        <div className="w-full max-w-sm rounded-xl border border-danger/30 bg-[#150d0f] p-4 text-center">
          <AlertTriangle className="mx-auto size-5 text-danger" aria-hidden />
          <p className="mt-2 text-[13px] font-semibold text-[#f3f3f5]">Widget unavailable</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[#9b9ba6]">{error}</p>
          <p className="mt-2 text-[10px] leading-relaxed text-[#6f6f7b]">
            Check the assistant exists in the workspace, that its widget is enabled, and that the
            public key in the snippet matches.
          </p>
        </div>
      </div>
    );
  }

  if (!config || !client) {
    return (
      <div className="runtime-shell items-center justify-center">
        <div className="flex items-center gap-2 text-[11.5px] text-[#9b9ba6]">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading assistant…
        </div>
      </div>
    );
  }

  return (
    <div className="runtime-shell">
      <div
        className="relative h-full w-full"
        style={{
          paddingBottom: config.widget.offsetY,
          paddingTop: config.widget.offsetY,
          paddingLeft: config.widget.offsetX,
          paddingRight: config.widget.offsetX,
        }}
      >
        <ChatWidget
          config={{ ...config.widget, position: "bottom-right", offsetX: 0, offsetY: 0 }}
          title={config.name}
          variant="inline"
          hints={config.hints}
          onClose={() =>
            window.parent?.postMessage({ source: "parsis-widget", type: "close" }, "*")
          }
          send={async (question) => {
            const { response, conversationId: id } = await client.widget.query(config.publicKey, {
              question,
              conversationId: conversationId.current,
            });
            conversationId.current = id;
            return {
              content: response.message.content,
              sources: response.retrieved,
              mode: response.message.meta?.mode,
            };
          }}
        />
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2">
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[9px] text-[#8b8b96] backdrop-blur">
          <EmberMark size={12} />
          {`${config.knowledgeBaseCount} knowledge ${config.knowledgeBaseCount === 1 ? "base" : "bases"} · ${config.documentCount} documents`}
        </span>
      </div>
    </div>
  );
}
