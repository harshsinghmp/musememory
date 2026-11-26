    let allMemories = [];
    let studioScope = 'project';
    let scopeGeneration = 0;
    let studioView = 'graph';
    let listSort = { key: 'created_at', dir: 'desc' };
    let listQuery = '';
    let listDebounce = null;
    function apiUrl(path) {
      if (studioScope === 'project') return path;
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'scope=' + encodeURIComponent(studioScope);
    }
    function setScope(scope, options) {
      studioScope = scope === 'global' || scope === 'mesh' ? scope : 'project';
      scopeGeneration += 1;
      document.querySelectorAll('.scope-btn').forEach(function (b) {
        var active = b.dataset.scope === studioScope;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      document.body.dataset.scope = studioScope;
      var badge = document.getElementById('scopeBadge');
      if (badge) badge.textContent = studioScope === 'global' ? '~/.memory' : studioScope === 'mesh' ? 'mesh' : './.memory';
      var banner = document.getElementById('scopeBanner');
      if (banner) {
        var notes = {
          project: '',
          global: 'Global scope (~/.memory): memory list, stats, constraints, wiki, persona and audit read from the global store. Health, ADRs, Cognition, Sync and Mesh stay project-scoped. Writes target the project store.',
          mesh: 'Mesh scope (read-only, first 200 entries): memory list and total/confirmed/link counts aggregate linked stores. Constraints, wiki, audit and all writes stay project-scoped.'
        };
        banner.textContent = notes[studioScope] || '';
        banner.hidden = studioScope === 'project';
      }
      var url = new URL(window.location.href);
      if (studioScope === 'project') url.searchParams.delete('scope');
      else url.searchParams.set('scope', studioScope);
      window.history.replaceState(null, '', url);
      if (!options || options.refetch !== false) loadData();
    }
    let selectedMemory = null;
    let currentFilter = 'all';
    let searchQuery = '';
    let currentTab = 'graph';

    // T-321: optional project scope for the studio's audit surfaces.
    // An empty value means the whole store; a value scopes the health gate,
    // drift, bug cluster and technical debt audits to that memory project.
    // The initial value comes from the URL query string so a scoped link
    // stays shareable and reloadable.
    let projectScope = (new URLSearchParams(window.location.search).get('project') || '').trim();

    function projectScopeQuery() {
      return projectScope ? '?project=' + encodeURIComponent(projectScope) : '';
    }

    function syncProjectScopeUrl() {
      try {
        const url = new URL(window.location.href);
        if (projectScope) url.searchParams.set('project', projectScope);
        else url.searchParams.delete('project');
        window.history.replaceState({}, '', url.toString());
      } catch (err) {
        console.error('Failed to sync project scope in URL:', err);
      }
    }

    function applyProjectScope(value) {
      projectScope = (value || '').trim();
      syncProjectScopeUrl();
      fetchHealth();
      if (currentTab === 'adrs') fetchDrift();
      if (currentTab === 'cognition') fetchCognition();
    }

    // ---- Graph state (3D force-directed) ----
    const TYPE_COLORS = {
      fix: '#10b981',
      decision: '#fbbf24',
      constraint: '#ef4444',
      failure: '#f59e0b',
      architecture: '#a855f7',
      operation: '#06b6d4',
      preference: '#ec4899',
      discovery: '#94a3b8',
      session: '#64748b'
    };
    let nodes3d = [];
    let edges3d = [];
    let rotX = 0.35, rotY = 0, zoom = 1.4;
    let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let hiddenClusters = new Set();
    let timelineCutoff = null;
    let simAlpha = 1;
    let graphLoopStarted = false;
    // T-455: the loop stops once the layout stops moving; input wakes it.
    const SETTLE_ENERGY = 0.05;
    let graphEnergy = Infinity;
    let documentHidden = false;

    async function refreshMemories() {
      const icon = document.getElementById('refreshIcon');
      const label = document.getElementById('refreshLabel');
      const btn = document.getElementById('refreshBtn');
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = 'Syncing...';
      if (btn) btn.disabled = true;

      try {
        if (studioScope !== 'project') {
          await loadData();
          flash('Refreshed ' + studioScope + ' scope view.');
          return;
        }
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ harvest: true }),
        });
        const info = await res.json();
        await loadData();
        const memCount = info.totalMemories ?? allMemories.length;
        const msg = info.harvestedCount > 0
          ? '✓ Refreshed! Synced ' + info.harvestedCount + ' new + ' + memCount + ' total memories & active state.'
          : '✓ Refreshed! Loaded ' + memCount + ' memories & active state.';
        flash(msg);
      } catch (err) {
        flash('Refresh failed: ' + (err && err.message ? err.message : String(err)), true);
      } finally {
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = 'Refresh';
        if (btn) btn.disabled = false;
      }
    }

    function requireProjectScope() {
      if (studioScope === 'project') return true;
      flash('Writes are project-scoped. Switch to Local Project to modify memories.', true);
      return false;
    }

    async function optimizeStoreDashboard() {
      if (!requireProjectScope()) return;
      const icon = document.getElementById('optimizeIcon');
      const label = document.getElementById('optimizeLabel');
      const btn = document.getElementById('optimizeBtn');
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = 'Optimizing...';
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Optimization failed');
        const rep = data.report;
        await loadData();
        const formatBytes = (b) => {
          if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
          if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
          return b + ' B';
        };
        const spaceMsg = rep.spaceReclaimedBytes > 0 ? ' Reclaimed ' + formatBytes(rep.spaceReclaimedBytes) + '.' : '';
        flash('⚡ Optimization Complete! Pruned ' + rep.totalPruned + ' items (' + rep.prunedNoise + ' noise, ' + rep.prunedJunk + ' junk, ' + rep.prunedDuplicates + ' dupes).' + spaceMsg);
      } catch (err) {
        flash('Optimization failed: ' + (err && err.message ? err.message : String(err)), true);
      } finally {
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = 'Optimize';
        if (btn) btn.disabled = false;
      }
    }

    async function loadData() {
      const requestedScope = studioScope;
      const requestGen = scopeGeneration;
      try {
        if (window.STANDALONE_DATA) {
          allMemories = window.STANDALONE_DATA;
        } else {
          const [memRes] = await Promise.all([
            fetch(apiUrl('/api/memories')),
            fetchStats(),
            fetchCurrentState(),
            fetchWikiPages(),
            fetchUserProfile(),
            loadAudit(),
            fetchActivity(),
            fetchTerrain(),
            fetchAgents(),
            fetchAgentManifest(),
          ]);
          const loaded = await memRes.json();
          if (requestedScope !== studioScope || requestGen !== scopeGeneration) return;
          allMemories = loaded;
        }
        renderList();
        initGraph();
        buildClusterFilters();
        if (!graphLoopStarted) { graphLoopStarted = true; requestAnimationFrame(tick); }
      } catch (err) {
        console.error('Failed to load memories:', err);
        if (requestedScope === studioScope && requestGen === scopeGeneration) {
          allMemories = [];
          renderList();
        }
      }
    }

    async function fetchStats() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/stats'));
        const s = await res.json();
        if (requestGen !== scopeGeneration) return;
        document.getElementById('statTotal').textContent = s.total || 0;
        document.getElementById('statConfirmed').textContent = Math.round((parseFloat(s.confirmedRatio) || 0) * 100) + '%';
        document.getElementById('statConstraints').textContent = s.constraints || 0;
        document.getElementById('statLinks').textContent = s.links || 0;
        renderAbout(s);
        if (studioScope === 'global' && s.available === false) {
          var absent = document.getElementById('scopeBanner');
          if (absent) { absent.textContent = 'No global store found at ~/.memory. Nothing to show in global scope.'; absent.hidden = false; }
        }
      } catch {}
    }

    const QUICK_START_AGENTS = [
      { id: 'claude-code', name: 'Claude Code', command: 'memory connect claude-code --harness claude' },
      { id: 'opencode', name: 'OpenCode', command: 'memory connect opencode' },
      { id: 'cursor', name: 'Cursor', command: 'memory connect cursor' },
      { id: 'antigravity', name: 'Antigravity', command: 'memory connect antigravity' },
    ];

    function copyText(text, label) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flash(label + ' copied.'); },
          function () { flash('Copy failed.', true); }
        );
      } else {
        flash('Clipboard unavailable in this browser.', true);
      }
    }

    const COMMAND_DECK = [
      { command: 'memory recall "<query>"', description: 'Retrieve ranked memories for a task' },
      { command: 'memory capture "<fact>"', description: 'Capture a durable fact or decision' },
      { command: 'memory current', description: 'Show active constraints and handoff state' },
      { command: 'memory brief', description: 'Compile a session brief' },
      { command: 'memory doctor', description: 'Validate the installation and store' },
      { command: 'memory adr create --title "<title>"', description: 'Record an architecture decision' },
      { command: 'memory sync --agent <id>', description: 'Exchange knowledge with peers' },
    ];

    function renderCommandDeck(filter) {
      const deck = document.getElementById('commandDeck');
      if (!deck) return;
      const needle = String(filter || '').toLowerCase();
      deck.innerHTML = '';
      COMMAND_DECK.filter(function (item) {
        return !needle || item.command.toLowerCase().indexOf(needle) >= 0 || item.description.toLowerCase().indexOf(needle) >= 0;
      }).forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'command-row';
        row.innerHTML = '<div><code>' + escapeHtml(item.command) + '</code><div class="command-desc">' + escapeHtml(item.description) + '</div></div>' +
          '<button type="button" class="btn-icon" data-copy-command="' + escapeHtml(item.command) + '">Copy</button>';
        row.querySelector('[data-copy-command]').addEventListener('click', function () {
          copyText(item.command, 'Command');
        });
        deck.appendChild(row);
      });
    }

    function renderQuickStart() {
      const grid = document.getElementById('quickStartGrid');
      if (!grid) return;
      grid.innerHTML = '';
      QUICK_START_AGENTS.forEach(function (agent, index) {
        const card = document.createElement('div');
        card.className = 'quickstart-card';
        card.innerHTML = '<div class="quickstart-step">STEP ' + String(index + 1).padStart(2, '0') + ' · ' + escapeHtml(agent.name) + '</div>' +
          '<code class="quickstart-cmd">' + escapeHtml(agent.command) + '</code>' +
          '<button type="button" class="btn-icon" data-copy-command="' + escapeHtml(agent.command) + '">Copy command</button>';
        card.querySelector('[data-copy-command]').addEventListener('click', function () {
          copyText(agent.command, agent.name + ' command');
        });
        grid.appendChild(card);
      });
    }

    function renderAbout(stats) {
      const scopeLabel = studioScope === 'global' ? '~/.memory' : studioScope === 'mesh' ? 'mesh' : './.memory';
      const set = function (id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      };
      set('aboutScope', scopeLabel);
      set('aboutTotal', stats.total || 0);
      set('aboutConstraints', stats.constraints || 0);
      set('aboutWiki', stats.wikiPages || 0);
      set('aboutAudit', stats.auditEvents || 0);
    }

    async function fetchCurrentState() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/current'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const h = data.handoff;
        if (h) {
          document.getElementById('handoffStatus').textContent = '[' + (h.status || 'IN-PROGRESS') + ']';
          document.getElementById('handoffAgent').textContent = h.agent || 'Unknown';
          document.getElementById('handoffSessionId').textContent = h.sessionId || '--';
          document.getElementById('handoffUpdated').textContent = h.lastUpdated ? new Date(h.lastUpdated).toLocaleTimeString() : '--';
          document.getElementById('handoffTask').textContent = h.task || 'No active task';
          
          let progHtml = '';
          if (h.progress && h.progress.length > 0) {
            progHtml += '<div style="font-weight:700; font-size:11px; color:var(--text-dim); margin-bottom:4px;">PROGRESS CHECKPOINTS:</div>';
            h.progress.forEach(p => { progHtml += '<div style="font-size:12px; color:var(--text); margin-bottom:2px;">• ' + escapeHtml(p) + '</div>'; });
          }
          document.getElementById('handoffProgressBox').innerHTML = progHtml;
        }
        const cList = document.getElementById('constraintsList');
        cList.innerHTML = '';
        if (data.lines && data.lines.length > 0) {
          data.lines.forEach(c => {
            const row = document.createElement('div');
            row.className = 'constraint-row';
            row.textContent = c;
            cList.appendChild(row);
          });
        } else {
          cList.innerHTML = '<div style="font-size:12px; color:var(--text-dim); padding:8px;">No active constraints registered.</div>';
        }
      } catch {}
    }

    async function fetchWikiPages() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/wiki'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const grid = document.getElementById('wikiPagesGrid');
        grid.innerHTML = '';
        document.getElementById('wikiCountBadge').textContent = (data.pages?.length || 0) + ' Pages';
        (data.pages || []).forEach(p => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'archetype-card';
          card.style.textAlign = 'left';
          card.innerHTML = '<span style="display:block; font-weight:700; color:#fff; font-size:14px; margin-bottom:4px;">📖 ' + escapeHtml(p.title) + '</span><span style="display:block; font-size:11px; color:var(--text-dim);">' + escapeHtml(p.slug) + '</span>';
          card.onclick = async () => {
            const pageRes = await fetch(apiUrl('/api/wiki?page=' + encodeURIComponent(p.slug)));
            const pageData = await pageRes.json();
            document.getElementById('wikiViewerCard').style.display = 'block';
            document.getElementById('wikiPageTitle').textContent = '📖 ' + pageData.title;
            document.getElementById('wikiPageContent').textContent = pageData.content;
          };
          grid.appendChild(card);
        });
      } catch {}
    }

    async function fetchUserProfile() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/user-profile'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        if (data.profile) {
          const profile = data.profile;
          const text = typeof profile === 'string' ? profile : (profile.raw || '');
          const archetype = typeof profile === 'object' ? profile.archetype : '';
          document.getElementById('userProfileText').value = text;
          document.querySelectorAll('.archetype-card[data-arch]').forEach(c => {
            const active = c.dataset.arch === archetype;
            if (active) c.classList.add('active');
            else c.classList.remove('active');
          });
        }
      } catch {}
    }

    async function saveUserProfile() {
      if (!requireProjectScope()) return;
      const content = document.getElementById('userProfileText').value;
      await fetch('/api/user-profile', { method: 'POST', body: JSON.stringify({ content }), headers: { 'Content-Type': 'application/json' } });
      flash('User profile saved successfully!');
    }

    async function loadAudit() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/audit'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        (data.trail || []).slice(0, 30).forEach(r => {
          const tr = document.createElement('tr');
          const opColor = r.operation === 'confirm' ? 'var(--green)' : r.operation === 'delete' ? 'var(--red)' : 'var(--accent)';
          tr.innerHTML = `
            <td class="mono" style="font-size:11px;">${escapeHtml(new Date(r.timestamp).toLocaleTimeString())}</td>
            <td><span class="op-badge" style="background:rgba(255,255,255,0.06); color:${escapeHtml(opColor)};">${escapeHtml(r.operation)}</span></td>
            <td class="mono">${escapeHtml(r.entry_id)}</td>
            <td>${escapeHtml(r.actor || 'system')}</td>
            <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(JSON.stringify(r.details || r.reason || ''))}</td>
          `;
          tbody.appendChild(tr);
        });
      } catch {}
    }

    async function testRetrieval() {
      const query = document.getElementById('sandboxQuery').value;
      const budget = parseInt(document.getElementById('sandboxBudgetSlider').value, 10);
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, tokenBudget: budget })
      });
      const data = await res.json();
      document.getElementById('promptContextOut').textContent = data.promptContext?.formatted || JSON.stringify(data, null, 2);
    }

    async function quickAddConstraint() {
      if (!requireProjectScope()) return;
      const text = prompt('Enter constraint rule to enforce:');
      if (!text) return;
      await fetch('/api/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      fetchCurrentState();
      flash('Constraint added!');
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderList() {
      const container = document.getElementById('memoryList');
      const fragment = document.createDocumentFragment();

      const q = searchQuery ? searchQuery.toLowerCase() : '';
      const filtered = allMemories.filter(m => {
        if (currentFilter !== 'all' && m.type !== currentFilter) return false;
        if (q) {
          const text = (m.title + ' ' + (m.content || '') + ' ' + (m.tags || []).join(' ')).toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

      filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'card' + (selectedMemory && selectedMemory.id === m.id ? ' selected' : '');
        card.dataset.id = m.id;
        card.innerHTML = `
          <div class="card-header">
            <div class="card-title">${escapeHtml(m.title)}</div>
            <div class="card-type type-${m.type || 'discovery'}">${m.type || 'discovery'}</div>
          </div>
          <div class="card-snippet">${escapeHtml(m.content || '')}</div>
          <div class="card-meta">
            <span class="mono">${m.id}${m.origin_project ? ' · from ' + escapeHtml(m.origin_project) : ''}</span>
            <div class="card-tags">${(m.tags || []).slice(0, 3).map(t => '<span class="card-tag">#' + escapeHtml(t) + '</span>').join('')}</div>
          </div>
        `;
        card.onclick = () => selectMemory(m);
        fragment.appendChild(card);
      });

      container.innerHTML = '';
      container.appendChild(fragment);
      if (studioView === 'list') renderStudioTable();
    }

    function setStudioView(view) {
      studioView = view === 'list' ? 'list' : 'graph';
      document.querySelectorAll('.view-btn').forEach(b => {
        var active = b.dataset.studioView === studioView;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      var graphOnly = document.getElementById('graphOnlyControls');
      if (graphOnly) graphOnly.style.display = studioView === 'graph' ? 'flex' : 'none';
      var graphBox = document.getElementById('graphContainer');
      if (graphBox) graphBox.hidden = studioView !== 'graph';
      var listBox = document.getElementById('studioListView');
      if (listBox) listBox.hidden = studioView !== 'list';
      var label = document.getElementById('studioViewLabel');
      if (label) label.textContent = studioView === 'graph' ? 'Canvas graph' : 'Filterable table';
      if (studioView === 'list') renderStudioTable();
      else wakeGraph();
    }

    function studioRows() {
      var q = listQuery.toLowerCase();
      var rows = allMemories.filter(function (m) {
        if (currentFilter !== 'all' && m.type !== currentFilter) return false;
        if (!q) return true;
        var text = (m.title + ' ' + (m.content || '') + ' ' + (m.tags || []).join(' ')).toLowerCase();
        return text.indexOf(q) >= 0;
      });
      var dir = listSort.dir === 'asc' ? 1 : -1;
      rows.sort(function (a, b) {
        var av = String(a[listSort.key] == null ? '' : a[listSort.key]);
        var bv = String(b[listSort.key] == null ? '' : b[listSort.key]);
        return av.localeCompare(bv) * dir;
      });
      return rows;
    }

    function renderStudioTable() {
      var body = document.getElementById('studioTableBody');
      if (!body) return;
      var rows = studioRows();
      var fragment = document.createDocumentFragment();
      rows.forEach(function (m) {
        var tr = document.createElement('tr');
        tr.dataset.id = m.id;
        tr.innerHTML = '<td><strong>' + escapeHtml(m.title) + '</strong></td>' +
          '<td>' + escapeHtml(m.type || 'discovery') + '</td>' +
          '<td>' + escapeHtml(m.status || '') + '</td>' +
          '<td>' + escapeHtml(m.project || '—') + '</td>' +
          '<td class="mono">' + escapeHtml(String(m.created_at || '').slice(0, 10)) + '</td>';
        tr.onclick = function () { selectMemory(m); };
        fragment.appendChild(tr);
      });
      body.innerHTML = '';
      body.appendChild(fragment);
      var count = document.getElementById('studioListCount');
      if (count) count.textContent = rows.length + ' rows';
      document.querySelectorAll('.studio-table th[data-sort]').forEach(function (th) {
        th.setAttribute('aria-sort', th.dataset.sort === listSort.key ? (listSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }

    function selectMemory(m) {
      if (!m) return;
      selectedMemory = m;
      document.querySelectorAll('#memoryList .card.selected').forEach(c => c.classList.remove('selected'));
      const activeCard = document.querySelector(`#memoryList .card[data-id="${m.id}"]`);
      if (activeCard) activeCard.classList.add('selected');

      const pane = document.getElementById('detailPane');
      pane.classList.add('open');
      document.getElementById('dTitle').textContent = m.title;

      const meta = document.getElementById('dMeta');
      meta.innerHTML = `
        <span class="meta-tag mono">ID: ${m.id}</span>
        <span class="meta-tag">Status: ${m.status}</span>
        <span class="meta-tag">Salience: ${m.salience || 0.5}</span>
        <span class="meta-tag">Verification: ${m.verification ? m.verification.level : 'unverified'}</span>
        <span class="meta-tag">Links: ${(m.related_memory_ids || []).length}</span>
      `;

      document.getElementById('dContent').textContent = m.content;

      const actions = document.getElementById('dActions');
      actions.innerHTML = '';
      if (m.status !== 'confirmed') {
        const cBtn = document.createElement('button');
        cBtn.className = 'btn btn-green';
        cBtn.textContent = 'Confirm Memory';
        cBtn.onclick = () => confirmMem(m.id);
        actions.appendChild(cBtn);
      }
      if (m.status === 'active' || m.status === 'confirmed') {
        const sBtn = document.createElement('button');
        sBtn.className = 'btn btn-yellow';
        sBtn.textContent = 'Mark Stale';
        sBtn.onclick = () => staleMem(m.id);
        actions.appendChild(sBtn);
      }
      const dBtn = document.createElement('button');
      dBtn.className = 'btn btn-red';
      dBtn.textContent = 'Delete';
      dBtn.onclick = async () => {
        if (confirm('Delete memory ' + m.id + '?')) {
          await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) });
          loadData();
          pane.classList.remove('open');
          flash('Deleted memory ' + m.id);
        }
      };
      actions.appendChild(dBtn);
    }

    async function confirmMem(id) {
      return mutateMemory(id, '/api/confirm');
    }

    async function staleMem(id) {
      return mutateMemory(id, '/api/mark-stale');
    }

    function flash(msg, isError) {
      let el = document.getElementById('flashMsg');
      if (!el) {
        el = document.createElement('div');
        el.id = 'flashMsg';
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:999;max-width:380px;display:none;box-shadow:0 8px 30px rgba(0,0,0,0.6);backdrop-filter:blur(10px);';
        document.body.appendChild(el);
      }
      el.style.background = isError ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
      el.style.color = '#fff';
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
    }

    async function mutateMemory(id, endpoint) {
      if (!requireProjectScope()) return;
      try {
        const body = endpoint === '/api/mark-stale' ? { id, reason: 'Marked via Web UI' } : { id };
        const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { msg = (await res.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        await loadData();
        const updated = allMemories.find(m => m.id === id);
        if (updated) selectMemory(updated);
        flash(endpoint === '/api/mark-stale' ? 'Marked stale' : 'Confirmed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        flash('Action failed: ' + msg, true);
      }
    }

    function nodeVisible(n) {
      if (hiddenClusters.has('project:' + (n.project || 'none'))) return false;
      if (hiddenClusters.has('type:' + n.type)) return false;
      if (timelineCutoff && n.updatedAt < timelineCutoff) return false;
      if (currentFilter !== 'all' && n.type !== currentFilter) return false;
      if (searchQuery) {
        const text = (n.title + ' ' + (n.content || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
        if (!text.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    }

    let needsRedraw = true;
    function requestRedraw() {
      needsRedraw = true;
    }

    function initGraph() {
      const byId = new Map(nodes3d.map(n => [n.id, n]));
      const degreeOf = new Map();
      for (const m of allMemories) {
        for (const rid of (m.related_memory_ids || [])) {
          degreeOf.set(m.id, (degreeOf.get(m.id) || 0) + 1);
        }
      }
      nodes3d = allMemories.map((m, i) => {
        const prev = byId.get(m.id);
        const angle = (i / Math.max(1, allMemories.length)) * Math.PI * 2;
        return {
          id: m.id,
          title: m.title,
          type: m.type || 'discovery',
          status: m.status,
          project: m.project,
          content: m.content || '',
          tags: m.tags || [],
          updatedAt: m.updated_at || '',
          degree: degreeOf.get(m.id) || 0,
          x: prev ? prev.x : Math.cos(angle) * 260,
          y: prev ? prev.y : Math.sin(angle * 2) * 45,
          z: prev ? prev.z : Math.sin(angle) * 260,
        };
      });

      const nodeMap = new Map(nodes3d.map(n => [n.id, n]));
      edges3d = [];
      for (const m of allMemories) {
        const a = nodeMap.get(m.id);
        if (!a) continue;
        for (const rid of (m.related_memory_ids || [])) {
          const b = nodeMap.get(rid);
          if (b) edges3d.push([a, b]);
        }
      }
      simAlpha = 1;
      graphEnergy = Infinity;
      needsRedraw = true;
    }

    function simulateStep() {
      if (nodes3d.length === 0 || simAlpha <= 0.03) { graphEnergy = 0; return; }
      const alpha = simAlpha;
      let energy = 0;
      for (let i = 0; i < nodes3d.length; i++) {
        const a = nodes3d[i];
        for (let j = i + 1; j < nodes3d.length; j++) {
          const b = nodes3d[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          let dist2 = dx * dx + dy * dy + dz * dz + 0.01;
          const force = (2400 * alpha) / dist2;
          const dist = Math.sqrt(dist2);
          dx /= dist; dy /= dist; dz /= dist;
          a.x += dx * force; a.y += dy * force; a.z += dz * force;
          b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
          energy += Math.abs(force) * 2;
        }
      }
      for (let i = 0; i < edges3d.length; i++) {
        const [a, b] = edges3d[i];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const target = 120;
        const force = ((dist - target) / dist) * 0.02 * alpha;
        a.x += dx * force; a.y += dy * force; a.z += dz * force;
        b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
        energy += Math.abs(force) * 2;
      }
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        n.x *= (1 - 0.002 * alpha);
        n.y *= (1 - 0.002 * alpha);
        n.z *= (1 - 0.002 * alpha);
        energy += (Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z)) * 0.002 * alpha;
      }
      simAlpha = Math.max(0.02, simAlpha * 0.985);
      graphEnergy = energy / nodes3d.length;
    }

    function project(x, y, z, width, height) {
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      let x1 = x * cosY - z * sinY;
      let z1 = x * sinY + z * cosY;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      let y1 = y * cosX - z1 * sinX;
      let z2 = y * sinX + z1 * cosX;
      const fov = 600;
      const scale = (fov / (fov + z2 + 400)) * zoom;
      return { sx: width / 2 + x1 * scale, sy: height / 2 + y1 * scale, scale };
    }

    function drawGraph(canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!nodes3d.length) {
        ctx.fillStyle = '#8b949e';
        ctx.font = '14px sans-serif';
        ctx.fillText('No memories yet — capture some first.', canvas.width / 2 - 110, canvas.height / 2);
        return;
      }

      const projected = new Map();
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        n.visible = nodeVisible(n);
        if (n.visible) projected.set(n, project(n.x, n.y, n.z, canvas.width, canvas.height));
      }

      // Edges with glow
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < edges3d.length; i++) {
        const [a, b] = edges3d[i];
        if (!a || !b || !a.visible || !b.visible) continue;
        const pa = projected.get(a), pb = projected.get(b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }

      // Nodes
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        if (!n.visible) continue;
        const p = projected.get(n);
        if (!p) continue;
        const radius = (6 + Math.min(10, n.degree * 2)) * p.scale;
        
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.type] || '#8b949e';
        ctx.globalAlpha = n.status === 'stale' || n.status === 'superseded' ? 0.35 : 1;
        ctx.fill();
        ctx.strokeStyle = selectedMemory && selectedMemory.id === n.id ? '#ffffff' : '#090d14';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (nodes3d.length <= 40 || zoom > 1.4) {
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '500 11px JetBrains Mono, monospace';
          ctx.fillText(n.title.slice(0, 26), p.sx + radius + 6, p.sy + 4);
        }
      }
    }

    function tick() {
      if (documentHidden) {
        graphLoopStarted = false;
        return;
      }
      if (currentTab === 'graph') {
        const canvas = document.getElementById('graphCanvas');
        if (canvas) {
          const parent = canvas.parentElement;
          if (parent) {
            const w = parent.clientWidth;
            const h = parent.clientHeight;
            if (w > 0 && (canvas.width !== w || canvas.height !== h)) {
              canvas.width = w;
              canvas.height = h;
              needsRedraw = true;
            }
          }
          if (simAlpha > 0.03) {
            simulateStep();
            needsRedraw = true;
          }
          if (needsRedraw || dragging) {
            drawGraph(canvas);
            needsRedraw = false;
          }
          if (!dragging && graphEnergy < SETTLE_ENERGY) {
            graphLoopStarted = false;
            return;
          }
        }
      } else {
        graphLoopStarted = false;
        return;
      }
      requestAnimationFrame(tick);
    }

    function wakeGraph() {
      if (nodes3d.length === 0) { needsRedraw = true; return; }
      simAlpha = Math.max(simAlpha, 0.6);
      graphEnergy = Infinity;
      needsRedraw = true;
      if (!graphLoopStarted) {
        graphLoopStarted = true;
        requestAnimationFrame(tick);
      }
    }

    function buildClusterFilters() {
      const container = document.getElementById('clusterFilters');
      container.querySelectorAll('.cluster-check').forEach(el => el.remove());
      const projects = [...new Set(allMemories.map(m => m.project || 'none'))];
      const types = [...new Set(allMemories.map(m => m.type || 'discovery'))];
      const makeCheck = (group, value) => {
        const label = document.createElement('label');
        label.className = 'cluster-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !hiddenClusters.has(group + ':' + value);
        box.onchange = () => {
          if (box.checked) hiddenClusters.delete(group + ':' + value);
          else hiddenClusters.add(group + ':' + value);
          wakeGraph();
        };
        label.appendChild(box);
        label.appendChild(document.createTextNode(value));
        container.appendChild(label);
      };
      projects.forEach(p => makeCheck('project', p));
      types.forEach(t => makeCheck('type', t));
    }

    function setupTimeline() {
      const slider = document.getElementById('timelineSlider');
      const label = document.getElementById('timelineLabel');
      const times = allMemories.map(m => Date.parse(m.updated_at || '')).filter(t => !Number.isNaN(t));
      if (times.length === 0) { slider.disabled = true; label.textContent = 'n/a'; return; }
      slider.disabled = false;
      const min = times.reduce((a, b) => (b < a ? b : a), Infinity), max = times.reduce((a, b) => (b > a ? b : a), -Infinity);
      slider.oninput = () => {
        const t = parseInt(slider.value, 10) / 1000;
        if (t >= 1) { timelineCutoff = null; label.textContent = 'all'; }
        else {
          const cutoffMs = min + (max - min) * t;
          timelineCutoff = new Date(cutoffMs).toISOString();
          label.textContent = new Date(cutoffMs).toLocaleDateString();
        }
        wakeGraph();
      };
    }

    function setupCanvasInteractions() {
      const canvas = document.getElementById('graphCanvas');
      canvas.addEventListener('pointerdown', (e) => {
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
        wakeGraph();
      });
      canvas.addEventListener('pointerup', (e) => {
        if (canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId);
        wakeGraph();
      });
      canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        wakeGraph();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        rotY += dx * 0.005;
        rotX = Math.max(-1.4, Math.min(1.4, rotX + dy * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        wakeGraph();
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
        wakeGraph();
      });
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.max(0.3, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
        wakeGraph();
      }, { passive: false });
      canvas.addEventListener('click', (e) => {
        if (dragMoved) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null, bestDist = Infinity;
        for (let i = 0; i < nodes3d.length; i++) {
          const n = nodes3d[i];
          if (!nodeVisible(n)) continue;
          const p = project(n.x, n.y, n.z, canvas.width, canvas.height);
          const d = Math.hypot(p.sx - mx, p.sy - my);
          const hitR = (6 + Math.min(10, n.degree * 2)) * p.scale + 6;
          if (d < hitR && d < bestDist) { best = n; bestDist = d; }
        }
        if (best) {
          const mem = allMemories.find(m => m.id === best.id);
          if (mem) selectMemory(mem);
        }
      });
    }

    let terrainFiles = [];
    let terrainSelected = null;

    let hubAgents = [];
    let agentManifest = null;

    async function fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        hubAgents = data.agents || [];
        renderAgents(data.counts || {});
      } catch (err) {
        console.error('Failed to load agents:', err);
      }
    }

    function renderAgents(counts) {
      const grid = document.getElementById('agentsGrid');
      const badge = document.getElementById('agentsCounts');
      if (!grid) return;
      if (badge) badge.textContent = (counts.wired || 0) + ' wired · ' + (counts.unwired || 0) + ' unwired';
      grid.innerHTML = '';
      hubAgents.forEach(function (agent) {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.dataset.agent = agent.id;
        const cls = agent.status === 'WIRED' ? 'wired' : agent.status === 'UNWIRED' ? 'unwired' : 'absent';
        const detail = agent.configPath
          ? '<div class="agent-meta mono">' + escapeHtml(agent.configPath) + '</div>'
          : agent.binaryPath ? '<div class="agent-meta mono">' + escapeHtml(agent.binaryPath) + '</div>' : '';
        var actions = '';
        if (agent.status === 'UNWIRED') actions = '<div class="agent-actions"><button type="button" class="btn btn-green" data-wire="' + escapeHtml(agent.id) + '">Wire</button></div>';
        else if (agent.status === 'WIRED') actions = '<div class="agent-actions"><button type="button" class="btn btn-red" data-unwire="' + escapeHtml(agent.id) + '">Unwire</button></div>';
        card.innerHTML = '<div class="agent-card-head"><strong>' + escapeHtml(agent.name) + '</strong>' +
          '<span class="agent-status ' + cls + '">' + escapeHtml(agent.status) + '</span></div>' +
          '<div class="agent-meta">' + escapeHtml(agent.description) + '</div>' + detail + actions;
        card.querySelectorAll('[data-wire]').forEach(function (btn) {
          btn.addEventListener('click', function () { wireAgent(btn.dataset.wire); });
        });
        card.querySelectorAll('[data-unwire]').forEach(function (btn) {
          btn.addEventListener('click', function () { unwireAgent(btn.dataset.unwire); });
        });
        grid.appendChild(card);
      });
    }

    async function fetchAgentManifest() {
      try {
        const res = await fetch('/api/agents/manifest');
        agentManifest = await res.json();
        const paths = document.getElementById('agentManifestPaths');
        const snippet = document.getElementById('agentManifestSnippet');
        if (paths) paths.textContent = 'Memory: ' + agentManifest.memoryDir + '  ·  DB: ' + agentManifest.database;
        if (snippet) snippet.textContent = agentManifest.snippet;
      } catch (err) {
        console.error('Failed to load agent manifest:', err);
      }
    }

    function copyAgentSnippet() {
      if (!agentManifest) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(agentManifest.snippet).then(
          function () { flash('Manifest snippet copied.'); },
          function () { flash('Copy failed.', true); }
        );
      } else {
        flash('Clipboard unavailable in this browser.', true);
      }
    }

    async function wireAgent(id) {
      if (!confirm('Wire ' + id + '? This may update its config; a timestamped .bak backup is created first.')) return;
      try {
        const res = await fetch('/api/agents/wire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, harness: id })
        });
        const data = await res.json();
        if (!res.ok || data.success !== true) {
          const message = data.error || (data.reports && data.reports[0] ? data.reports[0].message : res.status);
          flash('Wire failed: ' + message, true);
          return;
        }
        flash('Wired ' + id + '. Backups: ' + ((data.backups && data.backups.length) ? data.backups.join(', ') : 'none'));
        fetchAgents();
      } catch (err) { flash('Wire failed: ' + String(err), true); }
    }

    async function unwireAgent(id) {
      try {
        const res = await fetch('/api/agents/unwire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, harness: id })
        });
        const data = await res.json();
        if (!res.ok || data.success !== true) {
          const message = data.error || (data.report && data.report.message) || res.status;
          flash('Unwire failed: ' + message, true);
          return;
        }
        flash('Unwired ' + id + '.');
        fetchAgents();
      } catch (err) { flash('Unwire failed: ' + String(err), true); }
    }

    async function fetchTerrain() {
      try {
        const res = await fetch('/api/terrain');
        const data = await res.json();
        terrainFiles = data.files || [];
        renderTerrainTree();
      } catch (err) {
        console.error('Failed to load terrain:', err);
      }
    }

    function renderTerrainTree() {
      const tree = document.getElementById('terrainTree');
      if (!tree) return;
      tree.innerHTML = '';
      terrainFiles.forEach(function (file) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'terrain-tree-item' + (terrainSelected === file.name ? ' active' : '');
        btn.dataset.terrain = file.name;
        btn.innerHTML = '<span>' + escapeHtml(file.name) + '</span><span class="gen-badge' + (file.generated ? '' : ' missing') + '">' + (file.generated ? 'GEN' : 'MISSING') + '</span>';
        btn.onclick = function () { selectTerrainFile(file.name); };
        tree.appendChild(btn);
      });
      if (!terrainSelected && terrainFiles.length > 0) selectTerrainFile(terrainFiles[0].name);
      else if (terrainSelected) selectTerrainFile(terrainSelected);
    }

    function terrainInline(text) {
      return text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    function renderTerrainMarkdown(markdown) {
      const lines = escapeHtml(markdown).split('\n');
      let html = '', inList = false;
      const closeList = function () { if (inList) { html += '</ul>'; inList = false; } };
      lines.forEach(function (line) {
        if (/^### /.test(line)) { closeList(); html += '<h4>' + terrainInline(line.slice(4)) + '</h4>'; }
        else if (/^## /.test(line)) { closeList(); html += '<h3>' + terrainInline(line.slice(3)) + '</h3>'; }
        else if (/^# /.test(line)) { closeList(); html += '<h2>' + terrainInline(line.slice(2)) + '</h2>'; }
        else if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + terrainInline(line.slice(2)) + '</li>'; }
        else if (/^\|/.test(line)) { closeList(); html += '<div class="terrain-row">' + terrainInline(line) + '</div>'; }
        else if (line.trim() === '') { closeList(); }
        else { closeList(); html += '<p>' + terrainInline(line) + '</p>'; }
      });
      closeList();
      return html || '<p class="activity-empty">Map is empty.</p>';
    }

    function selectTerrainFile(name) {
      terrainSelected = name;
      const file = terrainFiles.find(function (item) { return item.name === name; });
      const label = document.getElementById('terrainFileName');
      const content = document.getElementById('terrainContent');
      if (label) label.textContent = name;
      if (content) {
        content.innerHTML = file && file.generated
          ? renderTerrainMarkdown(file.content)
          : '<p class="activity-empty">This map has not been compiled yet. Press REINDEX.</p>';
      }
      document.querySelectorAll('.terrain-tree-item').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.terrain === name);
      });
    }

    async function reindexTerrain() {
      const button = document.getElementById('terrainReindex');
      if (button) button.disabled = true;
      try {
        await fetch('/api/terrain/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        await fetchTerrain();
        const scan = document.getElementById('terrainScanline');
        if (scan) {
          scan.classList.remove('active');
          void scan.offsetWidth;
          scan.classList.add('active');
          setTimeout(function () { scan.classList.remove('active'); }, 900);
        }
        flash('Terrain maps recompiled.');
      } catch (err) {
        flash('Terrain reindex failed: ' + String(err), true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function fetchActivity() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/activity'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        renderActivity(data);
      } catch (err) {
        console.error('Failed to load activity:', err);
      }
    }

    function renderActivity(data) {
      const grid = document.getElementById('activityHeatmap');
      const sessions = document.getElementById('activitySessions');
      const badge = document.getElementById('activityMutations');
      if (!grid || !sessions) return;

      const days = data.days || [];
      grid.innerHTML = '';
      const cells = document.createDocumentFragment();
      days.forEach(function (day) {
        const cell = document.createElement('div');
        const level = day.count === 0 ? 0 : day.count < 3 ? 1 : day.count < 6 ? 2 : day.count < 10 ? 3 : 4;
        cell.className = 'hm-cell level-' + level;
        cell.title = day.date + ': ' + day.count + ' mutations';
        cells.appendChild(cell);
      });
      grid.appendChild(cells);
      if (badge) badge.textContent = (data.total_mutations || 0) + ' mutations';

      sessions.innerHTML = '';
      const list = data.sessions || [];
      if (list.length === 0) {
        sessions.innerHTML = '<div class="activity-empty">No agent sessions recorded yet. Sessions appear when an agent starts one.</div>';
        return;
      }
      list.forEach(function (session) {
        const card = document.createElement('div');
        card.className = 'session-card';
        const tags = (session.tags || []).map(function (tag) {
          return '<span class="card-tag">#' + escapeHtml(tag) + '</span>';
        }).join('');
        const started = String(session.started_at || '').slice(0, 16).replace('T', ' ');
        const ended = session.ended_at ? ' · ended ' + escapeHtml(String(session.ended_at).slice(0, 16).replace('T', ' ')) : '';
        card.innerHTML = '<div class="session-card-head"><strong>' + escapeHtml(session.title) + '</strong>' +
          '<span class="session-status ' + (session.status === 'active' ? 'active' : 'done') + '">' + escapeHtml(session.status) + '</span></div>' +
          '<div class="session-meta mono">' + escapeHtml(session.session_id) + '</div>' +
          '<div class="session-meta">Started ' + escapeHtml(started) + ended + '</div>' +
          '<div class="session-card-foot"><span>' + (session.messages || 0) + ' messages</span><div class="card-tags">' + tags + '</div></div>';
        sessions.appendChild(card);
      });
    }

    function exportDataHtml() {
      window.open('/api/export-html', '_blank');
    }

    // R15 Studio Loaders
    async function fetchHealth() {
      try {
        const res = await fetch('/api/health' + projectScopeQuery());
        const data = await res.json();
        renderHealth(data);
      } catch (err) {
        console.error('Failed to load health report:', err);
      }
    }

    // T-321: mirrors the CLI scope wording — "N memories across M project(s)".
    function formatHealthScope(scope) {
      if (!scope) return 'Scope: --';
      const count = scope.entry_count || 0;
      const projectCount = (scope.projects || []).length;
      const memories = count === 1 ? 'memory' : 'memories';
      const projects = projectCount === 1 ? 'project' : 'projects';
      const label = scope.filter ? 'project "' + scope.filter + '"' : 'entire store';
      return 'Scope: ' + label + ' (' + count + ' ' + memories + ' across ' + projectCount + ' ' + projects + '); code-side metrics cover the ' + (scope.code_scope || 'workspace') + '.';
    }

    function renderHealth(data) {
      if (!data) return;
      const gradeEl = document.getElementById('healthGrade');
      const scoreEl = document.getElementById('healthScore');
      const gateEl = document.getElementById('healthGate');
      const summaryEl = document.getElementById('healthSummary');
      const scopeEl = document.getElementById('healthScope');
      const scopeProjectEl = document.getElementById('healthScopeProject');
      const grade = data.overall_grade || data.grade || '--';
      const score = data.overall_score !== undefined ? data.overall_score : (data.score || 0);
      if (gradeEl) {
        gradeEl.textContent = grade;
        gradeEl.className = 'grade-circle grade-' + grade.charAt(0).toLowerCase();
      }
      if (scoreEl) scoreEl.textContent = Math.round(score) + '/100';
      if (gateEl) {
        gateEl.textContent = '[' + (data.gate_status || 'WARN') + ']';
        gateEl.className = 'gate-badge gate-' + (data.gate_status || 'WARN').toLowerCase();
      }
      if (summaryEl) summaryEl.textContent = data.summary || '';
      if (scopeEl) scopeEl.textContent = formatHealthScope(data.scope);
      if (scopeProjectEl) scopeProjectEl.textContent = 'Project: ' + (data.project || '--');

      if (data.pillars) {
        const p1 = data.pillars.store_integrity || data.pillars.memory_integrity;
        if (p1) {
          document.getElementById('pStoreScore').textContent = Math.round(p1.score || 0) + '%';
          document.getElementById('pStoreBar').style.width = Math.round(p1.score || 0) + '%';
          document.getElementById('pStoreContradictions').textContent = p1.metrics?.contradictions ?? p1.contradictions_flagged ?? 0;
          document.getElementById('pStoreExpired').textContent = p1.metrics?.expired_count ?? p1.expired_memories ?? 0;
        }

        const p2 = data.pillars.code_anchors || data.pillars.native_code_anchors;
        if (p2) {
          document.getElementById('pAnchorsScore').textContent = Math.round(p2.score || p2.validity_score || 0) + '%';
          document.getElementById('pAnchorsBar').style.width = Math.round(p2.score || p2.validity_score || 0) + '%';
          document.getElementById('pAnchorsValid').textContent = p2.metrics?.valid_anchors ?? p2.valid ?? 0;
          document.getElementById('pAnchorsDrifted').textContent = p2.metrics?.drifted_anchors ?? p2.drifted ?? 0;
        }

        const p3 = data.pillars.doc_code_alignment || data.pillars.documentation_drift;
        if (p3) {
          document.getElementById('pDocScore').textContent = Math.round(p3.score || p3.alignment_score || 0) + '%';
          document.getElementById('pDocBar').style.width = Math.round(p3.score || p3.alignment_score || 0) + '%';
          document.getElementById('pDocDoc').textContent = p3.metrics?.documented_count ?? p3.documented ?? 0;
          document.getElementById('pDocMissing').textContent = p3.metrics?.missing_count ?? p3.missing ?? 0;
        }

        const p4 = data.pillars.negative_anti_patterns || data.pillars.negative_lessons_sentry;
        if (p4) {
          document.getElementById('pLessonsScore').textContent = Math.round(p4.score || p4.defense_score || 0) + '%';
          document.getElementById('pLessonsBar').style.width = Math.round(p4.score || p4.defense_score || 0) + '%';
          document.getElementById('pLessonsTotal').textContent = p4.metrics?.total_negative_lessons ?? p4.total_lessons ?? 0;
          document.getElementById('pLessonsActive').textContent = p4.metrics?.active_traps ?? p4.active_traps ?? 0;
        }

        const p5 = data.pillars.technical_debt || data.pillars.technical_debt_friction;
        if (p5) {
          document.getElementById('pDebtScore').textContent = Math.round(p5.score || p5.fragility_score || 0) + '%';
          document.getElementById('pDebtBar').style.width = Math.round(p5.score || p5.fragility_score || 0) + '%';
          document.getElementById('pDebtTodos').textContent = p5.metrics?.todo_count ?? p5.todo_count ?? 0;
          document.getElementById('pDebtFragile').textContent = p5.metrics?.fragile_subsystems ?? p5.fragile_subsystems ?? 0;
        }
      }

      const tbody = document.getElementById('healthChecklistBody');
      if (tbody) {
        tbody.innerHTML = '';
        const list = data.actionable_checklist || data.checklist || [];
        list.forEach(item => {
          const tr = document.createElement('tr');
          if (typeof item === 'string') {
            tr.innerHTML = `
              <td><span class="priority-badge priority-high">[RECOMMENDED]</span></td>
              <td colspan="2"><strong>${escapeHtml(item)}</strong></td>
            `;
          } else {
            const rawPriority = String(item.priority || 'medium');
            const safePriority = escapeHtml(rawPriority);
            const pillClass = 'priority-' + rawPriority.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            tr.innerHTML = `
              <td><span class="priority-badge ${pillClass}">[${safePriority}]</span></td>
              <td><strong>${escapeHtml(item.issue)}</strong></td>
              <td>${escapeHtml(item.action)}</td>
            `;
          }
          tbody.appendChild(tr);
        });
      }
    }

    async function fetchAdrs() {
      try {
        const res = await fetch('/api/adrs');
        const list = await res.json();
        const container = document.getElementById('adrsListGrid');
        if (container) {
          container.innerHTML = '';
          if (!list || list.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No ADRs recorded yet. Capture with memory_adr_record.</div>';
          } else {
            list.forEach(adr => {
              const card = document.createElement('div');
              card.className = 'view-card';
              card.innerHTML = `
                <div class="card-header">
                  <div class="card-title">${escapeHtml(adr.title)}</div>
                  <span class="adr-badge adr-${(adr.status || 'proposed').toLowerCase()}">${adr.status}</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;"><strong>Context:</strong> ${escapeHtml(adr.context || '')}</div>
                <div style="font-size:12px; color:#f1f5f9; margin-bottom:6px;"><strong>Decision:</strong> ${escapeHtml(adr.decision || '')}</div>
                <div style="font-size:11px; color:var(--text-dim);"><strong>Consequences:</strong> ${escapeHtml(adr.consequences || '')}</div>
              `;
              container.appendChild(card);
            });
          }
        }
      } catch (err) {
        console.error('Failed to load ADRs:', err);
      }
    }

    async function fetchDrift() {
      try {
        const res = await fetch('/api/drift' + projectScopeQuery());
        const drift = await res.json();
        const tbody = document.getElementById('driftTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          const list = drift.items || drift.classified || [];
          list.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td class="mono"><strong>${escapeHtml(item.symbol)}</strong></td>
              <td><span class="drift-badge drift-${(item.status || 'documented').toLowerCase()}">${item.status}</span></td>
              <td style="font-size:11px; color:var(--text-dim);">${escapeHtml(item.docRef || item.codeRef || item.path || '')}</td>
              <td style="font-size:12px;">${escapeHtml(item.explanation || '')}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load drift audit:', err);
      }
    }

    async function explainWhyCode() {
      const q = (document.getElementById('whyInput').value || '').trim();
      if (!q) return;
      try {
        const res = await fetch('/api/cognition/why', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol_or_path: q })
        });
        const data = await res.json();
        const out = document.getElementById('whyOutput');
        if (out) {
          out.style.display = 'block';
          out.innerHTML = `
            <div class="card-title-lg" style="margin-bottom:8px;">🏛️ Architectural Rationale for <code>${escapeHtml(q)}</code></div>
            <p style="font-size:13px; line-height:1.6; color:#f1f5f9; margin-bottom:12px;">${escapeHtml(data.core_rationale || data.inferred_rationale || 'No specific rationale recorded.')}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12px;">
              <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid var(--panel-border);">
                <div style="font-weight:700; color:var(--green); margin-bottom:4px;">Historical Bug Fixes & Lessons</div>
                <div>${(data.timeline || data.preceding_failures || []).length > 0 ? (data.timeline || data.preceding_failures).map(f => '• ' + escapeHtml(f.title || f.summary || '')).join('<br>') : 'None recorded'}</div>
              </div>
              <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid var(--panel-border);">
                <div style="font-weight:700; color:#fbbf24; margin-bottom:4px;">Trade-offs & Constraints</div>
                <div>${(data.trade_offs_accepted || data.trade_offs_recorded || []).length > 0 ? (data.trade_offs_accepted || data.trade_offs_recorded).map(t => '• ' + escapeHtml(t.title || t.trade_off || '')).join('<br>') : 'None recorded'}</div>
              </div>
            </div>
          `;
        }
      } catch (err) {
        flash('Why Reasoner query failed', true);
      }
    }

    async function fetchCognition() {
      try {
        const [clustRes, debtRes] = await Promise.all([
          fetch('/api/cognition/clusters' + projectScopeQuery()),
          fetch('/api/cognition/debt' + projectScopeQuery())
        ]);
        const clustersData = await clustRes.json();
        const debtData = await debtRes.json();

        const grid = document.getElementById('clustersGrid');
        if (grid) {
          grid.innerHTML = '';
          (clustersData.clusters || []).forEach(c => {
            const el = document.createElement('div');
            el.className = 'cluster-card';
            el.innerHTML = `
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span class="mono" style="font-weight:700; color:#f1f5f9;">${escapeHtml(c.subsystem)}</span>
                <span class="badge-cause badge-${c.root_cause}">${c.root_cause}</span>
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">${escapeHtml(c.pattern_summary)}</div>
              <div style="font-size:11px; color:var(--text-dim);">Frequency: <strong>${c.frequency}</strong> &bull; Fragility: <strong>${(c.fragility_score * 100).toFixed(0)}%</strong></div>
            `;
            grid.appendChild(el);
          });
        }

        const debtBody = document.getElementById('debtTableBody');
        if (debtBody) {
          debtBody.innerHTML = '';
          const list = debtData.hotspot_files || debtData.hotspots || debtData.items || [];
          list.slice(0, 10).forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td class="mono">${escapeHtml(h.file || h.filePath || '')}</td>
              <td>${h.todo_count ?? 0}</td>
              <td>${h.fixme_count ?? 0}</td>
              <td><span class="badge-cause badge-${h.risk_level || h.severity || 'low'}">${h.risk_level || h.severity || 'low'}</span></td>
            `;
            debtBody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load cognition data:', err);
      }
    }

    async function fetchSyncStatus() {
      try {
        const res = await fetch('/api/sync/status');
        const data = await res.json();
        document.getElementById('syncLocalAgent').textContent = data.local_agent_id || '--';
        document.getElementById('syncTotalPeers').textContent = data.total_peers || 0;
        document.getElementById('syncPendingMemories').textContent = data.pending_outgoing_memories || 0;
        document.getElementById('syncLastAt').textContent = data.last_sync_at ? new Date(data.last_sync_at).toLocaleTimeString() : 'Never';

        const tbody = document.getElementById('syncPeersTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          (data.known_peers || []).forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td class="mono"><strong>${escapeHtml(p.agent_id)}</strong></td>
              <td>${p.last_seen_at ? new Date(p.last_seen_at).toLocaleTimeString() : '--'}</td>
              <td>${p.total_packets_received || 0}</td>
              <td>${p.total_memories_ingested || 0}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load sync status:', err);
      }
    }

    async function broadcastSyncPacket() {
      if (!requireProjectScope()) return;
      try {
        const res = await fetch('/api/sync/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const packet = await res.json();
        flash('✓ Broadcasted packet ' + packet.packet_id + ' (' + packet.payload.memories.length + ' memories)');
        fetchSyncStatus();
      } catch (err) {
        flash('Broadcast failed', true);
      }
    }

    async function syncPool() {
      if (!requireProjectScope()) return;
      try {
        const res = await fetch('/api/sync/pool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const report = await res.json();
        flash('✓ Synced with shared pool: ingested ' + report.total_ingested + ' new memories from ' + report.peers_contacted.length + ' peers');
        fetchSyncStatus();
      } catch (err) {
        flash('Pool sync failed', true);
      }
    }

    // R16 Mesh Loaders
    async function fetchMeshStatus() {
      try {
        const res = await fetch('/api/mesh/status');
        const data = await res.json();
        document.getElementById('meshRoot').textContent = data.rootPath || '--';
        document.getElementById('meshType').textContent = (data.workspaceType || 'none').toUpperCase();
        document.getElementById('meshIsMono').textContent = data.isMonorepo ? 'YES (Active)' : 'NO';
        document.getElementById('meshNodeCount').textContent = (data.nodes || []).length;

        const grid = document.getElementById('meshNodesGrid');
        if (grid) {
          grid.innerHTML = '';
          (data.nodes || []).forEach(node => {
            const el = document.createElement('div');
            el.className = 'cluster-card';
            const storeStatus = node.hasStore ? '<span class="drift-badge drift-documented">Store: Active</span>' : '<span class="drift-badge drift-stale">Store: None</span>';
            const currentBadge = node.isCurrent ? ' <span class="priority-badge priority-high">CURRENT</span>' : '';
            el.innerHTML = `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="mono" style="font-weight:800; color:#fff;">${escapeHtml(node.name)}${currentBadge}</span>
                ${storeStatus}
              </div>
              <div style="font-size:11px; color:var(--text-dim); margin-bottom:6px; word-break:break-all;">${escapeHtml(node.path)}</div>
              <div style="font-size:11px; color:var(--text-muted);">Type: <strong>${node.nodeType}</strong></div>
              ${node.dependencies && node.dependencies.length > 0 ? `<div style="font-size:11px; color:var(--text-dim); margin-top:4px;">Deps: ${node.dependencies.slice(0, 3).map(escapeHtml).join(', ')}${node.dependencies.length > 3 ? '...' : ''}</div>` : ''}
            `;
            grid.appendChild(el);
          });
        }
      } catch (err) {
        console.error('Failed to load mesh status:', err);
      }
    }

    async function searchMesh() {
      const q = (document.getElementById('meshQueryInput').value || '').trim();
      try {
        const res = await fetch('/api/mesh/query?q=' + encodeURIComponent(q));
        const list = await res.json();
        const container = document.getElementById('meshQueryResults');
        if (container) {
          container.innerHTML = '';
          if (!list || list.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No memories found across mesh workspace.</div>';
          } else {
            list.forEach(res => {
              const card = document.createElement('div');
              card.className = 'view-card';
              card.style.marginBottom = '0';
              card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div style="font-weight:700; color:#fff;">${escapeHtml(res.memory.title)}</div>
                  <div>
                    <span class="priority-badge priority-medium">[${escapeHtml(res.originProject)}]</span>
                    <span class="adr-badge adr-proposed">${res.memory.type}</span>
                  </div>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">${escapeHtml(res.memory.content)}</div>
                <div style="font-size:11px; color:var(--text-dim);">Source: ${escapeHtml(res.sourceNode.path)} &bull; Score: ${(res.score * 100).toFixed(0)}%</div>
              `;
              container.appendChild(card);
            });
          }
        }
      } catch (err) {
        flash('Mesh search failed', true);
      }
    }

    async function fetchMeshAudit() {
      try {
        const res = await fetch('/api/mesh/audit');
        const data = await res.json();
        const sumEl = document.getElementById('meshAuditSummary');
        if (sumEl) sumEl.textContent = data.summary || '';

        const tbody = document.getElementById('meshAuditTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          (data.items || []).forEach(item => {
            const tr = document.createElement('tr');
            const color = item.status === 'valid' ? 'drift-documented' : item.status === 'drifted' ? 'drift-partial' : 'drift-conflicting';
            tr.innerHTML = `
              <td class="mono"><strong>${escapeHtml(item.sourcePackage)}</strong></td>
              <td class="mono"><strong>${escapeHtml(item.targetPackage)}</strong></td>
              <td class="mono">${escapeHtml(item.symbol)}</td>
              <td><span class="drift-badge ${color}">${item.status}</span></td>
              <td style="font-size:12px;">${escapeHtml(item.detail)}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to run mesh audit:', err);
      }
    }

    // Tabs switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        tab.setAttribute('aria-current', 'page');
        currentTab = tab.dataset.view;
        const panel = document.getElementById('panel-' + currentTab);
        if (panel) panel.classList.add('active');
        if (currentTab === 'graph') wakeGraph();
        if (currentTab === 'health') fetchHealth();
        if (currentTab === 'adrs') { fetchAdrs(); fetchDrift(); }
        if (currentTab === 'cognition') fetchCognition();
        if (currentTab === 'sync') fetchSyncStatus();
        if (currentTab === 'mesh') { fetchMeshStatus(); fetchMeshAudit(); }
        if (currentTab === 'activity') fetchActivity();
        if (currentTab === 'terrain') fetchTerrain();
        if (currentTab === 'agents') { fetchAgents(); fetchAgentManifest(); }
      });
    });

    // Archetype selection
    document.querySelectorAll('.archetype-card').forEach(card => {
      card.addEventListener('click', async () => {
        if (!requireProjectScope()) return;
        const arch = card.dataset.arch;
        if (!arch) return;
        document.querySelectorAll('.archetype-card[data-arch]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        await fetch('/api/user-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archetype: arch })
        });
        fetchUserProfile();
        flash('Switched persona archetype to ' + arch);
      });
    });

    renderQuickStart();
    renderCommandDeck('');
    var commandSearch = document.getElementById('commandDeckSearch');
    if (commandSearch) {
      commandSearch.addEventListener('input', function (event) { renderCommandDeck(event.target.value); });
    }
    setupCanvasInteractions();
    setupTimeline();

    // T-321: project scope control. Seeded from the URL so a scoped link is
    // reloadable; an empty value means the whole store.
    const projectFilterInput = document.getElementById('projectFilter');
    if (projectFilterInput) {
      projectFilterInput.value = projectScope;
      projectFilterInput.addEventListener('change', () => {
        applyProjectScope(projectFilterInput.value);
      });
    }

    document.addEventListener('visibilitychange', function () {
      documentHidden = document.hidden;
      if (documentHidden) {
        graphLoopStarted = false;
      } else {
        wakeGraph();
      }
    });

    document.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setStudioView(btn.dataset.studioView); });
    });

    var listSearch = document.getElementById('studioListSearch');
    if (listSearch) {
      listSearch.addEventListener('input', function (e) {
        var value = e.target.value;
        if (listDebounce) clearTimeout(listDebounce);
        listDebounce = setTimeout(function () { listQuery = value; renderStudioTable(); }, 100);
      });
    }

    document.querySelectorAll('.studio-table th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (listSort.key === key) listSort.dir = listSort.dir === 'asc' ? 'desc' : 'asc';
        else { listSort.key = key; listSort.dir = 'asc'; }
        renderStudioTable();
      });
    });

    let searchDebounceTimer = null;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        renderList();
        wakeGraph();
      }, 30);
    });

    document.querySelectorAll('#filterBar .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filterBar .chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
        currentFilter = chip.dataset.type;
        renderList();
        wakeGraph();
      });
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' || e.key === '/') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.getElementById('searchInput').focus();
        }
      }
      if (e.key === 'Escape') {
        document.getElementById('detailPane').classList.remove('open');
      }
    });

    document.querySelectorAll('.scope-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setScope(btn.dataset.scope); });
    });
    var scopeSwitch = document.getElementById('scopeSwitch');
    if (window.STANDALONE_DATA && scopeSwitch) scopeSwitch.style.display = 'none';
    var initialScope = new URLSearchParams(window.location.search).get('scope');
    setScope(initialScope || 'project', { refetch: false });

    loadData();