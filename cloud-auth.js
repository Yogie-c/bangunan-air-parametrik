(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.publishableKey && window.supabase?.createClient);
  const gate = document.getElementById('authGate');
  const status = document.getElementById('authStatus');
  const pending = document.getElementById('pendingPanel');
  const ownerPanel = document.getElementById('ownerPanel');
  const cloudBox = document.createElement('section');
  cloudBox.id = 'cloudBox';
  cloudBox.innerHTML = `<strong>Rancangan online</strong>
    <p id="cloudNote">Akun cloud belum dikonfigurasi.</p>
    <label>Nama rancangan<input id="cloudName" maxlength="80" placeholder="Contoh: Saluran tersier A"></label>
    <button id="cloudSave" type="button">Simpan ke akun saya</button>
    <label>Buka rancangan<select id="cloudList"><option value="">Pilih rancangan</option></select></label>
    <div class="g"><button id="cloudLoad" class="sm" type="button">Buka</button><button id="cloudDelete" class="sm" type="button">Hapus</button></div>
    <div class="g"><span id="accountLabel" style="font-size:12px;align-self:center"></span><button id="authSignOut" class="sm" type="button" hidden>Keluar</button></div>`;
  const localBox = document.querySelector('.dbbox');
  if (localBox) localBox.after(cloudBox);

  const say = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  if (!configured) {
    for (const id of ['cloudSave', 'cloudLoad', 'cloudDelete']) document.getElementById(id).disabled = true;
    document.getElementById('cloudNote').textContent = 'Online belum aktif. Isi URL proyek dan publishable key di supabase-config.js. Jangan masukkan service role key ke situs.';
    return;
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  let signedUser = null;

  async function applySnapshot(row) {
    const payload = row.payload || {};
    for (const [id, value] of Object.entries(payload.fields || {})) {
      const el = document.getElementById(id);
      if (!el || el.type === 'file' || id.startsWith('auth') || id.startsWith('cloud')) continue;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = value;
    }
    Object.assign(imgs, payload.images || {});
    renderLay(Array.isArray(payload.layouts) ? payload.layouts : LAY0);
    document.getElementById('dbName').value = row.title || '';
    await draw();
  }

  async function refreshCloud() {
    const { data, error } = await client.from('designs').select('id,title,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    const list = document.getElementById('cloudList');
    list.innerHTML = '<option value="">Pilih rancangan</option>' + data.map(row =>
      `<option value="${esc(row.id)}">${esc(row.title)} · ${new Date(row.updated_at).toLocaleDateString('id-ID')}</option>`
    ).join('');
    document.getElementById('cloudNote').textContent = `${data.length} rancangan tersimpan di akun ${signedUser.email}.`;
  }

  async function loadPending() {
    const box = document.getElementById('pendingUsers');
    box.innerHTML = '<p>Memuat akun…</p>';
    const { data, error } = await client.functions.invoke('owner-approvals', { body: { action: 'list' } });
    if (error) throw error;
    const users = data.users || [];
    box.innerHTML = users.length ? users.map(user => `<div class="pendingRow">
      <span>${esc(user.email || '(email tidak ada)')}<br><small>${new Date(user.created_at).toLocaleDateString('id-ID')}</small></span>
      <button class="sm" data-approve="${esc(user.id)}" type="button">Setujui</button></div>`
    ).join('') : '<p>Tidak ada akun yang menunggu.</p>';
    box.querySelectorAll('[data-approve]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const { error: approveError } = await client.functions.invoke('owner-approvals', { body: { action: 'approve', userId: button.dataset.approve } });
        if (approveError) throw approveError;
        say('Akun disetujui. Pengguna perlu masuk ulang agar akses aktif.');
        await loadPending();
      } catch (error) {
        say(error.message || 'Persetujuan gagal.', true);
        button.disabled = false;
      }
    });
  }

  async function applySession(session) {
    signedUser = session?.user || null;
    const isOwner = signedUser?.app_metadata?.is_owner === true;
    const approved = signedUser?.app_metadata?.approved === true;
    const signedIn = Boolean(signedUser);
    const allowed = signedIn && approved;
    gate.classList.toggle('show', !allowed);
    pending.hidden = !(signedIn && !approved);
    ownerPanel.hidden = !(isOwner && allowed);
    document.getElementById('authSignIn').hidden = signedIn;
    document.getElementById('authSignUp').hidden = signedIn;
    document.getElementById('authSignOut').hidden = !signedIn;
    document.getElementById('accountLabel').textContent = allowed ? signedUser.email : '';
    for (const id of ['cloudSave', 'cloudLoad', 'cloudDelete']) document.getElementById(id).disabled = !allowed;
    if (!signedIn) { say('Masuk dengan email yang sudah terdaftar.'); return; }
    if (!approved) { say('Akun terverifikasi dan menunggu persetujuan pemilik.'); return; }
    say('Akses disetujui.');
    if (isOwner) loadPending().catch(error => say(error.message || 'Daftar akun tidak dapat dimuat.', true));
    try { await refreshCloud(); }
    catch (error) { document.getElementById('cloudNote').textContent = 'Gagal memuat daftar rancangan: ' + (error.message || 'periksa koneksi'); }
  }

  document.getElementById('authSignIn').onclick = async () => {
    say('Memeriksa akun…');
    const { data, error } = await client.auth.signInWithPassword({
      email: document.getElementById('authEmail').value.trim(),
      password: document.getElementById('authPassword').value
    });
    if (error) say(error.message, true); else await applySession(data.session);
  };
  document.getElementById('authSignUp').onclick = async () => {
    say('Mendaftarkan akun…');
    const { error } = await client.auth.signUp({
      email: document.getElementById('authEmail').value.trim(),
      password: document.getElementById('authPassword').value,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) say(error.message, true);
    else say('Periksa email untuk verifikasi. Setelah itu masuk; akses aktif setelah disetujui pemilik.');
  };
  document.getElementById('authPendingOut').onclick = () => client.auth.signOut();
  document.getElementById('authSignOut').onclick = () => client.auth.signOut();
  document.getElementById('ownerRefresh').onclick = () => loadPending().catch(error => say(error.message || 'Daftar akun tidak dapat dimuat.', true));

  document.getElementById('cloudSave').onclick = async () => {
    const button = document.getElementById('cloudSave'); button.disabled = true;
    try {
      const state = snapshot();
      // Never send authentication controls or cloud UI values with a saved design.
      for (const id of ['authEmail', 'authPassword', 'cloudName', 'cloudList']) delete state.fields[id];
      const payload = { fields: state.fields, layouts: state.layouts, images: state.images };
      const title = document.getElementById('cloudName').value.trim() || state.name;
      const { error } = await client.from('designs').insert({ user_id: signedUser.id, title, payload });
      if (error) throw error;
      await refreshCloud();
      document.getElementById('cloudNote').textContent = 'Rancangan tersimpan online untuk akun ini.';
    } catch (error) {
      document.getElementById('cloudNote').textContent = 'Gagal menyimpan: ' + (error.message || 'periksa koneksi');
    } finally { button.disabled = false; }
  };
  document.getElementById('cloudLoad').onclick = async () => {
    const id = document.getElementById('cloudList').value; if (!id) return;
    const { data, error } = await client.from('designs').select('title,payload').eq('id', id).single();
    if (error) { document.getElementById('cloudNote').textContent = 'Gagal membuka: ' + error.message; return; }
    await applySnapshot(data);
    document.getElementById('cloudNote').textContent = 'Rancangan dibuka dari akun ini.';
  };
  document.getElementById('cloudDelete').onclick = async () => {
    const id = document.getElementById('cloudList').value; if (!id) return;
    const { error } = await client.from('designs').delete().eq('id', id);
    if (error) { document.getElementById('cloudNote').textContent = 'Gagal menghapus: ' + error.message; return; }
    await refreshCloud();
  };

  client.auth.onAuthStateChange((_event, session) => setTimeout(() => applySession(session), 0));
  client.auth.getSession().then(({ data }) => applySession(data.session));
})();
