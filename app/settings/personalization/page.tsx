"use client";

import { useEffect, useState } from "react";
import { useAuthUser } from "@/lib/useAuthUser";
import { useToast } from "@/components/dashboard/Toast";
import { Loader2 } from "lucide-react";

const SETTINGS_KEYS = {
  name: "personalization_name",
  role: "personalization_role",
  notes: "personalization_notes",
  language: "personalization_language",
};

export default function PersonalizationPage() {
  const { show } = useToast();
  const { user, loading: userLoading } = useAuthUser();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [language, setLanguage] = useState("English");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const find = (key: string) => data.settings?.find((s: { key: string; value: string }) => s.key === key)?.value;
        setName(find(SETTINGS_KEYS.name) ?? "");
        setRole(find(SETTINGS_KEYS.role) ?? "");
        setNotes(find(SETTINGS_KEYS.notes) ?? "");
        setLanguage(find(SETTINGS_KEYS.language) ?? "English");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const entries = [
        [SETTINGS_KEYS.name, name],
        [SETTINGS_KEYS.role, role],
        [SETTINGS_KEYS.notes, notes],
        [SETTINGS_KEYS.language, language],
      ];
      for (const [key, value] of entries) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
      }
      show("Preferences saved.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 max-w-2xl">
      <h2 className="mb-1 text-[15px] font-semibold text-gray-900">Profile</h2>
      <p className="mb-3 text-[13px] text-gray-500">Your account identity.</p>
      <div className="mb-8 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#8a8a8a] text-[12px] font-semibold text-white">
          {userLoading ? <Loader2 size={13} className="animate-spin" /> : user?.initials || "?"}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-gray-900">{user?.name || "Not signed in"}</div>
          <div className="text-[12px] text-gray-500">{user?.email || ""}</div>
        </div>
      </div>

      <h2 className="mb-1 text-[15px] font-semibold text-gray-900">Customize Your Experience</h2>
      <p className="mb-4 text-[13px] text-gray-500">Tell us a bit about yourself to personalize your chat experience.</p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-[13px] text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      ) : (
        <>
          <label className="mb-1 block text-[13px] font-medium text-gray-800">What should we call you?</label>
          <div className="relative mb-4">
            <input
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2.5 pr-14 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ui-subtle">{name.length}/50</span>
          </div>

          <label className="mb-1 block text-[13px] font-medium text-gray-800">What do you do?</label>
          <div className="relative mb-4">
            <input
              value={role}
              maxLength={100}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Engineer, student, etc."
              className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2.5 pr-16 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ui-subtle">{role.length}/100</span>
          </div>

          <label className="mb-1 block text-[13px] font-medium text-gray-800">Anything else we should know about you?</label>
          <div className="relative mb-4">
            <textarea
              value={notes}
              maxLength={3000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Interests, values, or preferences to keep in mind"
              className="h-28 w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 pb-6 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <span className="absolute bottom-2 right-3 text-xs text-ui-subtle">{notes.length}/3000</span>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="mb-8 flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saving ? "Saving..." : "Save Preferences"}
          </button>

          <h2 className="mb-1 text-[15px] font-semibold text-gray-900">Content Language</h2>
          <p className="mb-3 text-[13px] text-gray-500">AI-generated content and chat responses will use this language</p>
          <div className="mb-8 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-gray-900">Preferred Language</div>
              <div className="max-w-md text-[12px] text-gray-500">
                Applies to company documents, X agent, LinkedIn writer, AI chat, UGC video, and CMO terminal
              </div>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] text-gray-800"
            >
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>German</option>
            </select>
          </div>
        </>
      )}

      <h2 className="mb-1 text-[15px] font-semibold text-gray-900">Model Selection</h2>
      <p className="mb-6 text-[13px] text-gray-500">Use the model selector to add or remove models from your list.</p>

      <h2 className="mb-1 text-[15px] font-semibold text-gray-900">Your Memories</h2>
      <p className="text-[13px] text-gray-500">
        View and manage the memories stored from your conversations. These help personalize your chat experience.
      </p>
    </div>
  );
}
