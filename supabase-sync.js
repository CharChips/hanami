/**
 * Supabase Synchronization & Authentication for Hanami Lead Garden
 */

const SUPABASE_URL = 'https://eqabcpjqmklnwbzeydnp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u8Zl-k6gpsYxVfT4oh-qSw_rFq5LTdB';

class HanamiSupabaseSync {
  constructor() {
    this.client = null;
    this.user = null;
    this.isGuest = false;
    this.isInitialized = false;
    this.leadSnap = new Map();
    this.companySnap = new Map();
    this.caps = {
      leadsLog: false,
      companiesLog: false,
      companiesDone: false,
      profilesToday: false
    };
  }

  async init() {
    if (!window.supabase) {
      console.warn('Supabase JS library not loaded.');
      this.showApp();
      return;
    }

    try {
      this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this.bindAuthUI();

      // Check existing session
      const { data: { session }, error: sessionError } = await this.client.auth.getSession();
      
      if (!sessionError && session && session.user) {
        this.user = session.user;
        this.showApp();
        await this.detectCapabilities();
        await this.loadAll();
      } else {
        // No active session: show login screen
        this.showAuthPage();
        await this.detectCapabilities();
      }

      // Listen for auth state changes
      this.client.auth.onAuthStateChange(async (event, newSession) => {
        if (event === 'SIGNED_IN' && newSession) {
          this.user = newSession.user;
          this.isGuest = false;
          this.showApp();
          toast('Welcome, ' + (this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email));
          await this.loadAll();
        } else if (event === 'SIGNED_OUT') {
          this.user = null;
          this.isGuest = false;
          leads = [];
          cos = [];
          game = { xp: 0, streak: 0 };
          this.leadSnap.clear();
          this.companySnap.clear();
          this.showAuthPage();
          if (typeof render === 'function') render();
        }
      });

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
    const formIn = document.getElementById('signInForm');
    const formUp = document.getElementById('signUpForm');
    const alertBox = document.getElementById('authAlert');

    if (tabIn && tabUp) {
      tabIn.onclick = () => {
        tabIn.classList.add('on');
        tabUp.classList.remove('on');
        if (formIn) formIn.style.display = 'flex';
        if (formUp) formUp.style.display = 'none';
        if (alertBox) alertBox.style.display = 'none';
      };
      tabUp.onclick = () => {
        tabUp.classList.add('on');
        tabIn.classList.remove('on');
        if (formIn) formIn.style.display = 'none';
        if (formUp) formUp.style.display = 'flex';
        if (alertBox) alertBox.style.display = 'none';
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
          this.setAuthAlert(res.error.message || 'Login failed. Please check your credentials.', true);
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
        const btn = document.getElementById('btnSignUpSubmit');
        if (!name || !email || !pass) return;

        if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
        this.setAuthAlert('', false);

        const res = await this.signUp(email, pass, name);
        if (btn) { btn.disabled = false; btn.textContent = 'Create Account & Start Garden'; }

        if (res.error) {
          this.setAuthAlert(res.error.message || 'Could not create account.', true);
        } else if (res.data && !res.data.session) {
          // Email confirmation is required by Supabase settings
          this.setAuthAlert('✓ Account created! Please check your email to confirm your account, then sign in.', false, true);
          if (tabIn) tabIn.click();
          const inEmail = document.getElementById('loginEmail');
          if (inEmail) inEmail.value = email;
        }
      };
    }

    // Guest Continue
    const btnGuest = document.getElementById('btnGuest');
    if (btnGuest) {
      btnGuest.onclick = () => this.continueAsGuest();
    }

    // Logout Button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = () => this.signOut();
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

    if (this.user) {
      const name = this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email.split('@')[0];
      const initials = name.slice(0, 2).toUpperCase();
      if (avt) avt.textContent = initials;
      if (wsname) wsname.textContent = `${name}’s garden`;
      if (sbBtn) {
        sbBtn.style.color = 'var(--leaf)';
        sbBtn.title = `Supabase: Connected as ${this.user.email}`;
      }
    } else {
      if (avt) avt.textContent = 'H';
      if (wsname) wsname.textContent = 'My garden';
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
      const { error } = await this.client.from('companies').select('log').limit(1);
      this.caps.companiesLog = !error;
    } catch (e) { this.caps.companiesLog = false; }

    try {
      const { error } = await this.client.from('companies').select('done').limit(1);
      this.caps.companiesDone = !error;
    } catch (e) { this.caps.companiesDone = false; }

    try {
      const { error } = await this.client.from('profiles').select('today').limit(1);
      this.caps.profilesToday = !error;
    } catch (e) { this.caps.profilesToday = false; }
  }

  async loadAll() {
    mode = 'cloud';
    await Promise.all([
      this.loadProfile(),
      this.loadLeads(),
      this.loadCompanies(),
      this.loadLeaderboard()
    ]);
    if (typeof baseline === 'function') baseline();
    if (typeof render === 'function') render();
    this.updateUserBadge();
  }

  // --- LEADS ---

  async loadLeads() {
    if (!this.client) return;
    try {
      let query = this.client.from('leads').select('*').order('created_at', { ascending: false });
      if (this.user) {
        query = query.eq('user_id', this.user.id);
      }
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
      status: status,
      due: row.due || '',
      next: row.next_step || '',
      note: row.note || '',
      hot: !!row.hot,
      pic: row.photo || '',
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
      status: l.status || 'spotted',
      due: l.due || null,
      next_step: l.next || null,
      note: l.note || null,
      hot: !!l.hot,
      photo: l.pic || null
    };
    if (this.user) {
      row.user_id = this.user.id;
    }
    if (this.caps.leadsLog && l.log) {
      row.log = l.log;
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
      const { error } = await this.client.from('leads').delete().eq('id', id).eq('user_id', this.user.id);
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
      let query = this.client.from('companies').select('*').order('created_at', { ascending: false });
      if (this.user) {
        query = query.eq('user_id', this.user.id);
      }
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
      const { error } = await this.client.from('companies').delete().eq('id', id).eq('user_id', this.user.id);
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
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('user_id', this.user.id)
        .limit(1);

      if (!error && data && data.length) {
        const p = data[0];
        game.xp = p.xp ?? (game.xp || 0);
        game.streak = p.streak ?? (game.streak || 0);
        if (p.nickname) game.nick = p.nickname;
        if (p.last_day) game.lastDay = p.last_day;
        if (p.today) game.today = p.today;
        try { localStorage.setItem('hanami_game', JSON.stringify(game)); } catch (e) {}
      } else if (!error && (!data || !data.length)) {
        // First time user: create profile row
        const defaultName = this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email.split('@')[0];
        game.nick = defaultName;
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
        xp: game.xp || 0,
        streak: game.streak || 0,
        nickname: game.nick || this.user.user_metadata?.nickname || this.user.email.split('@')[0],
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
          if (this.user && payload.new && payload.new.user_id && payload.new.user_id !== this.user.id) return;
          this.handleRemoteLeadChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, payload => {
          if (this.user && payload.new && payload.new.user_id && payload.new.user_id !== this.user.id) return;
          this.handleRemoteCompanyChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          this.loadLeaderboard();
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
    return await this.client.auth.signInWithPassword({ email, password });
  }

  async signUp(email, password, name) {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    const res = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
          nickname: name
        }
      }
    });

    if (res.data && res.data.user) {
      // Create initial profile in profiles table
      try {
        await this.client.from('profiles').upsert({
          user_id: res.data.user.id,
          nickname: name,
          xp: 0,
          streak: 0,
          last_day: new Date().toISOString().split('T')[0]
        }, { onConflict: 'user_id' });
      } catch (e) {
        console.warn('Initial profile create error:', e);
      }
    }

    return res;
  }

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
    this.isGuest = false;
    this.showAuthPage();
  }

  handleError(error, action) {
    console.error(`Supabase error while ${action}:`, error);
    if (error.code === '42501') {
      toast('Supabase RLS active: Sign in or run the SQL policies.');
    } else {
      toast(`Supabase: ${error.message || 'Error ' + action}`);
    }
  }

  openAuthModal() {
    if (this.user) {
      // If logged in, clicking avatar/cloud shows profile & logout
      const modal = document.getElementById('supabaseModal');
      if (!modal) return;
      modal.style.display = 'flex';
      const box = document.getElementById('sbModalBody');
      if (box) {
        const name = this.user.user_metadata?.nickname || this.user.user_metadata?.name || this.user.email;
        box.innerHTML = `
          <div style="margin-bottom:14px">
            <div class="meta">Signed in as</div>
            <b style="font-size:16px;color:var(--ink)">${name}</b>
            <div class="meta" style="margin-top:2px">${this.user.email}</div>
          </div>
          <div class="row" style="margin-top:16px">
            <button class="btn" id="sbSignOutBtn">Log out</button>
            <button class="sm" id="sbCloseBtn">Close</button>
          </div>
        `;
        document.getElementById('sbSignOutBtn').onclick = () => {
          this.closeAuthModal();
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
