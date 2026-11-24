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

  const auth = req.headers.get('Authorization') || '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user || user.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') {
    return Response.json({ error: 'Only the workspace admin can invite collaborators.' }, { status: 403, headers: cors });
  }

  let body: { action?: string; userId?: string; email?: string; role?: string; campaignId?: string | null; redirectTo?: string };
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400, headers: cors }); }

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (body.action === 'cancel_invitation') {
    const email = (body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'A valid email is required.' }, { status: 400, headers: cors });
    const { error } = await service.from('invitations').delete().ilike('email', email);
    if (error) return Response.json({ error: 'Could not clear invitation records.' }, { status: 500, headers: cors });
    return Response.json({ ok: true }, { headers: cors });
  }

  if (body.action === 'remove_collaborator') {
    const targetId = body.userId || '';
    if (!targetId || targetId === user.id) return Response.json({ error: 'Choose a valid collaborator account.' }, { status: 400, headers: cors });
    const [{ data: targetData, error: targetError }, { data: profile, error: profileError }] = await Promise.all([
      service.auth.admin.getUserById(targetId),
      service.from('profiles').select('role,email').eq('user_id', targetId).maybeSingle(),
    ]);
    const target = targetData?.user;
    if (targetError || !target) return Response.json({ error: 'That account could not be found.' }, { status: 404, headers: cors });
    if (profileError) return Response.json({ error: 'Could not verify the account role.' }, { status: 500, headers: cors });
    if (target.email?.toLowerCase() === 'charchit.sahoo@peoplehum.com' || profile?.role === 'owner') {
      return Response.json({ error: 'The workspace owner account cannot be removed here.' }, { status: 403, headers: cors });
    }

    // Preserve the teammate's work while removing their login and campaign access.
    for (const table of ['leads', 'companies']) {
      const { error } = await service.from(table).update({ user_id: user.id }).eq('user_id', targetId);
      if (error) return Response.json({ error: 'Could not preserve the account’s ' + table + ' before removal.' }, { status: 500, headers: cors });
    }
    const { error: creatorError } = await service.from('leads').update({ created_by: null }).eq('created_by', targetId);
    if (creatorError) return Response.json({ error: 'Run collaborator-management-migration.sql in Supabase, then retry. This keeps the creator name on leads while detaching the removed account.' }, { status: 500, headers: cors });
    const { error: campaignError } = await service.from('campaigns').update({ owner_id: user.id }).eq('owner_id', targetId);
    if (campaignError) return Response.json({ error: 'Could not transfer campaigns before removal.' }, { status: 500, headers: cors });
    const { error: memberError } = await service.from('campaign_members').delete().eq('user_id', targetId);
    if (memberError) return Response.json({ error: 'Could not revoke campaign access.' }, { status: 500, headers: cors });
    const { error: inviteError } = await service.from('invitations').delete().ilike('email', target.email || '');
    if (inviteError) return Response.json({ error: 'Could not clear invitations for this account.' }, { status: 500, headers: cors });
    const { error: deleteError } = await service.auth.admin.deleteUser(targetId);
    if (deleteError) return Response.json({ error: 'Campaign access was removed and work preserved, but Supabase could not delete the sign-in account. Try again.' }, { status: 500, headers: cors });
    return Response.json({ ok: true, email: target.email }, { headers: cors });
  }

  const email = (body.email || '').trim().toLowerCase();
  const role = body.role === 'viewer' ? 'viewer' : 'collaborator';
  const campaignId = body.campaignId || null;
  const appUrl = Deno.env.get('HANAMI_APP_URL');
  if (!resendKey) return Response.json({ error: 'Invitation email delivery is not configured.' }, { status: 503, headers: cors });
  if (!appUrl || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'A valid email and HANAMI_APP_URL are required.' }, { status: 400, headers: cors });
  }

  if (email === user.email?.toLowerCase()) return Response.json({ error: 'That is already your owner account.' }, { status: 200, headers: cors });
  const { data: existingProfile, error: profileLookupError } = await service.from('profiles').select('user_id').ilike('email', email).limit(1).maybeSingle();
  if (profileLookupError) return Response.json({ error: 'Could not check whether this person already has an account.' }, { status: 500, headers: cors });
  if (existingProfile) return Response.json({ error: 'This person already has a BerryLeads account. Use Team access to update their campaign access.' }, { status: 200, headers: cors });
  if (campaignId) {
    const { data: campaign, error: campaignError } = await service.from('campaigns').select('id').eq('id', campaignId).maybeSingle();
    if (campaignError || !campaign) return Response.json({ error: 'The selected campaign could not be found.' }, { status: 400, headers: cors });
  }
  const { error: clearPendingError } = await service.from('invitations').delete().ilike('email', email).eq('status', 'pending');
  if (clearPendingError) return Response.json({ error: 'Could not replace the older invitation.' }, { status: 500, headers: cors });
  const token = crypto.randomUUID() + crypto.randomUUID();
  const { error: insertError } = await service.from('invitations').insert({
    email, role, token, invited_by: user.email, invited_by_id: user.id,
    campaign_id: campaignId, status: 'pending', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (insertError) return Response.json({ error: 'Could not save invitation.' }, { status: 500, headers: cors });

  const inviteLink = `${appUrl.replace(/\/$/, '')}?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&from=${encodeURIComponent(user.user_metadata?.name || user.email || 'BerryLeads admin')}`;
  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('HANAMI_FROM_EMAIL') || 'BerryLeads <onboarding@resend.dev>',
      to: [email],
      subject: 'You are invited to BerryLeads',
      html: `<p>You have been invited to BerryLeads as a ${role}${campaignId ? ' for a specific campaign' : ' with access to current campaigns'}.</p><p><a href="${inviteLink}">Accept invitation and create your account</a></p><p>This link expires in 7 days. If you did not expect this invitation, you can ignore this email.</p>`,
    }),
  });
  if (!mail.ok) {
    await service.from('invitations').delete().eq('token', token);
    return Response.json({ error: 'Email provider could not send the invitation.' }, { status: 502, headers: cors });
  }
  return Response.json({ inviteLink }, { headers: cors });
});
