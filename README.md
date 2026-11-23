# Hanami Lead Garden

Hanami is a static HTML lead tracker backed by Supabase Auth and Postgres. Authentication and invitation delivery require a one-time Supabase project setup.

## Production setup

1. In Supabase SQL Editor, run `supabase-setup.sql`. It removes the former anonymous and blanket access policies, gates new accounts to the admin email or a valid invitation, assigns the admin role only to `charchit.sahoo@peoplehum.com`, and applies team access policies.
2. Run `campaigns-migration.sql` in Supabase SQL Editor to add lead phone/email fields, campaign-scoped access, campaign membership on invitation acceptance, and a General campaign for existing unassigned leads. Deploy the updated invite function after this migration so invitations can be restricted to a campaign.
3. Run `campaign-privacy-access-migration.sql` in Supabase SQL Editor to add per-lead private/team visibility, immutable creator attribution, and row-level access rules. The Campaigns page can then grant or revoke campaign access for existing collaborators.
4. In Supabase Authentication, set the production site URL and add the deployed app URL to the allowed redirect URLs. Configure email confirmation and password reset email templates; use a verified SMTP provider for reliable delivery. The app requires passwords of at least 12 characters.
5. Deploy the Edge Function `supabase/functions/invite-collaborator` as `invite-collaborator`. Set function secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HANAMI_APP_URL` (the exact deployed app URL), `HANAMI_APP_ORIGIN` (the exact app origin), and optionally `HANAMI_FROM_EMAIL` (a verified sender in Resend). Keep the service-role key and Resend key only in function secrets.
6. Configure Resend with a verified sending domain and DNS records. Send an invitation from the owner account and verify the recipient can accept it, confirm their email, sign in, and reset their password.
7. Set a strong, unique password for the admin account through the sign-up flow if it does not exist yet, or use the password reset flow if it already exists. Do not reuse or publish a short password.

The admin account cannot be created or its password set from this repository: that requires access to your Supabase Auth project and email inbox. The designated email receives owner role when it registers; no password is stored in the app.

## Local run

Serve this directory over HTTP (not `file://`) so Supabase Auth redirects and browser storage work. `index.html` is the main entry point; `Hanami · lead garden.html` mirrors it for convenience.
