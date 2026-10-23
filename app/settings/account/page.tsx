"use client";

import { useState, useEffect } from "react";
import { useAuthUser } from "@/lib/useAuthUser";
import { createClient } from "@/utils/supabase/client";
import { useToast } from "@/components/dashboard/Toast";
import { Loader2 } from "lucide-react";

export default function AccountPage() {
  const { show } = useToast();
  const { user, loading } = useAuthUser();
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(true);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((data) => {
        // Capitalize: free -> Free, lite -> Lite, pro -> Pro
        const tier = data.planTier || "free";
        const capitalized = tier.charAt(0).toUpperCase() + tier.slice(1);
        setPlan(capitalized);
      })
      .catch(() => {
        setPlan("Free");
      })
      .finally(() => {
        setPlanLoading(false);
      });
  }, []);

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      show("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      show("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      show("Password updated.");
      setChangingPassword(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Account & Security</h1>
      <p className="mb-4 text-[13px] text-gray-500">Manage your login and account protection.</p>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="mb-1 text-[13px] font-semibold text-gray-900">Email</div>
        <div className="text-[13px] text-gray-600">
          {loading ? <Loader2 size={13} className="animate-spin" /> : user?.email || "Not signed in"}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="mb-1 text-[13px] font-semibold text-gray-900">Plan</div>
        <div className="text-[13px] text-gray-600">
          {planLoading ? <Loader2 size={13} className="animate-spin" /> : plan || "Free"}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-gray-900">Password</div>
            <div className="text-[12px] text-gray-500">Set a new password for your account.</div>
          </div>
          {!changingPassword && (
            <button
              onClick={() => setChangingPassword(true)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Change
            </button>
          )}
        </div>
        {changingPassword && (
          <div className="mt-2 space-y-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-black"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
              placeholder="Confirm new password"
              className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-black"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setChangingPassword(false);
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {saving ? "Saving..." : "Update password"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
