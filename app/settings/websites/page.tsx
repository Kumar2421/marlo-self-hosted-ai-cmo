"use client";

import { useState } from "react";
import { Pencil, Trash2, Loader2, Plus, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { useProject, type ActiveProject } from "@/lib/project-store";
import { NewProjectModal } from "@/components/dashboard/TerminalLog";
import { WebsiteIcon } from "@/components/shared/WebsiteIcon";
import { normalizeHostUrl } from "@/lib/domain/shared/hostLike";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_DASHED, FOCUS_RING, INPUT, SettingsPageHeader } from "@/components/settings/ui";

function EditForm({ project, onClose }: { project: ActiveProject; onClose: () => void }) {
  const { updateProject } = useProject();
  const { show } = useToast();
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category);
  const [description, setDescription] = useState(project.description);
  const [url, setUrl] = useState(project.url);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !url.trim()) {
      show("Name and URL are required.");
      return;
    }
    setSaving(true);
    try {
      await updateProject(project.id, { name: name.trim(), category: category.trim(), description: description.trim(), url: url.trim() });
      show("Project updated.");
      onClose();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-ui-border bg-ui-surface-muted px-4 py-4">
      <div>
        <label htmlFor="ws-name" className="mb-1 block text-xs font-medium text-ui-muted">Name</label>
        <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="ws-url" className="mb-1 block text-xs font-medium text-ui-muted">Website URL</label>
        <input id="ws-url" value={url} onChange={(e) => setUrl(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="ws-category" className="mb-1 block text-xs font-medium text-ui-muted">Category</label>
        <input id="ws-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="SaaS" className={INPUT} />
      </div>
      <div>
        <label htmlFor="ws-description" className="mb-1 block text-xs font-medium text-ui-muted">Description</label>
        <textarea id="ws-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${INPUT} resize-none`} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={BTN_GHOST}>
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={BTN_PRIMARY}
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function ProjectRow({ p, isActive }: { p: ActiveProject; isActive: boolean }) {
  const { switchProject, deleteProject } = useProject();
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSwitch() {
    setSwitching(true);
    try {
      await switchProject(p.id);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to switch project.");
    } finally {
      setSwitching(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteProject(p.id);
      show(`Deleted ${p.name} — its documents, competitors, leads and cached checks are gone.`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete project.");
      setDeleting(false);
    }
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <WebsiteIcon url={p.url} size={8} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-ui-text">{p.name}</span>
              {isActive && (
                <span className="shrink-0 rounded-full bg-ui-accent-soft px-2 py-0.5 text-xs font-medium text-ui-accent-strong">Active</span>
              )}
              {p.category && (
                <span className="shrink-0 rounded-full border border-ui-border bg-ui-surface-sunken px-2 py-0.5 text-xs font-medium text-ui-muted">{p.category}</span>
              )}
            </div>
            <a href={normalizeHostUrl(p.url)?.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[12px] text-ui-muted hover:underline">
              {p.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} className="shrink-0" />
            </a>
            {p.description && <p className="mt-0.5 truncate text-xs text-ui-subtle">{p.description}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isActive && !confirmingDelete && (
            <button
              onClick={handleSwitch}
              disabled={switching}
              className={BTN_SECONDARY}
            >
              {switching && <Loader2 size={12} className="animate-spin" />}
              {switching ? "Switching..." : "Switch"}
            </button>
          )}
          {!confirmingDelete && (
            <>
              <button onClick={() => setEditing((v) => !v)} title="Edit" aria-label="Edit" className={`flex h-11 w-11 items-center justify-center rounded-lg text-ui-subtle hover:bg-ui-surface-sunken hover:text-ui-text sm:h-9 sm:w-9 ${FOCUS_RING}`}>
                <Pencil size={14} />
              </button>
              <button onClick={() => setConfirmingDelete(true)} title="Delete" aria-label="Delete" className={`flex h-11 w-11 items-center justify-center rounded-lg text-ui-subtle hover:bg-red-50 hover:text-ui-danger-text sm:h-9 sm:w-9 ${FOCUS_RING}`}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="flex flex-col gap-2 border-t border-ui-danger/30 bg-ui-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="flex items-center gap-1.5 text-[13px] text-ui-danger-text">
            <AlertTriangle size={13} className="shrink-0" />
            Delete {p.name} and all its data? This can&apos;t be undone.
          </span>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setConfirmingDelete(false)} disabled={deleting} className={BTN_GHOST}>
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${BTN_PRIMARY} !bg-red-600 !text-white hover:!bg-red-700`}
            >
              {deleting && <Loader2 size={12} className="animate-spin" />}
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}

      {editing && <EditForm project={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function WebsitesPage() {
  const { project, projects, loading } = useProject();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader
        title="Websites"
        caption={
          <>
            Every project you&apos;ve created — this is the real, live source of what Context, Analytics, Leads
            and every agent read from. Deleting one wipes its documents, competitors, leads and cached checks
            for good.
          </>
        }
        actions={
          <button onClick={() => setModalOpen(true)} className={BTN_PRIMARY}>
            <Plus size={14} /> Add website
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-10 text-ui-subtle">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : projects.length === 0 ? (
        <div className={`${CARD_DASHED} p-6 text-center text-[13px] text-ui-muted`}>
          No websites yet. Add one to start crawling it for SEO, content and lead data.
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectRow key={p.id} p={p} isActive={project?.id === p.id} />
          ))}
        </div>
      )}

      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
