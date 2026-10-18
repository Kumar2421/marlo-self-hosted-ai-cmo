# Supabase auth email templates

Branded to match the Marlo sign-in and OTP screens. Paste each file into
Supabase Dashboard > Authentication > Emails > Templates, and set the subject below.
Templates use Supabase variables only: `{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`.

| Template file | Subject |
|---|---|
| confirm-signup.html | Your Marlo verification code |
| invite-user.html | You have been invited to Marlo |
| magic-link.html | Your Marlo sign-in code |
| change-email.html | Confirm your new email for Marlo |
| reset-password.html | Your Marlo password reset code |
| reauthentication.html | Your Marlo security code |

Notes
- The app signs up and resets passwords with the 6-digit code (`verifyOtp`), so Confirm signup and Reset password must keep `{{ .Token }}`.
- Invite user has no code in Supabase (link only).
- Emails use inline CSS and tables for Gmail/Outlook. Keep it that way if you edit them.
- Send them through custom SMTP (Resend) so they are actually delivered.
