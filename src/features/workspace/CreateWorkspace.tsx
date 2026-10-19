import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { Button, Field, Input, Modal, SegmentedControl } from "@/components/ui";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useLanguage } from "@/store/language";
import type { Workspace } from "@/lib/api/types";

const CreateWorkspaceContext = createContext<(() => void) | null>(null);

/** Opens the "new workspace" dialog from anywhere inside the app shell. */
export function useCreateWorkspace() {
  const open = useContext(CreateWorkspaceContext);
  if (!open) throw new Error("useCreateWorkspace must be used inside <CreateWorkspaceProvider>");
  return open;
}

const PLANS: { value: Workspace["plan"]; label: string }[] = [
  { value: "trial", label: "Trial" },
  { value: "team", label: "Team" },
  { value: "scale", label: "Scale" },
];

export function CreateWorkspaceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const value = useMemo(() => show, [show]);
  return (
    <CreateWorkspaceContext.Provider value={value}>
      {children}
      <CreateWorkspaceDialog open={open} onClose={() => setOpen(false)} />
    </CreateWorkspaceContext.Provider>
  );
}

function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createWorkspace, workspaces } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const { translate } = useLanguage();
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Workspace["plan"]>("trial");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setName("");
    setPlan("trial");
    setError(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the workspace a name.");
      return;
    }
    if (workspaces.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("You already have a workspace with this name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createWorkspace({ name: trimmed, plan });
      toast.success(translate("Workspace created"), created.name);
      setBusy(false);
      setName("");
      setPlan("trial");
      onClose();
      navigate("/dashboard");
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create a workspace"
      description="A workspace keeps its own assistants, knowledge bases, keys and analytics, fully separate from your other workspaces."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void submit()}
            iconLeft={<Building2 className="size-3.5" aria-hidden />}
          >
            Create workspace
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Workspace name" htmlFor="new-workspace-name" error={error ?? undefined}>
          <Input
            id="new-workspace-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Acme Support"
            maxLength={60}
            autoFocus
          />
        </Field>
        <Field label="Plan" hint="Plan labels are cosmetic in this build; they do not gate features.">
          <SegmentedControl value={plan} onChange={(value) => setPlan(value as Workspace["plan"])} options={PLANS} />
        </Field>
      </form>
    </Modal>
  );
}
