import { NavLink } from "react-router-dom";
import { Building2, ChevronsUpDown, FlaskConical, Sparkles, X } from "lucide-react";
import { NAV_GROUPS, NAV_ITEMS } from "./nav";
import { Wordmark } from "@/components/brand/EmberMark";
import { Badge, Dropdown, IconButton, MenuItem, MenuLabel } from "@/components/ui";
import { useSession } from "@/store/session";
import { useWorkspaceData } from "@/store/workspaceData";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { useLanguage } from "@/store/language";

function NavEntry({ item, onNavigate }: { item: (typeof NAV_ITEMS)[number]; onNavigate?: () => void }) {
  const { translate } = useLanguage();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={translate(item.description)}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-micro transition-colors duration-150",
          isActive ? "text-ink" : "text-ink-mute hover:bg-white/[0.03] hover:text-ink-soft",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Thin accent rail: the only ember the navigation needs. */}
          <span
            aria-hidden
            className={cn(
              "absolute start-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-all duration-200",
              isActive ? "bg-accent opacity-100" : "opacity-0",
            )}
            style={isActive ? { boxShadow: "0 0 12px 1px var(--accent-glow)" } : undefined}
          />
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-[8px] border transition-colors duration-150",
              isActive
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-transparent bg-white/[0.02] text-ink-faint group-hover:border-hairline group-hover:text-ink-soft",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{translate(item.label)}</span>
        </>
      )}
    </NavLink>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, user, workspaces, selectWorkspace } = useSession();
  const { assistants, knowledgeBases } = useWorkspaceData();
  const { translate } = useLanguage();

  const documentCount = knowledgeBases.reduce((sum, kb) => sum + kb.documentCount, 0);

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <div className="flex items-center justify-between px-1.5">
        <Wordmark />
        {onNavigate ? (
          <IconButton label="Close navigation" size="icon-sm" variant="ghost" onClick={onNavigate}>
            <X className="size-3.5" aria-hidden />
          </IconButton>
        ) : null}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto" aria-label="Primary">
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="space-y-0.5">
              <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
                {translate(group)}
              </p>
              {items.map((item) => (
                <NavEntry key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-hairline pt-3">
        <div className="rounded-[10px] border border-hairline bg-black/25 p-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-2xs font-medium text-ink-soft">
              {formatCompact(assistants.length)} {translate("assistants")} · {formatCompact(documentCount)} {translate("docs")}
            </p>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
            {knowledgeBases.length} {translate(knowledgeBases.length === 1 ? "knowledge base indexing into this workspace" : "knowledge bases indexing into this workspace")}
          </p>
        </div>

        <Dropdown
          align="start"
          placement="top"
          width={224}
          renderTrigger={(props) => (
            <button
              type="button"
              {...props}
              className="flex w-full items-center gap-2 rounded-[10px] px-1.5 py-2 text-start transition-colors hover:bg-white/[0.03]"
            >
              <span className="flex size-7 items-center justify-center rounded-full border border-white/10 bg-surface-3 text-[10px] font-semibold text-ink-soft">
                {Array.from(user?.name ?? "?")[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs font-medium text-ink-soft">
                  {workspace?.name}
                </span>
                <span className="block truncate text-[10px] text-ink-faint">
                  {workspaces.length} {translate(workspaces.length === 1 ? "workspace" : "workspaces")}
                </span>
              </span>
              <Badge tone={workspace?.isSample ? "warn" : "neutral"}>
                {workspace?.isSample ? translate("sample") : (workspace?.plan ?? "trial")}
              </Badge>
              <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>{translate("Switch workspace")}</MenuLabel>
              {workspaces.map((entry) => (
                <MenuItem
                  key={entry.id}
                  icon={
                    entry.isSample ? (
                      <FlaskConical className="size-3.5" aria-hidden />
                    ) : (
                      <Building2 className="size-3.5" aria-hidden />
                    )
                  }
                  onSelect={() => {
                    selectWorkspace(entry.id);
                    close();
                  }}
                >
                  {entry.name}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { isPersian } = useLanguage();
  return (
    <aside dir={isPersian ? "rtl" : "ltr"} className="sticky top-0 hidden h-screen w-[242px] shrink-0 border-e border-hairline bg-base/72 backdrop-blur-xl lg:block">
      <SidebarContent />
    </aside>
  );
}
