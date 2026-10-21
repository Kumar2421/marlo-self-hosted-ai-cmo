"use client";

import { useState } from "react";
import { Pencil, Trash2, Loader2, Plus, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { useProject, type ActiveProject } from "@/lib/project-store";
import { NewProjectModal } from "@/components/dashboard/TerminalLog";
import { WebsiteIcon } from "@/components/shared/WebsiteIcon";
import { normalizeHostUrl } from "@/lib/domain/shared/hostLike";

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
    <div className="space-y-3 border-t border-gray-200 px-4 py-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] outline-none focus:border-black" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Website URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] outline-none focus:border-black" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Category</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="SaaS" className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] outline-none focus:border-black" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] outline-none focus:border-black" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <WebsiteIcon url={p.url} size={8} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-gray-900">{p.name}</span>
              {isActive && (
                <span className="shrink-0 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[11px] font-medium text-[#00846f]">Active</span>
              )}
              {p.category && (
                <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">{p.category}</span>
              )}
            </div>
            <a href={normalizeHostUrl(p.url)?.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[12px] text-gray-500 hover:underline">
              {p.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} className="shrink-0" />
            </a>
            {p.description && <p className="mt-0.5 truncate text-[11px] text-gray-400">{p.description}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isActive && !confirmingDelete && (
            <button
              onClick={handleSwitch}
              disabled={switching}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              {switching && <Loader2 size={12} className="animate-spin" />}
              {switching ? "Switching..." : "Switch"}
            </button>
          )}
          {!confirmingDelete && (
            <>
              <button onClick={() => setEditing((v) => !v)} title="Edit" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <Pencil size={14} />
              </button>
              <button onClick={() => setConfirmingDelete(true)} title="Delete" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="flex flex-col gap-2 border-t border-red-100 bg-red-50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="flex items-center gap-1.5 text-[12px] text-red-700">
            <AlertTriangle size={13} className="shrink-0" />
            Delete {p.name} and all its data? This can&apos;t be undone.
          </span>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setConfirmingDelete(false)} disabled={deleting} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-gray-600 hover:bg-white disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
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
    <div className="min-w-0 max-w-2xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Websites</h1>
          <p className="text-[13px] text-gray-500">
            Every project you&apos;ve created — this is the real, live source of what Context, Analytics, Leads
            and every agent read from. Deleting one wipes its documents, competitors, leads and cached checks
            for good.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black"
        >
          <Plus size={14} /> Add website
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500">
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
