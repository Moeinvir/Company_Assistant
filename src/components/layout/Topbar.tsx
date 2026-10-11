import { useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  Check,
  Flame,
  FlaskConical,
  HardDrive,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  IconButton,
  Kbd,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  StatusDot,
  Tooltip,
} from "@/components/ui";
import { FireThemePanel } from "@/features/fire/FireThemePanel";
import { useSession } from "@/store/session";
import { useWorkspaceData } from "@/store/workspaceData";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useFireTheme } from "@/fire/FireThemeProvider";
import { LanguageSwitch, useLanguage } from "@/store/language";

export function Topbar({
  onOpenNav,
  onOpenPalette,
}: {
  onOpenNav: () => void;
  onOpenPalette: () => void;
}) {
  const navigate = useNavigate();
  const { user, workspace, workspaces, selectWorkspace, signOut, client } = useSession();
  const { activity, assistants } = useWorkspaceData();
  const { theme } = useFireTheme();
  const { translate } = useLanguage();

  const recent = activity.slice(0, 6);
  const attention = assistants.filter((entry) => entry.status === "error").length;

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-base/70 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
        <IconButton label={translate("Open navigation")} variant="ghost" className="lg:hidden" onClick={onOpenNav}>
          <Menu className="size-4" aria-hidden />
        </IconButton>

        <div className="hidden lg:block">
          <Dropdown
            align="start"
            width={252}
            renderTrigger={(props) => (
              <button
                type="button"
                {...props}
                className="flex items-center gap-2.5 rounded-[10px] border border-hairline bg-black/25 px-2.5 py-1.5 text-start transition-colors hover:border-hairline-strong hover:bg-surface-2"
              >
                <span className="flex size-6 items-center justify-center rounded-md border border-white/10 bg-surface-3 text-[10px] font-semibold uppercase text-ink-soft">
                  {Array.from(workspace?.name ?? "").slice(0, 2).join("")}
                </span>
                <span className="max-w-[180px] truncate text-micro font-medium text-ink">
                  {workspace?.name}
                </span>
                {workspace?.isSample ? <Badge tone="warn">{translate("sample")}</Badge> : null}
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>{translate("Workspaces")}</MenuLabel>
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
                <MenuSeparator />
                <MenuItem
                  icon={<Settings className="size-3.5" aria-hidden />}
                  onSelect={() => {
                    navigate("/settings");
                    close();
                  }}
                >
                  {translate("Workspace settings")}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          className="group flex h-9 flex-1 items-center gap-2.5 rounded-[10px] border border-hairline bg-black/25 px-3 text-start transition-colors hover:border-hairline-strong hover:bg-surface-2 sm:max-w-md"
        >
          <Search className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <span className="flex-1 truncate text-2xs text-ink-faint">
            {translate("Search assistants, documents, settings…")}
          </span>
          <span className="hidden items-center gap-0.5 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <div className="flex items-center gap-1">
          <LanguageSwitch />
          <Popover
            width={330}
            renderTrigger={(props) => (
              <Tooltip label={`Fire theme — ${theme.name}`}>
                <Button
                  {...props}
                  variant="ghost"
                  size="icon"
                  className="text-ink-mute hover:text-accent"
                >
                  <Flame className="size-4" aria-hidden />
                </Button>
              </Tooltip>
            )}
          >
            <FireThemePanel compact showHeading={false} />
          </Popover>

          <Dropdown
            width={300}
            renderTrigger={(props) => (
              <Button {...props} variant="ghost" size="icon" className="relative">
                <Bell className="size-4" aria-hidden />
                {attention > 0 ? (
                  <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-danger" />
                ) : null}
                <span className="sr-only">{translate("Notifications")}</span>
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>{translate("Recent activity")}</MenuLabel>
                {recent.length === 0 ? (
                  <p className="px-2.5 py-3 text-2xs text-ink-faint">
                    {translate("Nothing has happened in this workspace yet.")}
                  </p>
                ) : (
                  recent.map((entry) => (
                    <div key={entry.id} className="flex gap-2.5 rounded-[8px] px-2.5 py-2">
                      <StatusDot
                        tone={
                          entry.kind === "document.failed"
                            ? "danger"
                            : entry.kind === "document.indexed"
                              ? "success"
                              : "neutral"
                        }
                      />
                      <div className="min-w-0">
                        <p className="truncate text-2xs text-ink-soft">{entry.summary}</p>
                        <p className="mt-0.5 text-[10px] text-ink-faint">
                          {entry.actor} · {formatRelative(entry.at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <MenuSeparator />
                <MenuItem
                  onSelect={() => {
                    navigate("/analytics");
                    close();
                  }}
                >
                  {translate("Open analytics")}
                </MenuItem>
              </>
            )}
          </Dropdown>

          <Dropdown
            width={250}
            renderTrigger={(props) => (
              <button
                type="button"
                {...props}
                className="ms-0.5 rounded-full transition hover:opacity-90"
                aria-label={translate("Account menu")}
              >
                <Avatar name={user?.name ?? "?"} size="sm" />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="px-2.5 py-2">
                  <p className="truncate text-2xs font-medium text-ink">{user?.name}</p>
                  <p className="truncate text-[10px] text-ink-faint">{user?.email}</p>
                </div>
                <MenuSeparator />
                <MenuItem
                  icon={<UserCog className="size-3.5" aria-hidden />}
                  onSelect={() => {
                    navigate("/settings");
                    close();
                  }}
                >
                  {translate("Account settings")}
                </MenuItem>
                <MenuItem
                  icon={
                    client.mode === "demo" ? (
                      <HardDrive className="size-3.5" aria-hidden />
                    ) : (
                      <ShieldCheck className="size-3.5" aria-hidden />
                    )
                  }
                  onSelect={() => {
                    navigate("/settings");
                    close();
                  }}
                  shortcut={client.mode === "demo" ? "local" : "api"}
                >
                  {translate(client.mode === "demo" ? "Local data layer" : "Connected API")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  tone="danger"
                  icon={<LogOut className="size-3.5" aria-hidden />}
                  onSelect={() => {
                    close();
                    void signOut();
                  }}
                >
                  {translate("Sign out")}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {workspace?.isSample ? (
        <div
          className={cn(
            "flex items-center gap-2 border-t border-warn/20 bg-warn/[0.06] px-3 py-1.5 text-[10px] text-warn sm:px-5",
          )}
        >
          <Check className="size-3 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 truncate">
            You are viewing the sample workspace — documents, history and metrics here are
            generated locally so you can explore the product. Nothing is sent anywhere.
          </p>
        </div>
      ) : null}
    </header>
  );
}
