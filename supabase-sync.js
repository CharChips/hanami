/**
 * Supabase Synchronization & Authentication for Hanami Lead Garden
 * Supports User Authentication, Multi-user Roles (Owner, Collaborator, Viewer),
 * and Cloud Database Sync.
 */

const DEFAULT_SUPABASE_URL = 'https://eqabcpjqmklnwbzeydnp.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_u8Zl-k6gpsYxVfT4oh-qSw_rFq5LTdB';

function getSupabaseConfig() {
  const url = (localStorage.getItem('hanami_supabase_url') || DEFAULT_SUPABASE_URL).trim();
  const key = (localStorage.getItem('hanami_supabase_key') || DEFAULT_SUPABASE_ANON_KEY).trim();
  return { url, key };
}

function saveSupabaseConfig(url, key) {
  if (url) localStorage.setItem('hanami_supabase_url', url.trim());
  if (key) localStorage.setItem('hanami_supabase_key', key.trim());
}

function resetSupabaseConfig() {
  localStorage.removeItem('hanami_supabase_url');
  localStorage.removeItem('hanami_supabase_key');
}

class HanamiSupabaseSync {
  constructor() {
    this.client = null;
    this.user = null;
    this.userRole = 'owner'; // 'owner', 'collaborator', 'viewer'
    this.isGuest = false;
    this.isInitialized = false;
    this.leadSnap = new Map();
    this.companySnap = new Map();
    this.caps = {
      leadsLog: false,
      leadsCampaign: false,
      leadPrivacy: false,
      leadContacts: false,
      companiesLog: false,
      companiesDone: false,
      companiesCampaign: false,
      profilesToday: false,
      profilesRole: false
    };
  }

