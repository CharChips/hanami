/**
 * Supabase Synchronization for Hanami Lead Garden
 */

const SUPABASE_URL = 'https://eqabcpjqmklnwbzeydnp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u8Zl-k6gpsYxVfT4oh-qSw_rFq5LTdB';

class HanamiSupabaseSync {
  constructor() {
    this.client = null;
    this.user = null;
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
      return;
    }

    try {
      this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      
      // Check active auth session
      const { data: { session }, error: sessionError } = await this.client.auth.getSession();
      if (!sessionError && session) {
        this.user = session.user;
      }

      // Detect optional columns
      await this.detectCapabilities();

      // Listen to auth changes
      this.client.auth.onAuthStateChange(async (event, newSession) => {
        this.user = newSession ? newSession.user : null;
        this.updateAuthBadge();
        if (event === 'SIGNED_IN') {
          toast('Signed in as ' + (this.user.email || 'user'));
          await this.loadAll();
        } else if (event === 'SIGNED_OUT') {
          toast('Signed out');
          render();
        }
      });

      // Load remote data
      await this.loadAll();

      // Subscribe to Realtime changes
      this.subscribeRealtime();

      this.isInitialized = true;
      this.updateAuthBadge();
    } catch (err) {
      console.error('Supabase initialization error:', err);
    }
  }

  async detectCapabilities() {
    // Check if 'log' column exists in leads
    try {
      const { error } = await this.client.from('leads').select('log').limit(1);
      this.caps.leadsLog = !error;
    } catch (e) { this.caps.leadsLog = false; }

    // Check if 'log' and 'done' exist in companies
    try {
      const { error } = await this.client.from('companies').select('log').limit(1);
      this.caps.companiesLog = !error;
    } catch (e) { this.caps.companiesLog = false; }

    try {
      const { error } = await this.client.from('companies').select('done').limit(1);
      this.caps.companiesDone = !error;
    } catch (e) { this.caps.companiesDone = false; }

    // Check if 'today' exists in profiles
    try {
      const { error } = await this.client.from('profiles').select('today').limit(1);
      this.caps.profilesToday = !error;
    } catch (e) { this.caps.profilesToday = false; }
  }

  async loadAll() {
    await Promise.all([
      this.loadLeads(),
      this.loadCompanies(),
      this.loadProfile()
    ]);
    mode = 'cloud';
    if (typeof baseline === 'function') baseline();
    if (typeof render === 'function') render();
  }

  // --- LEADS ---

  async loadLeads() {
    try {
      let query = this.client.from('leads').select('*').order('created_at', { ascending: false });
      if (this.user) {
        query = query.or(`user_id.eq.${this.user.id},user_id.is.null`);
      }
      const { data, error } = await query;
      if (error) {
        this.handleError(error, 'loading leads');
        return;
      }
      if (data && data.length) {
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
      id: String(row.id || uid()),
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
    if (!this.client) return;
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

      if (toUpsert.length > 0) {
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

      // Check deletions
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
    if (!this.client) return;
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
    try {
      let query = this.client.from('companies').select('*').order('created_at', { ascending: false });
      if (this.user) {
        query = query.or(`user_id.eq.${this.user.id},user_id.is.null`);
      }
      const { data, error } = await query;
      if (error) {
        this.handleError(error, 'loading companies');
        return;
      }
      if (data && data.length) {
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
      id: String(row.id || uid()),
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
    if (!this.client) return;
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

      if (toUpsert.length > 0) {
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
    if (!this.client) return;
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
    if (!this.client) return;
    try {
      let query = this.client.from('profiles').select('*');
      if (this.user) {
        query = query.eq('user_id', this.user.id);
      }
      query = query.limit(1);

      const { data, error } = await query;
      if (!error && data && data.length) {
        const p = data[0];
        game.xp = p.xp ?? (game.xp || 0);
        game.streak = p.streak ?? (game.streak || 0);
        if (p.nickname) game.nick = p.nickname;
        if (p.last_day) game.lastDay = p.last_day;
        if (p.today) game.today = p.today;
        try { localStorage.setItem('hanami_game', JSON.stringify(game)); } catch (e) {}
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  }

  async syncGame() {
    if (!this.client) return;
    try {
      const row = {
        xp: game.xp || 0,
        streak: game.streak || 0,
        nickname: game.nick || '',
        last_day: game.lastDay || null
      };
      if (this.user) {
        row.user_id = this.user.id;
      }
      if (this.caps.profilesToday && game.today) {
        row.today = game.today;
      }
      if (this.user) {
        await this.client.from('profiles').upsert(row, { onConflict: 'user_id' });
      }
    } catch (err) {
      console.error('Error syncing game:', err);
    }
  }

  // --- REALTIME SUBSCRIPTIONS ---

  subscribeRealtime() {
    if (!this.client) return;
    try {
      this.client
        .channel('hanami_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, payload => {
          this.handleRemoteLeadChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, payload => {
          this.handleRemoteCompanyChange(payload);
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
      if (idx >= 0) {
        leads[idx] = updated;
      } else {
        leads.unshift(updated);
      }
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
      if (idx >= 0) {
        cos[idx] = updated;
      } else {
        cos.unshift(updated);
      }
      this.companySnap.set(updated.id, JSON.stringify(updated));
    } else if (payload.eventType === 'DELETE') {
      cos = cos.filter(c => c.id !== payload.old.id);
      this.companySnap.delete(payload.old.id);
    }
    try { localStorage.setItem('hanami_co', JSON.stringify(cos)); } catch (e) {}
    if (typeof render === 'function') render();
  }

  // --- AUTH METHODS ---

  async signIn(email, password) {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    const res = await this.client.auth.signInWithPassword({ email, password });
    if (res.error) {
      toast('Login failed: ' + res.error.message);
    }
    return res;
  }

  async signUp(email, password) {
    if (!this.client) return { error: { message: 'Supabase client not initialized' } };
    const res = await this.client.auth.signUp({ email, password });
    if (res.error) {
      toast('Sign up failed: ' + res.error.message);
    } else {
      toast('Account created! Please check your email or log in.');
    }
    return res;
  }

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
    this.updateAuthBadge();
  }

  updateAuthBadge() {
    const btn = document.getElementById('supabaseBtn');
    if (!btn) return;
    if (this.user) {
      btn.style.color = 'var(--leaf)';
      btn.title = `Supabase: Connected as ${this.user.email}`;
    } else {
      btn.style.color = 'var(--pink)';
      btn.title = 'Supabase: Connected (Guest / Local)';
    }
  }

  handleError(error, action) {
    console.error(`Supabase error while ${action}:`, error);
    if (error.code === '42501') {
      toast('Supabase RLS active: Please sign in or allow anon write policy in Supabase.');
      this.openAuthModal(true);
    } else {
      toast(`Supabase: ${error.message || 'Error ' + action}`);
    }
  }

  openAuthModal(showRlsNotice = false) {
    const modal = document.getElementById('supabaseModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const notice = document.getElementById('sbRlsNotice');
    if (notice) notice.style.display = showRlsNotice ? 'block' : 'none';
    this.renderModalContent();
  }

  closeAuthModal() {
    const modal = document.getElementById('supabaseModal');
    if (modal) modal.style.display = 'none';
  }

  renderModalContent() {
    const box = document.getElementById('sbModalBody');
    if (!box) return;

    if (this.user) {
      box.innerHTML = `
        <div style="margin-bottom:14px">
          <div class="meta">Signed in as</div>
          <b style="font-size:15px;color:var(--ink)">${this.user.email}</b>
          <div class="meta" style="margin-top:4px">User ID: <code style="font-size:11px">${this.user.id}</code></div>
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn" id="sbSignOutBtn">Sign out</button>
          <button class="sm" id="sbCloseBtn">Close</button>
        </div>
      `;
      document.getElementById('sbSignOutBtn').onclick = () => this.signOut();
      document.getElementById('sbCloseBtn').onclick = () => this.closeAuthModal();
    } else {
      box.innerHTML = `
        <div class="meta" style="margin-bottom:12px">
          Sign in or create an account with your Supabase project to protect your data with Row Level Security.
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label>Email</label>
            <input type="email" id="sbEmail" placeholder="you@company.com">
          </div>
          <div>
            <label>Password</label>
            <input type="password" id="sbPassword" placeholder="••••••••">
          </div>
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn" id="sbSignInBtn">Sign in</button>
          <button class="sm p" id="sbSignUpBtn">Sign up</button>
          <button class="sm" id="sbCloseBtn">Cancel</button>
        </div>
        <div class="meta" style="margin-top:14px;border-top:1px dashed var(--line);padding-top:10px;font-size:11.5px">
          💡 <b>Don't want logins?</b> You can disable RLS or allow public access on your Supabase tables to sync without authentication.
        </div>
      `;
      document.getElementById('sbSignInBtn').onclick = async () => {
        const email = document.getElementById('sbEmail').value.trim();
        const pass = document.getElementById('sbPassword').value;
        if (!email || !pass) return toast('Please enter email and password');
        const res = await this.signIn(email, pass);
        if (!res.error) this.closeAuthModal();
      };
      document.getElementById('sbSignUpBtn').onclick = async () => {
        const email = document.getElementById('sbEmail').value.trim();
        const pass = document.getElementById('sbPassword').value;
        if (!email || !pass) return toast('Please enter email and password');
        await this.signUp(email, pass);
      };
      document.getElementById('sbCloseBtn').onclick = () => this.closeAuthModal();
    }
  }
}

window.HanamiSupabase = new HanamiSupabaseSync();
