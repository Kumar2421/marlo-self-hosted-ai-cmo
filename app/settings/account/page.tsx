"use client";

import { useState, useEffect } from "react";
import { useAuthUser } from "@/lib/useAuthUser";
import { createClient } from "@/utils/supabase/client";
import { useToast } from "@/components/dashboard/Toast";
import { Loader2 } from "lucide-react";
import AppearanceSetting from "@/components/settings/AppearanceSetting";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, SettingsPageHeader } from "@/components/settings/ui";

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
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader title="Account & Security" caption="Manage your login and account protection." />

      <AppearanceSetting />

      <div className={`${CARD} mb-4 px-5 py-4`}>
        <div className="mb-1 text-[14px] font-semibold text-ui-text">Email</div>
        <div className="text-[13px] text-ui-muted">
          {loading ? <Loader2 size={13} className="animate-spin" /> : user?.email || "Not signed in"}
        </div>
      </div>

      <div className={`${CARD} mb-4 px-5 py-4`}>
        <div className="mb-1 text-[14px] font-semibold text-ui-text">Plan</div>
        <div className="text-[13px] text-ui-muted">
          {planLoading ? <Loader2 size={13} className="animate-spin" /> : plan || "Free"}
        </div>
      </div>

      <div className={`${CARD} mb-4 px-5 py-4`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-ui-text">Password</div>
            <div className="text-[13px] text-ui-muted">Set a new password for your account.</div>
          </div>
          {!changingPassword && (
            <button
              onClick={() => setChangingPassword(true)}
              className={BTN_SECONDARY}
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
              aria-label="New password"
              className={INPUT}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              className={INPUT}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setChangingPassword(false);
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className={BTN_GHOST}
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={saving}
                className={BTN_PRIMARY}
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
