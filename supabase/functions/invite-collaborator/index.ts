import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('HANAMI_APP_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return Response.json({ error: 'Invitation email delivery is not configured.' }, { status: 503, headers: cors });

  const auth = req.headers.get('Authorization') || '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user || user.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') {
    return Response.json({ error: 'Only the workspace admin can invite collaborators.' }, { status: 403, headers: cors });
  }

  let body: { email?: string; role?: string; campaignId?: string | null; redirectTo?: string };
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400, headers: cors }); }
  const email = (body.email || '').trim().toLowerCase();
  const role = body.role === 'viewer' ? 'viewer' : 'collaborator';
  const campaignId = body.campaignId || null;
  const appUrl = Deno.env.get('HANAMI_APP_URL');
  if (!appUrl || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'A valid email and HANAMI_APP_URL are required.' }, { status: 400, headers: cors });
  }

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (campaignId) {
    const { data: campaign, error: campaignError } = await service.from('campaigns').select('id').eq('id', campaignId).maybeSingle();
    if (campaignError || !campaign) return Response.json({ error: 'The selected campaign could not be found.' }, { status: 400, headers: cors });
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const { error: insertError } = await service.from('invitations').insert({
    email, role, token, invited_by: user.email, invited_by_id: user.id,
    campaign_id: campaignId, status: 'pending', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (insertError) return Response.json({ error: 'Could not save invitation.' }, { status: 500, headers: cors });

  const inviteLink = `${appUrl.replace(/\/$/, '')}?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&from=${encodeURIComponent(user.user_metadata?.name || user.email || 'Hanami admin')}`;
  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('HANAMI_FROM_EMAIL') || 'Hanami <onboarding@resend.dev>',
      to: [email],
      subject: 'You are invited to Hanami Lead Garden',
      html: `<p>You have been invited to Hanami Lead Garden as a ${role}${campaignId ? ' for a specific campaign' : ' with access to current campaigns'}.</p><p><a href="${inviteLink}">Accept invitation and create your account</a></p><p>This link expires in 7 days. If you did not expect this invitation, you can ignore this email.</p>`,
    }),
  });
  if (!mail.ok) {
    await service.from('invitations').delete().eq('token', token);
    return Response.json({ error: 'Email provider could not send the invitation.' }, { status: 502, headers: cors });
  }
  return Response.json({ inviteLink }, { headers: cors });
});