  async init() {
    if (!window.supabase) {
      console.warn('Supabase JS library not loaded.');
      this.showApp();
      return;
    }

    const { url, key } = getSupabaseConfig();

    try {
      this.client = window.supabase.createClient(url, key);
      this.bindAuthUI();
      this.bindInviteUI();
      const recoveryHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const recoveryQuery = new URLSearchParams(window.location.search);
      this.recoveryMode = recoveryHash.get('type') === 'recovery' || recoveryQuery.get('type') === 'recovery';

      // Register before getSession so a recovery callback cannot be missed during initialization.
      this.client.auth.onAuthStateChange(async (event, newSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          this.recoveryMode = true;
          this.user = newSession?.user || this.user;
          this.showPasswordRecoveryPage();
        } else if (event === 'SIGNED_IN' && newSession) {
          this.user = newSession.user;
          this.userRole = 'collaborator';
          this.isGuest = false;
          if (this.recoveryMode) {
            this.showPasswordRecoveryPage();
            return;
          }
          this.showApp();
          toast('Welcome, ' + (this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email));
          await this.detectCapabilities();
          await this.loadAll();
        } else if (event === 'SIGNED_OUT') {
          this.user = null;
          this.userRole = 'owner';
          this.isGuest = false;
          this.recoveryMode = false;
          leads = [];
          cos = [];
          game = { xp: 0, streak: 0 };
          this.leadSnap.clear();
          this.companySnap.clear();
          this.showAuthPage();
          if (typeof render === 'function') render();
        }
      });

      // Check if URL contains an invitation link (?invite=TOKEN)
      if (this.checkInviteUrl()) {
        this.showAuthPage();
        return;
      }

      // Never trust browser-stored demo identities as authenticated sessions.
      localStorage.removeItem('hanami_active_user');

      // Check existing Supabase session
      const { data: { session }, error: sessionError } = await this.client.auth.getSession();

      if (!sessionError && session && session.user) {
        this.user = session.user;
        this.userRole = 'collaborator';
        if (this.recoveryMode) {
          this.showPasswordRecoveryPage();
        } else {
          this.showApp();
          await this.detectCapabilities();
          await this.loadAll();
        }
      } else {
        // No active session: show login screen
        if (this.recoveryMode) {
          this.showPasswordRecoveryPage();
          this.setAuthAlert('This reset link may have expired. Request a fresh link and open the newest email.', true);
        } else {
          this.showAuthPage();
        }
        await this.detectCapabilities();
      }

      // Subscribe to Realtime database changes
      this.subscribeRealtime();
      this.isInitialized = true;
    } catch (err) {
      console.error('Supabase initialization error:', err);
      this.showAuthPage();
    }
  }

  // --- UI BINDINGS & AUTH PAGE ---

  bindAuthUI() {
    // Mascot on auth page
    const authMascot = document.getElementById('authMascot');
    if (authMascot && typeof bunny === 'function') {
      authMascot.innerHTML = bunny('hi', 64);
    }

    // Tabs
    const tabIn = document.getElementById('tabSignInBtn');
    const tabUp = document.getElementById('tabSignUpBtn');
    const tabForgot = document.getElementById('tabForgotBtn');
    const formIn = document.getElementById('signInForm');
    const formUp = document.getElementById('signUpForm');
    const formForgot = document.getElementById('forgotForm');
    const formRecovery = document.getElementById('passwordRecoveryForm');
    const alertBox = document.getElementById('authAlert');

    const switchTab = (activeTab, activeForm) => {
      [tabIn, tabUp, tabForgot].forEach(t => t && t.classList.remove('on'));
      [formIn, formUp, formForgot, formRecovery].forEach(f => f && (f.style.display = 'none'));
      if (activeTab) activeTab.classList.add('on');
      if (activeForm) activeForm.style.display = 'flex';
      if (alertBox) alertBox.style.display = 'none';
    };

    if (tabIn) tabIn.onclick = () => switchTab(tabIn, formIn);
    if (tabUp) tabUp.onclick = () => switchTab(tabUp, formUp);
    if (tabForgot) tabForgot.onclick = () => switchTab(tabForgot, formForgot);

    const linkForgot = document.getElementById('linkForgot');
    if (linkForgot) {
      linkForgot.onclick = (e) => {
        e.preventDefault();
        switchTab(tabForgot, formForgot);
      };
    }

    const linkBackToSignIn = document.getElementById('linkBackToSignIn');
    if (linkBackToSignIn) {
      linkBackToSignIn.onclick = (e) => {
        e.preventDefault();
        switchTab(tabIn, formIn);
      };
    }

    // Password visibility toggles
    document.querySelectorAll('.pw-toggle').forEach(btn => {
      btn.onclick = () => {
        const targetId = btn.dataset.for;
        const input = document.getElementById(targetId);
        if (input) {
          const isPw = input.type === 'password';
          input.type = isPw ? 'text' : 'password';
          btn.textContent = isPw ? '🙈' : '👁️';
        }
      };
    });

    // Populate Supabase Settings in Auth Screen
    const cfgUrlInput = document.getElementById('cfgSbUrl');
    const cfgKeyInput = document.getElementById('cfgSbKey');
    const curCfg = getSupabaseConfig();
    if (cfgUrlInput) cfgUrlInput.value = curCfg.url;
    if (cfgKeyInput) cfgKeyInput.value = curCfg.key;

    // Test Supabase Connection Button
    const btnTestSb = document.getElementById('btnTestSb');
    const testResult = document.getElementById('sbTestResult');
    if (btnTestSb) {
      btnTestSb.onclick = async () => {
        const testUrl = (cfgUrlInput?.value || '').trim();
        const testKey = (cfgKeyInput?.value || '').trim();
        if (!testUrl || !testKey) {
          if (testResult) {
            testResult.style.display = 'block';
            testResult.className = 'banner err';
            testResult.textContent = 'Please provide both URL and Anon Key.';
          }
          return;
        }

        btnTestSb.disabled = true;
        btnTestSb.textContent = 'Testing…';
        if (testResult) {
          testResult.style.display = 'block';
          testResult.className = 'banner';
          testResult.textContent = 'Contacting Supabase endpoint…';
        }

        const res = await this.testConnection(testUrl, testKey);
        btnTestSb.disabled = false;
        btnTestSb.textContent = 'Test Connection';

        if (testResult) {
          testResult.style.display = 'block';
          testResult.className = 'banner ' + (res.ok ? 'ok' : 'err');
          testResult.textContent = res.ok
            ? '✓ Connection successful! Supabase API is responding.'
            : `✕ Connection failed: ${res.error}`;
        }
      };
    }

    // Save & Reconnect Supabase Button
    const btnSaveSb = document.getElementById('btnSaveSb');
    if (btnSaveSb) {
      btnSaveSb.onclick = async () => {
        const newUrl = (cfgUrlInput?.value || '').trim();
        const newKey = (cfgKeyInput?.value || '').trim();
        if (!newUrl || !newKey) {
          toast('Please enter both Supabase URL and Key');
          return;
        }
        saveSupabaseConfig(newUrl, newKey);
        toast('Supabase settings saved! Reconnecting…');
        setTimeout(() => window.location.reload(), 600);
      };
    }

    // Reset Supabase Settings Button
    const btnResetSb = document.getElementById('btnResetSb');
    if (btnResetSb) {
      btnResetSb.onclick = () => {
        resetSupabaseConfig();
        const def = getSupabaseConfig();
        if (cfgUrlInput) cfgUrlInput.value = def.url;
        if (cfgKeyInput) cfgKeyInput.value = def.key;
        toast('Reset to default Supabase project credentials');
      };
    }

    // Sign In Submit
    if (formIn) {
      formIn.onsubmit = async (e) => {
        e.preventDefault();
        const email = (document.getElementById('loginEmail')?.value || '').trim();
        const pass = document.getElementById('loginPassword')?.value || '';
        const btn = document.getElementById('btnSignInSubmit');
        if (!email || !pass) return;

        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
        this.setAuthAlert('', false);

        const res = await this.signIn(email, pass);
        if (btn) { btn.disabled = false; btn.textContent = 'Sign In to My Garden'; }

        if (res.error) {
          const msg = res.error.friendly || res.error.message || 'Login failed. Please check your credentials.';
          this.setAuthAlert(msg, true);
        }
      };
    }

    // Sign Up Submit
    if (formUp) {
      formUp.onsubmit = async (e) => {
        e.preventDefault();
        const name = (document.getElementById('signupName')?.value || '').trim();
        const email = (document.getElementById('signupEmail')?.value || '').trim();
        const pass = document.getElementById('signupPassword')?.value || '';
        const role = 'collaborator';
        const btn = document.getElementById('btnSignUpSubmit');
        if (!name || !email || !pass) return;

        if (pass.length < 12) {
          this.setAuthAlert('Choose a password with at least 12 characters.', true);
          return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
        this.setAuthAlert('', false);

        const res = await this.signUp(email, pass, name, role);
        if (btn) { btn.disabled = false; btn.textContent = 'Create Account & Start Garden'; }

        if (res.error) {
          const msg = res.error.friendly || res.error.message || 'Could not create account.';
          this.setAuthAlert(msg, true);
        } else if (res.data && !res.data.session) {
          // Email confirmation is required by Supabase settings
          this.setAuthAlert('Account created. Check your email to verify it, then sign in.', false, true);
          if (tabIn) tabIn.click();
          const inEmail = document.getElementById('loginEmail');
          if (inEmail) inEmail.value = email;
        } else if (res.data && res.data.session) {
          toast(`Account created as ${role}! Welcome to Hanami.`);
        }
      };
    }

    // Password Reset Submit
    if (formForgot) {
      formForgot.onsubmit = async (e) => {
        e.preventDefault();
        const email = (document.getElementById('forgotEmail')?.value || '').trim();
        const btn = document.getElementById('btnForgotSubmit');
        if (!email) return;

        if (btn) { btn.disabled = true; btn.textContent = 'Sending link…'; }
        this.setAuthAlert('', false);

        const res = await this.resetPassword(email);
        if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Instructions'; }

        if (res.error) {
          this.setAuthAlert(res.error.message || 'Could not send reset email.', true);
        } else {
          this.setAuthAlert('✓ Password reset link sent! Check your inbox for instructions.', false, true);
        }
      };
    }

    if (formRecovery) {
      formRecovery.onsubmit = async (e) => {
        e.preventDefault();
        const password = document.getElementById('recoveryPassword')?.value || '';
        const confirm = document.getElementById('recoveryPasswordConfirm')?.value || '';
        const btn = document.getElementById('btnSaveNewPassword');
        if (password.length < 12) {
          this.setAuthAlert('Choose a password with at least 12 characters.', true);
          return;
        }
        if (password !== confirm) {
          this.setAuthAlert('The passwords do not match. Please check both fields.', true);
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Saving password…'; }
        this.setAuthAlert('', false);
        const { data, error } = await this.client.auth.updateUser({ password });
        if (btn) { btn.disabled = false; btn.textContent = 'Save new password'; }
        if (error) {
          this.setAuthAlert(error.message || 'Could not update your password. Request a new reset link and try again.', true);
          return;
        }
        this.user = data?.user || this.user;
        this.recoveryMode = false;
        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
        document.getElementById('recoveryPassword').value = '';
        document.getElementById('recoveryPasswordConfirm').value = '';
        this.showApp();
        await this.detectCapabilities();
        await this.loadAll();
        toast('Password updated. You are now signed in.');
      };
    }
    document.getElementById('btnBackFromRecovery')?.addEventListener('click', async () => {
      this.recoveryMode = false;
      try { await this.client.auth.signOut(); } catch (e) {}
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
      const tabs = document.querySelector('#authPage .auth-tab')?.parentElement;
      if (tabs) tabs.style.display = 'flex';
      if (formRecovery) formRecovery.style.display = 'none';
      if (tabIn) tabIn.click();
      this.showAuthPage();
    });

    ['btnQuickOwner','btnQuickCollab','btnQuickViewer','btnGuest'].forEach(id => document.getElementById(id)?.remove());

    // Logout Button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = () => this.signOut();
    }
  }

  // --- COLLABORATOR INVITATION WORKFLOW ---

  checkInviteUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return false;

    const email = params.get('email') || '';
    const role = 'collaborator';
    const from = params.get('from') || 'Charchit';

    const card = document.getElementById('acceptInviteCard');
    const tabs = document.querySelector('#authPage .auth-tab')?.parentElement;
    const signInForm = document.getElementById('signInForm');
    const signUpForm = document.getElementById('signUpForm');
    const forgotForm = document.getElementById('forgotForm');
    const quickBox = document.getElementById('btnQuickOwner')?.parentElement?.parentElement;
    const whoSpan = document.getElementById('invFromWho');
    const emailInput = document.getElementById('invAcceptEmail');
    const form = document.getElementById('acceptInviteForm');
    const resendConfirmationBtn = document.getElementById('btnResendInviteConfirmation');

    if (tabs) tabs.style.display = 'none';
    if (signInForm) signInForm.style.display = 'none';
    if (signUpForm) signUpForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'none';
    if (quickBox) quickBox.style.display = 'none';
    if (card) card.style.display = 'flex';
    if (whoSpan) whoSpan.textContent = from;
    if (emailInput) emailInput.value = email;

    if (resendConfirmationBtn) {
      resendConfirmationBtn.style.display = 'none';
      resendConfirmationBtn.onclick = async () => {
        resendConfirmationBtn.disabled = true;
        resendConfirmationBtn.textContent = 'Sending…';
        const redirectTo = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
        const { error } = await this.client.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: redirectTo }
        });
        resendConfirmationBtn.disabled = false;
        resendConfirmationBtn.textContent = 'Resend verification email';
        if (error) {
          this.setAuthAlert(error.message || 'Could not resend the verification email.', true);
        } else {
          this.setAuthAlert('Verification email sent. Check your inbox and spam folder.', false, true);
        }
      };
    }

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const name = (document.getElementById('invAcceptName')?.value || '').trim();
        const userEmail = (document.getElementById('invAcceptEmail')?.value || email || '').trim();
        const pass = document.getElementById('invAcceptPassword')?.value || '';
        const btn = document.getElementById('btnAcceptInviteSubmit');

        if (!name || !pass) {
          toast('Please enter your name and choose a password');
          return;
        }

        if (pass.length < 12) {
          toast('Choose a password with at least 12 characters.');
          return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Joining garden…'; }

        // An invitation may be opened in the owner's already-authenticated browser.
        // Clear that different account before signup so the existing session cannot
        // be mistaken for the invited collaborator's session.
        const currentSession = (await this.client.auth.getSession())?.data?.session;
        if (currentSession?.user?.email?.toLowerCase() !== userEmail.toLowerCase()) {
          await this.client.auth.signOut({ scope: 'local' });
          this.user = null;
        }

        // 1. Create an account for the invited email using the server-stored role.
        // The database signup trigger validates this token and applies the invited
        // role. Read access to invitations is intentionally limited to authenticated users.
        let authRes = await this.signUp(userEmail, pass, name, 'collaborator', token);
        const createdNewAccount = !authRes.error && Boolean(authRes.data?.user);

        if (!authRes.error && authRes.data?.user && !authRes.data?.session) {
          this.setAuthAlert('Account created. Check your email to verify it, then sign in.', false, true);
          if (resendConfirmationBtn) resendConfirmationBtn.style.display = 'block';
          if (btn) { btn.disabled = false; btn.textContent = 'Set Password & View All Leads'; }
          return;
        }

        // 2. If user already registered, log in directly
        if (authRes.error && authRes.error.message && authRes.error.message.toLowerCase().includes('already registered')) {
          authRes = await this.signIn(userEmail, pass);
        }

        // 3. If signed up successfully but session not established, sign in
        const activeSession = this.client ? (await this.client.auth.getSession())?.data?.session : null;
        if (!authRes.error && activeSession?.user?.email?.toLowerCase() !== userEmail.toLowerCase()) {
          if (activeSession) await this.client.auth.signOut({ scope: 'local' });
          authRes = await this.signIn(userEmail, pass);
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Set Password & View All Leads'; }

        if (authRes.error) {
          const msg = authRes.error.friendly || authRes.error.message || 'Could not complete registration';
          if ((authRes.error.message || '').toLowerCase().includes('email not confirmed') && resendConfirmationBtn) {
            resendConfirmationBtn.style.display = 'block';
            this.setAuthAlert('This account still needs email verification. Click below to send the confirmation email again.', true);
            return;
          }
          this.setAuthAlert(msg, true);
          toast(msg);
        } else {
          // Success! User is authenticated
          const curUser = (await this.client?.auth.getUser())?.data?.user || authRes.data?.user;
          if (!curUser || curUser.email?.toLowerCase() !== userEmail.toLowerCase()) {
            this.setAuthAlert('The signed-in account does not match this invitation. Sign in with the invited email.', true);
            return;
          }
          this.user = curUser;

          // Only read the invitation after authentication, when its email-bound
          // RLS policy permits the invited user to see it.
          const invitation = await this.client.from('invitations').select('id, role, expires_at, status')
            .eq('token', token).eq('email', userEmail.toLowerCase()).in('status', ['pending', 'accepted']).maybeSingle();
          if (invitation.error || !invitation.data || (invitation.data.status === 'pending' && new Date(invitation.data.expires_at) < new Date())) {
            this.setAuthAlert('This invitation is invalid or expired. Ask an admin to send a new one.', true);
            return;
          }
          this.userRole = invitation.data.role;
          this.isGuest = false;

          if (invitation.data.status === 'pending') {
            const { error: acceptError } = await this.client.from('invitations')
              .update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invitation.data.id);
            if (acceptError) {
              this.setAuthAlert('Your account is signed in, but the invitation could not be accepted. Ask the admin to resend it.', true);
              return;
            }
          }

          // Clean URL
          window.history.replaceState(null, '', window.location.pathname);

          if (createdNewAccount) {
            // The invite link already proved mailbox access. Let the collaborator
            // sign in explicitly after setting their password, without a second
            // confirmation email.
            await this.client.auth.signOut({ scope: 'local' });
            const tabs = document.querySelector('#authPage .auth-tab')?.parentElement;
            const acceptCard = document.getElementById('acceptInviteCard');
            const resendBtn = document.getElementById('btnResendInviteConfirmation');
            if (tabs) tabs.style.display = 'flex';
            if (acceptCard) acceptCard.style.display = 'none';
            if (resendBtn) resendBtn.style.display = 'none';
            document.getElementById('tabSignInBtn')?.click();
            this.showAuthPage();
            const loginEmail = document.getElementById('loginEmail');
            if (loginEmail) loginEmail.value = userEmail;
            this.setAuthAlert('Your account is ready. Sign in with your email and password.', false, true);
            return;
          }

          // Show the app and load all leads!
          this.showApp();
          await this.loadAll();
          toast(`Welcome ${name}! All leads loaded.`);
        }
      };
    }
    return true;
  }

  bindInviteUI() {
    const inviteBtn = document.getElementById('inviteBtn');
    const closeBtn = document.getElementById('closeInviteModal');
    const modal = document.getElementById('inviteModal');
    const form = document.getElementById('inviteForm');
    const btnCopy = document.getElementById('btnCopyInviteLink');

    if (inviteBtn) {
      inviteBtn.onclick = () => this.openInviteModal();
    }
    if (closeBtn) {
      closeBtn.onclick = () => this.closeInviteModal();
    }
    if (modal) {
      modal.onclick = (e) => {
        if (e.target.id === 'inviteModal') this.closeInviteModal();
      };
    }

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = (document.getElementById('invEmail')?.value || '').trim();
        const role = document.getElementById('invRole')?.value || 'collaborator';
        const campaignId = document.getElementById('invCampaign')?.value || null;
        const btn = document.getElementById('btnSendInvite');
        if (!email) return;

        if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
        await this.createInvitation(email, role, campaignId);
        if (btn) { btn.disabled = false; btn.textContent = 'Generate Invitation Link'; }
      };
    }

    if (btnCopy) {
      btnCopy.onclick = () => {
        const input = document.getElementById('invLinkInput');
        if (input) {
          input.select();
          navigator.clipboard.writeText(input.value);
          toast('✓ Invitation link copied to clipboard!');
        }
      };
    }
  }

  async openInviteModal() {
    if (this.user?.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') {
      toast('Only the workspace admin can invite collaborators.');
      return;
    }
    const modal = document.getElementById('inviteModal');
    if (modal) modal.style.display = 'flex';
    const campaignSelect = document.getElementById('invCampaign');
    if (campaignSelect) campaignSelect.innerHTML = '<option value="">All current campaigns</option>' + campaigns.map(c => '<option value="' + String(c.id).replace(/[&<>\"]/g, '') + '">' + String(c.name).replace(/[&<>\"]/g, '') + '</option>').join('');
    await this.loadInvitations();
  }

  closeInviteModal() {
    const modal = document.getElementById('inviteModal');
    if (modal) modal.style.display = 'none';
  }

  async createInvitation(email, role, campaignId = null) {
    const senderName = this.user?.user_metadata?.name || this.user?.email || 'Charchit';
    try {
    if (!this.client || !this.user) throw new Error('Sign in to invite collaborators.');
    if (this.user.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') throw new Error('Only the workspace admin can invite collaborators.');
    const { data, error } = await this.client.functions.invoke('invite-collaborator', {
      body: { email: email.toLowerCase(), role, campaignId, redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
    const inviteLink = data?.inviteLink;
    if (!inviteLink) throw new Error(data?.error || 'Invitation email was not sent.');

    const resBox = document.getElementById('inviteResult');
    const targetEmail = document.getElementById('invTargetEmail');
    const linkInput = document.getElementById('invLinkInput');
    const emailLink = document.getElementById('btnSendEmailDirect');

    if (resBox) resBox.style.display = 'block';
    if (targetEmail) targetEmail.textContent = email;
    if (linkInput) linkInput.value = inviteLink;

    if (emailLink) { emailLink.removeAttribute('href'); emailLink.textContent = '✓ Invitation email sent'; emailLink.style.pointerEvents = 'none'; }

    toast(`Invitation email sent to ${email}`);
    await this.loadInvitations();
    } catch (err) {
      const message = err.message || 'Could not send invitation.';
      toast(message);
      this.setAuthAlert(message, true);
    }
  }

  async loadInvitations() {
    const list = document.getElementById('invList');
    if (!list) return;

    if (!this.client) {
      list.innerHTML = `<div class="meta" style="font-size:12px">No sent invitations yet.</div>`;
      return;
    }

    try {
      const { data, error } = await this.client
        .from('invitations')
        .select('email, role, status, created_at')
        .eq('invited_by_id', this.user?.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error || !data || !data.length) {
        list.innerHTML = `<div class="meta" style="font-size:12px">No pending invitations yet.</div>`;
        return;
      }

      list.innerHTML = data.map(inv => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--card);border:1px solid var(--line);border-radius:8px;font-size:12px">
          <div>
            <b>${inv.email}</b>
            <span class="role-badge role-${inv.role}" style="font-size:9.5px;padding:1px 5px;margin-left:4px">${inv.role.toUpperCase()}</span>
          </div>
          <span style="font-size:11px;font-weight:600;color:${inv.status === 'accepted' ? 'var(--leaf)' : 'var(--warn)'}">
            ${inv.status === 'accepted' ? '✓ Joined' : '⏳ Pending'}
          </span>
        </div>
      `).join('');
    } catch(e) {
      list.innerHTML = `<div class="meta" style="font-size:12px">No pending invitations.</div>`;
    }
  }

  setAuthAlert(msg, isError = false, isSuccess = false) {
    const alertBox = document.getElementById('authAlert');
    if (!alertBox) return;
    if (!msg) {
      alertBox.style.display = 'none';
      return;
    }
    alertBox.textContent = msg;
    alertBox.className = 'banner ' + (isError ? 'err' : isSuccess ? 'ok' : '');
    alertBox.style.display = 'block';
  }

  showAuthPage() {
    const authPage = document.getElementById('authPage');
    const app = document.getElementById('app');
    const logoutBtn = document.getElementById('logoutBtn');
    if (authPage) authPage.style.display = 'flex';
    if (app) app.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }

  showPasswordRecoveryPage() {
    const authPage = document.getElementById('authPage');
    const app = document.getElementById('app');
    const tabs = document.querySelector('#authPage .auth-tab')?.parentElement;
    const logoutBtn = document.getElementById('logoutBtn');
    ['signInForm', 'signUpForm', 'forgotForm', 'acceptInviteCard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (tabs) tabs.style.display = 'none';
    const form = document.getElementById('passwordRecoveryForm');
    if (form) form.style.display = 'flex';
    if (authPage) authPage.style.display = 'flex';
    if (app) app.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }

  showApp() {
    const authPage = document.getElementById('authPage');
    const app = document.getElementById('app');
    const logoutBtn = document.getElementById('logoutBtn');
    if (authPage) authPage.style.display = 'none';
    if (app) app.style.display = 'flex';
    if (logoutBtn) logoutBtn.style.display = this.user ? 'inline-block' : 'none';
    this.updateUserBadge();
  }

  continueAsGuest() {
    this.isGuest = true;
    this.user = null;
    this.userRole = 'guest';
    this.showApp();
    toast('Using Hanami as Guest (device-only storage)');
    mode = 'device';
    try { leads = JSON.parse(localStorage.getItem('hanami') || '[]'); } catch(e){}
    try { cos = JSON.parse(localStorage.getItem('hanami_co') || '[]'); } catch(e){}
    try { const g = JSON.parse(localStorage.getItem('hanami_game') || 'null'); if (g) game = g; } catch(e){}
    if (typeof baseline === 'function') baseline();
    if (typeof render === 'function') render();
  }

  updateUserBadge() {
    const avt = document.getElementById('avt');
    const wsname = document.getElementById('wsname');
    const sbBtn = document.getElementById('supabaseBtn');
    const roleBadge = document.getElementById('userRoleBadge');

    if (this.user) {
      const isCharchit = this.user.email && this.user.email.toLowerCase() === 'charchit.sahoo@peoplehum.com';
      const name = isCharchit ? 'Charchit' : (this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email.split('@')[0]);
      const initials = name.slice(0, 2).toUpperCase();
      const role = this.userRole || this.user.user_metadata?.role || 'owner';
      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

      if (avt) avt.textContent = initials;
      if (wsname) {
        wsname.textContent = isCharchit || role === 'owner' ? `${name}’s garden` : `Charchit’s garden`;
      }
      if (roleBadge) {
        roleBadge.textContent = roleLabel;
        roleBadge.className = 'role-badge role-' + role;
        roleBadge.style.display = 'inline-flex';
      }
      const inviteBtn = document.getElementById('inviteBtn');
      if (inviteBtn) inviteBtn.style.display = isCharchit ? 'inline-flex' : 'none';
      if (sbBtn) {
        sbBtn.style.color = 'var(--leaf)';
        sbBtn.title = `Supabase: Connected as ${this.user.email} (${roleLabel})`;
      }
    } else {
      if (avt) avt.textContent = 'H';
      if (wsname) wsname.textContent = 'My garden';
      if (roleBadge) {
        roleBadge.textContent = 'Guest';
        roleBadge.className = 'role-badge role-guest';
        roleBadge.style.display = 'inline-flex';
      }
      if (sbBtn) {
        sbBtn.style.color = 'var(--mute)';
        sbBtn.title = 'Supabase: Guest mode';
      }
    }
  }

  // --- CAPABILITIES DETECTION ---

  async detectCapabilities() {
    if (!this.client) return;
    try {
      const { error } = await this.client.from('leads').select('log').limit(1);
      this.caps.leadsLog = !error;
    } catch (e) { this.caps.leadsLog = false; }

    try {
      const { error } = await this.client.from('leads').select('campaign_id').limit(1);
      this.caps.leadsCampaign = !error;
    } catch (e) { this.caps.leadsCampaign = false; }

    try {
      const { error } = await this.client.from('leads').select('created_by,created_by_name,visibility').limit(1);
      this.caps.leadPrivacy = !error;
    } catch (e) { this.caps.leadPrivacy = false; }

    try {
      const { error } = await this.client.from('leads').select('email,phone').limit(1);
      this.caps.leadContacts = !error;
    } catch (e) { this.caps.leadContacts = false; }

    try {
      const { error } = await this.client.from('companies').select('log').limit(1);
      this.caps.companiesLog = !error;
    } catch (e) { this.caps.companiesLog = false; }

    try {
      const { error } = await this.client.from('companies').select('done').limit(1);
      this.caps.companiesDone = !error;
    } catch (e) { this.caps.companiesDone = false; }

    try {
      const { error } = await this.client.from('companies').select('campaign_id').limit(1);
      this.caps.companiesCampaign = !error;
    } catch (e) { this.caps.companiesCampaign = false; }

    try {
      const { error } = await this.client.from('profiles').select('today').limit(1);
      this.caps.profilesToday = !error;
    } catch (e) { this.caps.profilesToday = false; }

    try {
      const { error } = await this.client.from('profiles').select('role').limit(1);
      this.caps.profilesRole = !error;
    } catch (e) { this.caps.profilesRole = false; }
  }

  async loadAll() {
    mode = 'cloud';
    await Promise.all([
      this.loadProfile(),
      this.loadCampaigns(),
      this.loadLeads(),
      this.loadCompanies(),
      this.loadLeaderboard()
    ]);
    if (typeof baseline === 'function') baseline();
    if (typeof render === 'function') render();
    this.updateUserBadge();
  }

  async loadCampaigns() {
    if (!this.client) return;
    try {
      const { data, error } = await this.client.from('campaigns').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      campaigns = data || [];
      try { localStorage.setItem('hanami_campaigns', JSON.stringify(campaigns)); } catch (e) {}
      if (typeof render === 'function') render();
    } catch (err) { console.warn('Campaigns are not available yet:', err.message); }
  }

  async saveCampaign(campaign) {
    if (!this.client || !this.user) return;
    const { error } = await this.client.from('campaigns').upsert({
      id: campaign.id, name: campaign.name, description: campaign.description || null,
      status: campaign.status || 'active', owner_id: this.user.id
    }, { onConflict: 'id' });
    if (error) { campaigns = campaigns.filter(c => c.id !== campaign.id); try { localStorage.setItem('hanami_campaigns', JSON.stringify(campaigns)); } catch (e) {} toast('Could not save campaign: ' + error.message); render(); }
  }

  async loadCampaignAccess(campaignId) {
    if (!this.client || this.user?.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') return { profiles: [], members: [] };
    const [profilesResult, membersResult] = await Promise.all([
      this.client.from('profiles').select('user_id,email,nickname,role').order('nickname', { ascending: true }),
      this.client.from('campaign_members').select('user_id,role').eq('campaign_id', campaignId)
    ]);
    if (profilesResult.error || membersResult.error) {
      toast('Could not load campaign access: ' + (profilesResult.error || membersResult.error).message);
      return { profiles: [], members: [] };
    }
    return {
      profiles: (profilesResult.data || []).filter(p => p.user_id !== this.user.id && p.role !== 'owner'),
      members: membersResult.data || []
    };
  }

  async setCampaignMember(campaignId, userId, allowed, role = 'collaborator') {
    if (!this.client || this.user?.email?.toLowerCase() !== 'charchit.sahoo@peoplehum.com') {
      throw new Error('Only the workspace admin can change campaign access.');
    }
    const result = allowed
      ? await this.client.from('campaign_members').upsert({ campaign_id: campaignId, user_id: userId, role: role === 'viewer' ? 'viewer' : 'collaborator' }, { onConflict: 'campaign_id,user_id' })
      : await this.client.from('campaign_members').delete().eq('campaign_id', campaignId).eq('user_id', userId);
    if (result.error) {
      toast('Could not update campaign access: ' + result.error.message);
      return false;
    }
    toast(allowed ? 'Campaign access updated.' : 'Campaign access removed.');
    return true;
  }

  // --- LEADS ---

  async loadLeads() {
    if (!this.client) return;
    try {
      // Both Owner and Collaborators access all shared garden leads
      let query = this.client.from('leads').select('*').order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) {
        this.handleError(error, 'loading leads');
        return;
      }
      if (data) {
        leads = data.map(row => this.rowToLead(row));
        this.leadSnap.clear();
        leads.forEach(l => this.leadSnap.set(l.id, JSON.stringify(l)));
        try { localStorage.setItem('hanami', JSON.stringify(leads)); } catch (e) {}
        if (typeof render === 'function') render();
      }
    } catch (err) {
      console.error('Error loading leads:', err);
    }
  }

  rowToLead(row) {
    let status = String(row.status || 'spotted').toLowerCase().trim();
    if (['new', 'open', 'lead', 'pending'].includes(status)) status = 'spotted';
    else if (['contacted', 'reached out', 'in_progress', 'working'].includes(status)) status = 'reached';
    else if (['followup', 'follow_up', 'call_back', 'call-back'].includes(status)) status = 'callback';
    else if (['closed', 'won', 'demo_booked', 'demo booked'].includes(status)) status = 'demo';
    else if (['lost', 'archive', 'archived', 'trash'].includes(status)) status = 'dropped';
    if (typeof ST !== 'undefined' && !ST[status]) status = 'spotted';

    return {
      id: String(row.id || (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2, 9))),
      name: row.name || 'Unnamed profile',
      link: row.linkedin_url || '',
      role: row.role || '',
      country: row.country || '',
      email: row.email || '',
      phone: row.phone || '',
      status: status,
      due: row.due || '',
      next: row.next_step || '',
      note: row.note || '',
      hot: !!row.hot,
      pic: row.photo || '',
      campaignId: row.campaign_id || null,
      visibility: row.visibility || 'team',
      createdBy: row.created_by || null,
      createdByName: row.created_by_name || (row.created_by ? 'Team member' : 'Before tracking'),
      log: Array.isArray(row.log) ? row.log : [],
      created: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    };
  }

  leadToRow(l) {
    const row = {
      id: l.id,
      name: l.name || 'Unnamed profile',
      linkedin_url: l.link || null,
      role: l.role || null,
      country: l.country || null,
      email: l.email || null,
      phone: l.phone || null,
      status: l.status || 'spotted',
      due: l.due || null,
      next_step: l.next || null,
      note: l.note || null,
      hot: !!l.hot,
      photo: l.pic || null
    };
    if (this.caps.leadPrivacy) {
      row.visibility = l.visibility === 'private' ? 'private' : 'team';
      row.created_by = l.createdBy || this.user?.id || null;
      row.created_by_name = l.createdByName || this.user?.user_metadata?.nickname || this.user?.user_metadata?.name || this.user?.email?.split('@')[0] || 'Team member';
    }
    if (this.user) {
      row.user_id = this.user.id;
    }
    if (this.caps.leadsLog && l.log) {
      row.log = l.log;
    }
    if (this.caps.leadsCampaign && l.campaignId) {
      row.campaign_id = l.campaignId;
    }
    return row;
  }

  async syncLeads() {
    if (!this.client || (!this.user && !this.isGuest)) return;
    try {
      const toUpsert = [];
      const currentIds = new Set();

      for (const l of leads) {
        currentIds.add(l.id);
        const j = JSON.stringify(l);
        if (this.leadSnap.get(l.id) !== j) {
          toUpsert.push(this.leadToRow(l));
        }
      }

      if (toUpsert.length > 0 && this.user) {
        const { error } = await this.client.from('leads').upsert(toUpsert, { onConflict: 'id' });
        if (error) {
          this.handleError(error, 'saving lead');
        } else {
          toUpsert.forEach(r => {
            const l = leads.find(x => x.id === r.id);
            if (l) this.leadSnap.set(l.id, JSON.stringify(l));
          });
        }
      }

      for (const id of [...this.leadSnap.keys()]) {
        if (!currentIds.has(id)) {
          await this.deleteLead(id);
        }
      }
    } catch (err) {
      console.error('Error syncing leads:', err);
    }
  }

  async deleteLead(id) {
    if (!this.client || !this.user) return;
    try {
      const { error } = await this.client.from('leads').delete().eq('id', id);
      if (error) {
        this.handleError(error, 'deleting lead');
      } else {
        this.leadSnap.delete(id);
      }
    } catch (err) {
      console.error('Error deleting lead:', err);
    }
  }

  // --- COMPANIES / HUTS ---

  async loadCompanies() {
    if (!this.client) return;
    try {
      // Both Owner and Collaborators access all shared garden companies
      let query = this.client.from('companies').select('*').order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) {
        this.handleError(error, 'loading companies');
        return;
      }
      if (data) {
        cos = data.map(row => this.rowToCompany(row));
        this.companySnap.clear();
        cos.forEach(c => this.companySnap.set(c.id, JSON.stringify(c)));
        try { localStorage.setItem('hanami_co', JSON.stringify(cos)); } catch (e) {}
        if (typeof render === 'function') render();
      }
    } catch (err) {
      console.error('Error loading companies:', err);
    }
  }

  rowToCompany(row) {
    let status = String(row.status || 'building').toLowerCase().trim();
    if (['in_progress', 'active', 'open'].includes(status)) status = 'building';
    if (['done', 'completed', 'finished', 'closed'].includes(status)) status = 'done';
    if (status !== 'done') status = 'building';

    return {
      id: String(row.id || (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2, 9))),
      name: row.name || 'Unnamed company',
      country: row.country || '',
      status: status,
      note: row.note || '',
      campaignId: row.campaign_id || null,
      log: Array.isArray(row.log) ? row.log : [],
      done: row.done || null,
      created: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    };
  }

  companyToRow(c) {
    const row = {
      id: c.id,
      name: c.name || 'Unnamed company',
      country: c.country || null,
      status: c.status || 'building',
      note: c.note || null
    };
    if (this.user) {
      row.user_id = this.user.id;
    }
    if (this.caps.companiesLog && c.log) {
      row.log = c.log;
    }
    if (this.caps.companiesDone && c.done) {
      row.done = c.done;
    }
    if (this.caps.companiesCampaign && c.campaignId) {
      row.campaign_id = c.campaignId;
    }
    return row;
  }

  async syncCompanies() {
    if (!this.client || (!this.user && !this.isGuest)) return;
    try {
      const toUpsert = [];
      const currentIds = new Set();

      for (const c of cos) {
        currentIds.add(c.id);
        const j = JSON.stringify(c);
        if (this.companySnap.get(c.id) !== j) {
          toUpsert.push(this.companyToRow(c));
        }
      }

      if (toUpsert.length > 0 && this.user) {
        const { error } = await this.client.from('companies').upsert(toUpsert, { onConflict: 'id' });
        if (error) {
          this.handleError(error, 'saving company');
        } else {
          toUpsert.forEach(r => {
            const c = cos.find(x => x.id === r.id);
            if (c) this.companySnap.set(c.id, JSON.stringify(c));
          });
        }
      }

      for (const id of [...this.companySnap.keys()]) {
        if (!currentIds.has(id)) {
          await this.deleteCompany(id);
        }
      }
    } catch (err) {
      console.error('Error syncing companies:', err);
    }
  }

  async deleteCompany(id) {
    if (!this.client || !this.user) return;
    try {
      const { error } = await this.client.from('companies').delete().eq('id', id);
      if (error) {
        this.handleError(error, 'deleting company');
      } else {
        this.companySnap.delete(id);
      }
    } catch (err) {
      console.error('Error deleting company:', err);
    }
  }

  // --- GAME & PROFILE ---

  async loadProfile() {
    if (!this.client || !this.user) return;
    try {
      const isCharchit = this.user.email && this.user.email.toLowerCase() === 'charchit.sahoo@peoplehum.com';

      // Auto-assign owner role and reassign leads for Charchit
      if (isCharchit) {
        this.userRole = 'owner';
        try {
          await this.client.from('leads').update({ user_id: this.user.id }).neq('user_id', this.user.id);
        } catch(e) {
          console.warn('Lead claim notice:', e);
        }
      }

      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('user_id', this.user.id)
        .limit(1);

      if (!error && data && data.length) {
        const p = data[0];
        game.xp = isCharchit ? Math.max(p.xp || 0, 445) : (p.xp ?? (game.xp || 0));
        game.streak = isCharchit ? Math.max(p.streak || 0, 3) : (p.streak ?? (game.streak || 0));
        game.nick = isCharchit ? 'Charchit' : (p.nickname || game.nick);
        if (p.last_day) game.lastDay = p.last_day;
        if (p.today) game.today = p.today;
        this.userRole = isCharchit ? 'owner' : (p.role || 'collaborator');
        try { localStorage.setItem('hanami_game', JSON.stringify(game)); } catch (e) {}
      } else if (!error && (!data || !data.length)) {
        // First time user: create profile row
        const defaultName = isCharchit ? 'Charchit' : (this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email.split('@')[0]);
        game.nick = defaultName;
        if (isCharchit) {
          game.xp = 445;
          game.streak = 3;
        }
        this.userRole = isCharchit ? 'owner' : 'collaborator';
        await this.syncGame();
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  }

  async syncGame() {
    if (!this.client || !this.user) return;
    try {
      const row = {
        user_id: this.user.id,
        email: this.user.email,
        xp: game.xp || 0,
        streak: game.streak || 0,
        nickname: game.nick || this.user.user_metadata?.nickname || this.user.email.split('@')[0],
        role: this.userRole || 'collaborator',
        last_day: game.lastDay || null
      };
      if (this.caps.profilesToday && game.today) {
        row.today = game.today;
      }
      await this.client.from('profiles').upsert(row, { onConflict: 'user_id' });
    } catch (err) {
      console.error('Error syncing game:', err);
    }
  }

  // Allow switching roles for testing multi-user capabilities
  async setRole(newRole) {
    toast('Roles are assigned by the workspace admin.');
  }

  // --- LEADERBOARD ACROSS ALL USERS ---

  async loadLeaderboard() {
    if (!this.client) return;
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .order('xp', { ascending: false });

      if (!error && data && data.length) {
        if (typeof board !== 'undefined') {
          board = data.map(p => ({
            id: p.user_id,
            nick: p.nickname || 'Teammate',
            role: p.role || 'collaborator',
            xp: p.xp || 0,
            streak: p.streak || 0,
            lv: typeof LV !== 'undefined' && typeof lvl === 'function' ? LV[lvl(p.xp || 0)][1] : 'Sprout',
            tot: { s: Math.round((p.xp || 0) * 0.4), t: Math.round((p.xp || 0) * 0.3), d: Math.round((p.xp || 0) * 0.1) },
            days: {}
          }));
          if (typeof tab !== 'undefined' && tab === 'board' && typeof render === 'function') {
            render();
          }
        }
      }
    } catch (err) {
      console.warn('Leaderboard sync error:', err);
    }
  }

  // --- REALTIME ---

  subscribeRealtime() {
    if (!this.client) return;
    try {
      this.client
        .channel('hanami_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, payload => {
          this.handleRemoteLeadChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, payload => {
          if (this.user && payload.new && payload.new.user_id && payload.new.user_id !== this.user.id) return;
          this.handleRemoteCompanyChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          this.loadLeaderboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_members' }, () => {
          this.loadAll();
        })
        .subscribe();
    } catch (err) {
      console.warn('Realtime subscription error:', err);
    }
  }

  handleRemoteLeadChange(payload) {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const updated = this.rowToLead(payload.new);
      const idx = leads.findIndex(l => l.id === updated.id);
      if (idx >= 0) leads[idx] = updated;
      else leads.unshift(updated);
      this.leadSnap.set(updated.id, JSON.stringify(updated));
    } else if (payload.eventType === 'DELETE') {
      leads = leads.filter(l => l.id !== payload.old.id);
      this.leadSnap.delete(payload.old.id);
    }
    try { localStorage.setItem('hanami', JSON.stringify(leads)); } catch (e) {}
    if (typeof render === 'function') render();
  }

  handleRemoteCompanyChange(payload) {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const updated = this.rowToCompany(payload.new);
      const idx = cos.findIndex(c => c.id === updated.id);
      if (idx >= 0) cos[idx] = updated;
      else cos.unshift(updated);
      this.companySnap.set(updated.id, JSON.stringify(updated));
    } else if (payload.eventType === 'DELETE') {
      cos = cos.filter(c => c.id !== payload.old.id);
      this.companySnap.delete(payload.old.id);
    }
    try { localStorage.setItem('hanami_co', JSON.stringify(cos)); } catch (e) {}
    if (typeof render === 'function') render();
  }

  // --- AUTH ACTIONS ---

  async signIn(email, password) {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    const res = await this.client.auth.signInWithPassword({ email, password });
    if (res.error) {
      const msg = res.error.message || '';
      if (msg.toLowerCase().includes('email not confirmed')) {
        res.error.friendly = 'Email not confirmed. Check your inbox for the verification link, then sign in.';
      } else if (msg.toLowerCase().includes('invalid login credentials')) {
        res.error.friendly = 'That email and password did not match. If you requested a reset, open the latest email, choose a new password, then sign in with it.';
      }
    }
    return res;
  }

  async signUp(email, password, name, role = 'collaborator', inviteToken = '') {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    const res = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
          nickname: name,
          role: email.toLowerCase() === 'charchit.sahoo@peoplehum.com' ? 'owner' : role,
          invite_token: inviteToken
        },
        ...(inviteToken ? {
          emailRedirectTo: `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(email)}`
        } : {})
      }
    });

    if (res.error) {
      const msg = res.error.message || '';
      if (msg.toLowerCase().includes('rate limit')) {
        res.error.friendly = 'Email rate limit reached. Wait a little while or configure a custom SMTP provider in Supabase.';
      } else if (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('email')) {
        res.error.friendly = 'Please enter a valid email address.';
      }
    }

    if (res.data && res.data.user) {
      this.userRole = email.toLowerCase() === 'charchit.sahoo@peoplehum.com' ? 'owner' : role;
    }

    return res;
  }

  async resetPassword(email) {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    return await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
  }

  async signOut() {
    localStorage.removeItem('hanami_active_user');
    if (this.client) {
      try { await this.client.auth.signOut(); } catch(e){}
    }
    this.user = null;
    this.userRole = 'owner';
    this.isGuest = false;
    this.closeAuthModal();
    this.showAuthPage();
  }

  async testConnection(url, key) {
    try {
      if (!window.supabase) return { ok: false, error: 'Supabase JS library not loaded' };
      const tempClient = window.supabase.createClient(url, key);
      const { data, error } = await tempClient.auth.getSession();
      if (error && error.message) {
        return { ok: false, error: error.message };
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || 'Connection timeout or network failure' };
    }
  }

  handleError(error, action) {
    console.error(`Supabase error while ${action}:`, error);
    if (error.code === '42501') {
      toast('Supabase RLS: Sign in or run supabase-setup.sql policies.');
    } else {
      toast(`Supabase: ${error.message || 'Error ' + action}`);
    }
  }

  openAuthModal() {
    if (this.user) {
      const modal = document.getElementById('supabaseModal');
      if (!modal) return;
      modal.style.display = 'flex';
      const box = document.getElementById('sbModalBody');
      if (box) {
        const name = this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email.split('@')[0];
        const role = this.userRole || this.user.user_metadata?.role || 'owner';
        const roleDesc = {
          owner: '👑 Owner: Manage campaigns, invite collaborators, edit all leads.',
          collaborator: '🤝 Collaborator: Add and work on assigned campaign leads.',
          viewer: '👀 Viewer: Read-only access to campaign progress and leads.'
        }[role] || 'Member';

        const { url } = getSupabaseConfig();
        const shortUrl = url.replace('https://', '').split('.')[0];

        box.innerHTML = `
          <div style="margin-bottom:16px;padding:14px;background:var(--field);border-radius:12px;border:1px solid var(--line)">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div>
                <b style="font-size:16px;color:var(--ink)">${name}</b>
                <div class="meta" style="margin-top:2px;font-size:12.5px">${this.user.email}</div>
              </div>
              <span class="role-badge role-${role}">${role.toUpperCase()}</span>
            </div>
            <div style="font-size:12px;color:var(--mute);margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
              ${roleDesc}
            </div>
          </div>

          <div style="font-size:11.5px;color:var(--mute);margin-bottom:16px">
            <div><b>Cloud Project:</b> <code>${shortUrl}</code></div>
            <div><b>Account ID:</b> <code>${this.user.id.slice(0, 8)}…</code></div>
          </div>

          <div class="row" style="margin-top:16px;justify-content:space-between">
            <button class="btn" id="sbSignOutBtn" style="background:var(--red);border-color:var(--red);color:#fff">Log out</button>
            <button class="sm" id="sbCloseBtn">Close</button>
          </div>
        `;

        document.getElementById('sbSignOutBtn').onclick = () => {
          this.signOut();
        };
        document.getElementById('sbCloseBtn').onclick = () => this.closeAuthModal();
      }
    } else {
      this.showAuthPage();
    }
  }

  closeAuthModal() {
    const modal = document.getElementById('supabaseModal');
    if (modal) modal.style.display = 'none';
  }
}

window.HanamiSupabase = new HanamiSupabaseSync();
