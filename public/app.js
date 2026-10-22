(() => {
  'use strict';

  // DOM Elements
  const canvas = document.getElementById('bunker-canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const bootMessage = document.getElementById('boot-message');
  const wasmState = document.getElementById('wasm-state');
  const footerLed = document.getElementById('footer-led');
  const drawer = document.getElementById('context-drawer');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerKicker = document.getElementById('drawer-kicker');
  const drawerSummary = document.getElementById('drawer-summary');
  const drawerContent = document.getElementById('drawer-content');
  const drawerFootnote = document.getElementById('drawer-footnote');
  const taskCards = document.getElementById('task-cards');
  const eventLine = document.getElementById('recent-event');
  const emergencyBanner = document.getElementById('emergency-banner');

  // Game Over Elements
  const gameoverOverlay = document.getElementById('gameover-overlay');
  const gameoverSub = document.getElementById('gameover-sub');
  const gameoverStats = document.getElementById('gameover-stats');
  const retryButton = document.getElementById('retry-button');
  let gameOverShown = false;

  // Inmate Panel Elements
  const inmatePanel = document.getElementById('inmate-panel');
  const inmatePanelName = document.getElementById('inmate-panel-name');
  const inmatePanelRoom = document.getElementById('inmate-panel-room');
  const inmatePanelAvatar = document.getElementById('inmate-panel-avatar');
  const inmateStatHealth = document.getElementById('inmate-stat-health');
  const inmateStatMorale = document.getElementById('inmate-stat-morale');
  const inmateStatFatigue = document.getElementById('inmate-stat-fatigue');
  const inmateValHealth = document.getElementById('inmate-val-health');
  const inmateValMorale = document.getElementById('inmate-val-morale');
  const inmateValFatigue = document.getElementById('inmate-val-fatigue');
  const inmatePanelTask = document.getElementById('inmate-panel-task');
  const btnInmateHeal = document.getElementById('btn-inmate-heal');
  const btnInmateReassign = document.getElementById('btn-inmate-reassign');
  const inmatePanelClose = document.getElementById('inmate-panel-close');

  // Room Panel Elements
  const roomPanel = document.getElementById('room-panel');
  const roomPanelName = document.getElementById('room-panel-name');
  const roomPanelHazard = document.getElementById('room-panel-hazard');
  const roomPanelZombies = document.getElementById('room-panel-zombies');
  const roomBtnWork = document.getElementById('room-btn-work');
  const roomBtnDefend = document.getElementById('room-btn-defend');
  const roomPanelClose = document.getElementById('room-panel-close');

  // Simulation State & Hitboxes
  let core = null;
  let activeDrawer = '';
  let selectedInmateIndex = -1;
  let selectedRoomId = 1;
  let hoveredInmateIndex = -1;
  let hoveredRoomId = 0;
  let lastUiAt = 0;
  let lastDrawerAt = 0;
  let lastEventText = '';
  let drawWidth = 0;
  let drawHeight = 0;
  let pixelRatio = 1;
  let audioEnabled = false;
  let audioContext = null;
  let humOscillator = null;
  let humGain = null;
  let frameQueued = false;
  let animClock = 0;

  // Particle systems (sparks, smoke puffs, water drips)
  const particles = [];

  // Inmate visual representation definitions
  const INMATE_STYLES = [
    { hairColor: '#e8c872', hairStyle: 'bob', skin: '#f7d3ba', clothes: '#3f564d' },       // Alice (blonde bob)
    { hairColor: '#2b2420', hairStyle: 'short', skin: '#deb887', clothes: '#495d52' },     // Alex (dark short)
    { hairColor: '#5c3826', hairStyle: 'ponytail', skin: '#f5c6a5', clothes: '#3a5046' },  // Maria (ponytail)
    { hairColor: '#8c4b2d', hairStyle: 'wavy', skin: '#fed0bb', clothes: '#41554c' },      // Sarah (auburn wavy)
    { hairColor: '#1a1a1a', hairStyle: 'beanie', skin: '#e2ba96', clothes: '#34473e' },    // Bob (beanie)
    { hairColor: '#1c1b22', hairStyle: 'braid', skin: '#c89d7c', clothes: '#475e53' },     // Elena
    { hairColor: '#3a322d', hairStyle: 'buzz', skin: '#8d5524', clothes: '#3e5248' },      // Marcus
    { hairColor: '#96432b', hairStyle: 'pixie', skin: '#ffd8c0', clothes: '#43584e' }      // Vera
  ];

  // Room Layout Grid for Subterranean Cutaway
  // Room IDs: 1: Bunker Core / Generator, 2: Hydroponics, 3: Water Plant / Mess,
  // 4: Dormitories, 5: Workshop, 6: Surface Gate / Airlock, 7: Outer Yard
  const ROOM_LAYOUT = {
    // Level 1: Surface & Airlock
    6: { level: 1, col: 'center', label: 'SURFACE GATE / AIRLOCK', type: 'gate', floor: 1 },
    7: { level: 1, col: 'right', label: 'OUTER YARD', type: 'yard', floor: 1 },
    // Level 2: Upper Living & Food
    4: { level: 2, col: 'left', label: 'LEVEL 2: DORMITORIES', type: 'dorms', floor: 2 },
    2: { level: 2, col: 'right', label: 'LEVEL 2: HYDROPONICS', type: 'hydro', floor: 2 },
    // Level 3: Facilities & Life Support
    3: { level: 3, col: 'left', label: 'LEVEL 3: KITCHEN & WATER', type: 'kitchen', floor: 3 },
    5: { level: 3, col: 'right', label: 'LEVEL 3: WORKSHOP RELAY', type: 'workshop', floor: 3 },
    // Level 4: Deep Industrial Power
    1: { level: 4, col: 'center', label: 'LEVEL 4: MAIN GENERATOR', type: 'generator', floor: 4 },
  };

  const hitboxes = [];

  function fmt(val, digits = 0) {
    return Number.isFinite(val) ? Number(val).toFixed(digits) : '—';
  }

  // Find a crew member that can be re-tasked (idle or panicked first)
  function findFreeWorkerId() {
    if (!core) return -1;
    for (let i = 0; i < core.getInmateCount(); i++) {
      const st = core.getInmateStatus(i);
      if (st === 'IDLE' || st === 'PANICKED') return core.getInmateId(i);
    }
    return -1;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(340, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
    }
    drawWidth = width;
    drawHeight = height;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  // ============================================================
  // AUDIO SYNTHESIS
  // ============================================================
  function initAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = audioContext || new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume();

      // Ambient low generator hum
      if (!humOscillator) {
        humOscillator = audioContext.createOscillator();
        humGain = audioContext.createGain();
        humOscillator.type = 'sawtooth';
        humOscillator.frequency.value = 55; // 55Hz low hum
        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 160;

        humGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        humOscillator.connect(filter);
        filter.connect(humGain);
        humGain.connect(audioContext.destination);
        humOscillator.start();
      }
      if (humGain) {
        humGain.gain.setTargetAtTime(audioEnabled ? 0.015 : 0.00001, audioContext.currentTime, 0.3);
      }
    } catch (_) {}
  }

  function playCue(type) {
    if (!audioEnabled || !audioContext) return;
    try {
      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);

      if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === 'alarm') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      } else if (type === 'chime') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      }
    } catch (_) {}
  }

  function showGameOver() {
    if (gameOverShown || !core) return;
    gameOverShown = true;
    if (!core.getPaused()) core.togglePause(); // freeze the doomed run so the player can reflect
    const wave = core.getCurrentWave ? core.getCurrentWave() : 1;
    if (gameoverSub) {
      gameoverSub.textContent = `Every survivor lost on day ${core.getDay()}. The bunker has gone silent.`;
    }
    if (gameoverStats) {
      gameoverStats.textContent = `DAYS SURVIVED: ${core.getDay()}  ·  WAVES REACHED: ${wave}  ·  SURVIVORS: ${core.getLivingInmates()}/${core.getTotalInmates()}`;
    }
    if (gameoverOverlay) gameoverOverlay.hidden = false;
    playCue('alarm');
  }

  // ============================================================
  // UI COUNTERS & INMATE HUD
  // ============================================================
  function updateCounters() {
    if (!core) return;
    const food = core.getFood();
    const water = core.getWater();
    const power = core.getPowerPercent();
    const day = core.getDay();
    const living = core.getLivingInmates();
    const total = core.getTotalInmates();

    document.getElementById('food-value').textContent = fmt(food);
    document.getElementById('water-value').textContent = fmt(water);
    document.getElementById('power-value').textContent = `${Math.round(power)}%`;
    document.getElementById('day-value').textContent = String(day).padStart(2, '0');

    // Power pill fill bar & color
    const powerFill = document.getElementById('power-pill-fill');
    powerFill.style.width = `${Math.max(0, Math.min(100, power))}%`;
    powerFill.style.backgroundColor = power < 25 ? '#d47761' : power < 50 ? '#d6a668' : '#4fa769';

    // Inmate crew count — scan every registry index: dead crew keep their slots,
    // so the living are not guaranteed to occupy the first `living` indexes.
    let idleCount = 0;
    for (let i = 0; i < total; i++) {
      if (core.getInmateStatus(i) === 'IDLE') idleCount++;
    }
    document.getElementById('crew-living').textContent = living;
    document.getElementById('crew-total').textContent = total;
    document.getElementById('crew-idle').textContent = idleCount;
    document.getElementById('crew-count').textContent = String(living - idleCount).padStart(2, '0');

    // Day cycle meter
    const progress = core.getDayProgress();
    document.getElementById('day-progress').style.width = `${Math.round(progress * 100)}%`;
    document.getElementById('cycle-label').textContent = `${String(day).padStart(2, '0')} / ${Math.floor(progress * 34)}s`;

    // Wave indicator
    if (core.getCurrentWave) {
      const wave = core.getCurrentWave();
      const waveNum = document.getElementById('wave-number');
      if (waveNum) waveNum.textContent = wave;
      const wavePill = document.getElementById('wave-pill');
      if (wavePill) {
        const timer = core.getWaveTimer ? Math.ceil(core.getWaveTimer()) : 0;
        wavePill.title = `Wave ${wave} active. Next assault in ${timer}s`;
      }
    }

    // Signal/Event Line
    const msg = core.getRecentEvent();
    if (msg && msg !== lastEventText) {
      lastEventText = msg;
      eventLine.textContent = msg;
      if (msg.toLowerCase().includes('breach') || msg.toLowerCase().includes('fire') || msg.toLowerCase().includes('alert')) {
        playCue('alarm');
      }
    }

    // Low power or zombie breach emergency banner
    let hasBreach = false;
    for (let r = 0; r < core.getRoomCount(); r++) {
      if (core.getRoomZombiePressure(r) > 0.25) {
        hasBreach = true;
        break;
      }
    }
    const isLowPower = power < 30 || !core.getSystemOperational(0);
    emergencyBanner.hidden = !(isLowPower || hasBreach);
    if (isLowPower) {
      document.getElementById('emergency-text').textContent = '⚠️ LOW POWER — AUXILIARY PROTOCOL ENGAGED';
    } else if (hasBreach) {
      document.getElementById('emergency-text').textContent = '⚠️ ZOMBIE BREACH IN PROGRESS — CLICK ROOM TO DEFEND';
    }

    // Inmate Panel Live Update
    if (selectedInmateIndex >= 0 && selectedInmateIndex < core.getInmateCount()) {
      updateInmatePanel(selectedInmateIndex);
    }

    // GAME OVER check: engine flag OR every crew member dead (any cause, any time of day)
    if (core.getGameOver() || (core.getTotalInmates() > 0 && core.getLivingInmates() === 0)) {
      showGameOver();
    }
  }

  function updateInmatePanel(index) {
    if (!core || index < 0 || index >= core.getInmateCount()) {
      inmatePanel.hidden = true;
      return;
    }
    const name = core.getInmateName(index);
    const health = core.getInmateHealth(index);
    const morale = core.getInmateMorale(index);
    const fatigue = core.getInmateFatigue(index);
    const status = core.getInmateStatus(index);
    const task = core.getInmateTask(index) || (status === 'IDLE' ? 'Resting in quarters' : status);
    const roomId = core.getInmateRoom(index);
    const roomName = core.getRoomName(roomId - 1) || `Room ${roomId}`;
    const homeRoomId = core.getInmateHomeRoom ? core.getInmateHomeRoom(index) : 4;
    const homeMeta = ROOM_LAYOUT[homeRoomId];
    const homeName = homeMeta ? homeMeta.label : `Room ${homeRoomId}`;

    inmatePanel.hidden = false;
    inmatePanelName.textContent = name.toUpperCase();
    inmatePanelRoom.textContent = `${roomName} (Quarters: ${homeName})`;
    inmateStatHealth.style.width = `${Math.max(0, Math.min(100, health))}%`;
    inmateStatMorale.style.width = `${Math.max(0, Math.min(100, morale))}%`;
    inmateStatFatigue.style.width = `${Math.max(0, Math.min(100, fatigue))}%`;
    inmateValHealth.textContent = `${Math.round(health)}%`;
    inmateValMorale.textContent = `${Math.round(morale)}%`;
    inmateValFatigue.textContent = `${Math.round(fatigue)}%`;
    inmatePanelTask.textContent = task;

    // Avatar styling
    const style = INMATE_STYLES[index % INMATE_STYLES.length];
    inmatePanelAvatar.textContent = status === 'LOST' ? '💀' : status === 'PANICKED' ? '😱' : '👤';
    inmatePanelAvatar.style.borderColor = style.hairColor;
  }

  function updateTaskCards() {
    if (!core) return;
    const count = core.getTaskCount();
    taskCards.replaceChildren();
    const visibleCount = Math.min(4, count);
    if (!visibleCount) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = 'NO ACTIVE DUTIES — CREW RESTING IN SECTOR 04';
      taskCards.append(empty);
      return;
    }

    for (let i = 0; i < visibleCount; i++) {
      const name = core.getTaskName(i) || 'Unassigned Duty';
      const worker = core.getTaskWorker(i);
      const status = core.getTaskStatus(i);
      const progress = Math.max(0, Math.min(1, core.getTaskProgress(i)));
      const priority = core.getTaskPriority(i);
      const emergency = core.getTaskEmergency(i);

      let kind = 'clean';
      let icon = '🧹';
      if (name.toLowerCase().includes('defend') || name.toLowerCase().includes('breach')) {
        kind = 'defend';
        icon = '🛡️';
      } else if (name.toLowerCase().includes('repair') || name.toLowerCase().includes('restore') || name.toLowerCase().includes('generator')) {
        kind = 'repair';
        icon = '🔧';
      } else if (name.toLowerCase().includes('harvest') || name.toLowerCase().includes('crop')) {
        kind = 'harvest';
        icon = '🌾';
      }

      const card = document.createElement('article');
      card.className = `task-card kind-${kind}${emergency ? ' is-emergency' : ''}`;

      card.innerHTML = `
        <div class="task-card-top">
          <span class="task-card-badge">${emergency ? '⚠️ PRIORITY' : status === 'FIFO' ? 'FIFO' : `P ${fmt(priority, 1)}`}</span>
          <span style="font-size: 13px;">${icon}</span>
        </div>
        <div class="task-card-main">
          <div class="task-card-info">
            <div class="task-card-title">${name.toUpperCase()}</div>
            <div class="task-card-worker">${worker === 'Unassigned' ? 'Awaiting inmate' : worker}</div>
          </div>
          <div class="task-card-avatar">${worker === 'Unassigned' ? '⏳' : '👤'}</div>
        </div>
        <div class="task-card-progress"><span style="width: ${Math.round(progress * 100)}%;"></span></div>
      `;
      taskCards.append(card);
    }
  }

  // ============================================================
  // CONTEXTUAL INSPECTION DRAWERS
  // ============================================================
  function setDrawer(name) {
    activeDrawer = activeDrawer === name ? '' : name;
    drawer.hidden = !activeDrawer;
    drawer.setAttribute('aria-hidden', String(!activeDrawer));
    document.querySelectorAll('[data-drawer]').forEach((b) => {
      b.setAttribute('aria-expanded', String(b.dataset.drawer === activeDrawer));
    });
    if (activeDrawer) renderDrawer();
  }

  function closeDrawer() {
    activeDrawer = '';
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-drawer]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  function renderSystems() {
    drawerKicker.textContent = 'N-ARY DEPENDENCY TREE (C++)';
    drawerTitle.textContent = 'Power grid status';
    drawerSummary.textContent = `${fmt(core.getPowerPercent())}% BUS CHARGE · Generator feeds downstream systems via recursive DFS. If parent fails, all children become disabled.`;
    drawerFootnote.textContent = 'DFS TIME: O(N) | SPACE: O(H) | INTEGRITY <= 0 TRIGGERS SUBTREE SHUTDOWN';
    drawerContent.replaceChildren();

    // Flowchart diagram matching screenshot
    const container = document.createElement('div');
    container.className = 'flowchart-container';

    const rootCard = document.createElement('div');
    rootCard.className = 'flowchart-root';
    const genOnline = core.getSystemOperational(1);
    rootCard.innerHTML = `
      <div class="flowchart-card ${genOnline ? 'is-online' : 'is-offline'}">
        <div class="flowchart-title"><span>⚡</span> MAIN GENERATOR</div>
        <div class="flowchart-status">${genOnline ? 'ONLINE (18.5 kW)' : 'OFFLINE (FAILED)'}</div>
        <div class="tree-meter"><span style="width: ${Math.round(core.getSystemHealth(1))}%"></span></div>
      </div>
    `;
    container.append(rootCard);

    const connectors = document.createElement('div');
    connectors.className = 'flowchart-connectors';
    connectors.textContent = '│  ▼  (DFS CASCADE)';
    container.append(connectors);

    const childrenGrid = document.createElement('div');
    childrenGrid.className = 'flowchart-children';

    for (let i = 2; i < core.getSystemCount(); i++) {
      const op = core.getSystemOperational(i);
      const name = core.getSystemName(i);
      const health = Math.round(core.getSystemHealth(i));
      const icon = name.includes('Hydro') ? '🌾' : name.includes('Water') ? '💧' : name.includes('Air') ? '🍃' : '⚙️';

      const child = document.createElement('div');
      child.className = `flowchart-card ${op ? 'is-online' : 'is-offline'}`;
      child.innerHTML = `
        <div class="flowchart-title"><span>${icon}</span> ${name.toUpperCase()}</div>
        <div class="flowchart-status">${op ? 'OPERATIONAL' : 'DISABLED (NO POWER)'}</div>
        <div class="tree-meter"><span style="width: ${health}%"></span></div>
      `;
      childrenGrid.append(child);
    }
    container.append(childrenGrid);

    // Interactive DFS Testing Buttons
    const actions = document.createElement('div');
    actions.className = 'drawer-actions';
    actions.innerHTML = `
      <button class="drawer-btn btn-danger" id="btn-test-damage" type="button">BREAK GENERATOR (DFS)</button>
      <button class="drawer-btn" id="btn-test-repair" type="button">REPAIR GENERATOR</button>
    `;
    container.append(actions);

    drawerContent.append(container);

    document.getElementById('btn-test-damage').addEventListener('click', () => {
      core.damageSystem(1, 100.0);
      updateCounters();
      renderSystems();
      playCue('alarm');
    });
    document.getElementById('btn-test-repair').addEventListener('click', () => {
      core.repairSystem(1, 100.0);
      updateCounters();
      renderSystems();
      playCue('chime');
    });
  }

  function renderQueue() {
    drawerKicker.textContent = 'TASK & EMERGENCY QUEUES';
    drawerTitle.textContent = 'Priority dispatch';
    drawerSummary.textContent = 'Free inmates pop from Emergency Max-Heap first. If empty, routine tasks pop from standard FIFO queue.';
    drawerFootnote.textContent = 'HEAP INSERT/POP: O(log N) | FIFO ENQUEUE/DEQUEUE: O(1)';
    drawerContent.replaceChildren();

    const summary = document.createElement('div');
    summary.className = 'queue-summary';
    summary.innerHTML = `
      <div class="queue-chip">
        <strong>${String(core.getEmergencyQueueSize()).padStart(2, '0')}</strong>
        <span>EMERGENCY MAX-HEAP</span>
      </div>
      <div class="queue-chip">
        <strong>${String(core.getStandardQueueSize()).padStart(2, '0')}</strong>
        <span>ROUTINE FIFO QUEUE</span>
      </div>
    `;
    drawerContent.append(summary);

    const count = Math.min(core.getTaskCount(), 20);
    for (let i = 0; i < count; i++) {
      const emergency = core.getTaskEmergency(i);
      const name = core.getTaskName(i);
      const worker = core.getTaskWorker(i);
      const status = core.getTaskStatus(i);
      const priority = core.getTaskPriority(i);

      const item = document.createElement('div');
      item.className = `drawer-task${emergency ? ' is-emergency' : ''}`;
      item.innerHTML = `
        <div class="drawer-task-rank">${String(i + 1).padStart(2, '0')}</div>
        <div>
          <div class="drawer-task-title">${name}</div>
          <div class="drawer-task-sub">${status} · ${worker}</div>
        </div>
        <div class="drawer-task-priority">${emergency ? `P ${fmt(priority, 1)}` : 'FIFO'}</div>
      `;
      drawerContent.append(item);
    }
  }

  function renderRoutes() {
    drawerKicker.textContent = 'ADJACENCY GRAPH & A* PATHFINDING';
    drawerTitle.textContent = 'Spatial navigation';
    drawerFootnote.textContent = 'A* COMPLEXITY: O((V+E) log V) | BLOCKED EDGES = ∞ WEIGHT';
    drawerContent.replaceChildren();

    const routeCount = core.getRouteCount();
    drawerSummary.textContent = routeCount
      ? `A* computed shortest path from Core (1) to Target (${selectedRoomId}): ${routeCount - 1} hallway transitions.`
      : 'NO SAFE ROUTE FOUND! Corridors are collapsed, frozen, or zombie-breached.';

    const list = document.createElement('div');
    for (let i = 0; i < routeCount; i++) {
      const rId = core.getRouteRoom(i);
      const rName = core.getRoomName(rId - 1) || `Room ${rId}`;
      const hazard = core.getRoomHazard(rId - 1);
      const zombies = core.getRoomZombiePressure(rId - 1);

      const node = document.createElement('div');
      node.className = `route-node${hazard > 0.4 || zombies > 0.4 ? ' is-danger' : ''}`;
      node.innerHTML = `
        <span class="route-node-index">${i + 1}</span>
        <span>${rName} (Haz: ${Math.round(hazard * 100)}% | Zomb: ${Math.round(zombies * 100)}%)</span>
      `;
      list.append(node);
    }
    drawerContent.append(list);

    const testBreachBtn = document.createElement('button');
    testBreachBtn.className = 'drawer-btn btn-danger';
    testBreachBtn.style.marginTop = '14px';
    testBreachBtn.textContent = 'TRIGGER CORRIDOR BREACH';
    testBreachBtn.addEventListener('click', () => {
      core.triggerBreach(6);
      updateCounters();
      renderRoutes();
      playCue('alarm');
    });
    drawerContent.append(testBreachBtn);
  }

  function renderCrew() {
    drawerKicker.textContent = 'INDIVIDUAL CREW CONTROL';
    drawerTitle.textContent = 'Inmate roster';
    drawerSummary.textContent = 'Click a crew member to open their control panel: heal them, or send them to the selected room to work or defend that room.';
    drawerFootnote.textContent = 'CLICK INMATE HERE OR ON MAP → PANEL → ASSIGN HERE / MED RATIONS';
    drawerContent.replaceChildren();

    for (let i = 0; i < core.getInmateCount(); i++) {
      const name = core.getInmateName(i);
      const status = core.getInmateStatus(i);
      const health = Math.round(core.getInmateHealth(i));
      const morale = Math.round(core.getInmateMorale(i));
      const rId = core.getInmateRoom(i);
      const roomName = core.getRoomName(rId - 1) || `Room ${rId}`;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `crew-row crew-${status.toLowerCase()}${i === selectedInmateIndex ? ' is-selected' : ''}`;
      row.innerHTML = `
        <span class="crew-row-name">${name}</span>
        <span class="crew-row-status">${status}</span>
        <span>${health}% ❤</span>
        <span class="crew-row-room">${roomName}</span>
        <span class="crew-row-health"><span style="width:${Math.max(0, health)}%"></span></span>
        <span class="crew-row-morale"><span style="width:${Math.max(0, morale)}%"></span></span>
      `;
      row.addEventListener('click', () => {
        selectedInmateIndex = i;
        updateInmatePanel(i);
        renderCrew();
        playCue('click');
      });
      drawerContent.append(row);
    }
    drawerContent.__rdCrewRendered = true;
  }

  function renderDrawer() {
    if (!core || !activeDrawer) return;
    if (activeDrawer === 'systems') renderSystems();
    else if (activeDrawer === 'tasks') renderQueue();
    else if (activeDrawer === 'routes') renderRoutes();
    else if (activeDrawer === 'crew') renderCrew();
  }

  // ============================================================
  // CUTAWAY BUNKER CANVAS RENDERING (2D Playable Graphics Style)
  // ============================================================
  function drawBunkerCrossSection() {
    if (!core) return;
    resizeCanvas();
    if (!drawWidth || !drawHeight) return;

    const w = drawWidth;
    const h = drawHeight;
    animClock += 0.03;

    // Clear frame
    context.clearRect(0, 0, w, h);

    // 1. Surface Sky & Wasteland Horizon (Top ~15% of canvas)
    const skyHeight = Math.min(65, h * 0.14);
    const skyGrad = context.createLinearGradient(0, 0, 0, skyHeight);
    skyGrad.addColorStop(0, '#5a6660');
    skyGrad.addColorStop(1, '#7a867e');
    context.fillStyle = skyGrad;
    context.fillRect(0, 0, w, skyHeight);

    // Distant mountain & ruined tower silhouettes
    context.fillStyle = '#48524d';
    context.beginPath();
    context.moveTo(0, skyHeight);
    context.lineTo(w * 0.15, skyHeight - 16);
    context.lineTo(w * 0.35, skyHeight - 8);
    context.lineTo(w * 0.6, skyHeight - 24);
    context.lineTo(w * 0.8, skyHeight - 12);
    context.lineTo(w, skyHeight - 18);
    context.lineTo(w, skyHeight);
    context.closePath();
    context.fill();

    // 2. Earth Strata (Subterranean Cross-Section)
    const earthGrad = context.createLinearGradient(0, skyHeight, 0, h);
    earthGrad.addColorStop(0, '#3a3328');   // Topsoil layer
    earthGrad.addColorStop(0.3, '#2c2720'); // Dense sediment
    earthGrad.addColorStop(0.8, '#1d1b17'); // Deep bedrock
    context.fillStyle = earthGrad;
    context.fillRect(0, skyHeight, w, h - skyHeight);

    // Earth strata lines & roots hanging from the surface
    context.strokeStyle = 'rgba(70, 60, 48, 0.4)';
    context.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const yLine = skyHeight + 35 + i * 55;
      context.beginPath();
      context.moveTo(0, yLine);
      context.bezierCurveTo(w * 0.3, yLine - 8, w * 0.7, yLine + 8, w, yLine - 4);
      context.stroke();
    }

    // Roots ("Root & Decay")
    context.strokeStyle = 'rgba(100, 85, 65, 0.45)';
    context.lineWidth = 1.2;
    for (let r = 20; r < w; r += 45) {
      context.beginPath();
      context.moveTo(r, skyHeight);
      context.quadraticCurveTo(r + Math.sin(r) * 10, skyHeight + 20, r + Math.cos(r) * 14, skyHeight + 40);
      context.stroke();
    }

    // 3. Central Bunker Architecture
    // Define bunker dimensions: centered horizontally
    const bunkerW = Math.min(w * 0.88, 760);
    const bunkerX = (w - bunkerW) / 2;
    const bunkerY = skyHeight + 10;
    const bunkerH = h - bunkerY - 14;

    // Concrete outer wall / containment hull
    context.fillStyle = '#1e2824';
    context.strokeStyle = '#34453e';
    context.lineWidth = 3;
    context.fillRect(bunkerX, bunkerY, bunkerW, bunkerH);
    context.strokeRect(bunkerX, bunkerY, bunkerW, bunkerH);

    // Surface Entry Trapdoor / Bunker Hatch tower
    const towerW = 68;
    const towerH = 24;
    const towerX = bunkerX + bunkerW * 0.5 - towerW / 2;
    context.fillStyle = '#2d3b34';
    context.fillRect(towerX, bunkerY - towerH, towerW, towerH);
    context.strokeStyle = '#43584e';
    context.lineWidth = 2;
    context.strokeRect(towerX, bunkerY - towerH, towerW, towerH);

    // Antenna on surface tower with blinking red beacon
    context.strokeStyle = '#5a7065';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(towerX + towerW / 2, bunkerY - towerH);
    context.lineTo(towerX + towerW / 2, bunkerY - towerH - 18);
    context.stroke();

    context.fillStyle = Math.sin(animClock * 4) > 0 ? '#ff4a3d' : '#4a201c';
    context.beginPath();
    context.arc(towerX + towerW / 2, bunkerY - towerH - 19, 3, 0, Math.PI * 2);
    context.fill();

    // 4. Sub-level Floors Layout
    // 4 levels: Level 1 (Surface Gate), Level 2 (Dorms & Hydro), Level 3 (Kitchen & Workshop), Level 4 (Generator)
    const levelH = bunkerH / 4;
    const shaftW = 56;
    const shaftX = bunkerX + bunkerW * 0.5 - shaftW / 2;

    // Vertical Elevator / Ladder Shaft running through center
    context.fillStyle = '#17201b';
    context.fillRect(shaftX, bunkerY, shaftW, bunkerH);
    context.strokeStyle = '#2d3d34';
    context.lineWidth = 1.5;
    context.strokeRect(shaftX, bunkerY, shaftW, bunkerH);

    // Steel Ladder rungs inside shaft
    context.strokeStyle = '#cda25e';
    context.lineWidth = 1.8;
    for (let ly = bunkerY + 8; ly < bunkerY + bunkerH - 8; ly += 12) {
      context.beginPath();
      context.moveTo(shaftX + 16, ly);
      context.lineTo(shaftX + shaftW - 16, ly);
      context.stroke();
    }

    // Room bounding boxes computation
    const roomBoxes = {};
    const roomMargin = 5;

    // Room 6: Surface Gate / Airlock (Level 1, left of shaft)
    roomBoxes[6] = {
      x: bunkerX + roomMargin,
      y: bunkerY + roomMargin,
      w: (shaftX - bunkerX) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 6
    };
    // Room 7: Outer Yard (Level 1, right of shaft)
    roomBoxes[7] = {
      x: shaftX + shaftW + roomMargin,
      y: bunkerY + roomMargin,
      w: (bunkerX + bunkerW - (shaftX + shaftW)) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 7
    };
    // Room 4: Dormitories (Level 2, left)
    roomBoxes[4] = {
      x: bunkerX + roomMargin,
      y: bunkerY + levelH + roomMargin,
      w: (shaftX - bunkerX) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 4
    };
    // Room 2: Hydroponics (Level 2, right)
    roomBoxes[2] = {
      x: shaftX + shaftW + roomMargin,
      y: bunkerY + levelH + roomMargin,
      w: (bunkerX + bunkerW - (shaftX + shaftW)) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 2
    };
    // Room 3: Kitchen & Water (Level 3, left)
    roomBoxes[3] = {
      x: bunkerX + roomMargin,
      y: bunkerY + levelH * 2 + roomMargin,
      w: (shaftX - bunkerX) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 3
    };
    // Room 5: Workshop Relay (Level 3, right)
    roomBoxes[5] = {
      x: shaftX + shaftW + roomMargin,
      y: bunkerY + levelH * 2 + roomMargin,
      w: (bunkerX + bunkerW - (shaftX + shaftW)) - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 5
    };
    // Room 1: Main Generator (Level 4, full width under shaft)
    roomBoxes[1] = {
      x: bunkerX + roomMargin,
      y: bunkerY + levelH * 3 + roomMargin,
      w: bunkerW - roomMargin * 2,
      h: levelH - roomMargin * 2,
      id: 1
    };

    hitboxes.length = 0;

    // Draw each room's concrete shell & furnishings
    for (const [idStr, box] of Object.entries(roomBoxes)) {
      const id = parseInt(idStr, 10);
      const isSelected = selectedRoomId === id;
      const isHovered = hoveredRoomId === id;
      const hazard = core.getRoomHazard(id - 1);
      const zombies = core.getRoomZombiePressure(id - 1);
      const meta = ROOM_LAYOUT[id];

      // Room background
      context.save();
      context.fillStyle = id === 7 ? '#1a221d' : isSelected ? '#1b2a22' : '#15201b';
      context.fillRect(box.x, box.y, box.w, box.h);

      // Room border
      context.strokeStyle = isSelected
        ? '#b9ce83'
        : zombies > 0.4
          ? '#d47761'
          : isHovered
            ? '#81b6af'
            : '#2c3c33';
      context.lineWidth = isSelected ? 2 : 1;
      context.strokeRect(box.x, box.y, box.w, box.h);

      // Floor line & ceiling pipes
      context.fillStyle = '#223027';
      context.fillRect(box.x, box.y + box.h - 4, box.w, 4);

      // Ceiling Industrial Pipe
      context.strokeStyle = '#4a5b51';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(box.x, box.y + 6);
      context.lineTo(box.x + box.w, box.y + 6);
      context.stroke();

      // Room Furnishings Details (matching screenshot graphics!)
      if (id === 4) {
        // Dormitories: Double Bunk Beds
        drawBunkBed(box.x + 18, box.y + box.h - 5);
        drawBunkBed(box.x + 68, box.y + box.h - 5);
        // Hanging warm lamp
        drawPendantLamp(box.x + box.w / 2, box.y + 6, '#f7db99');
      } else if (id === 2) {
        // Hydroponics: Plant grow trays & purple UV light
        drawHydroponicsTray(box.x + 14, box.y + box.h - 5, box.w - 28);
        drawUVLamp(box.x + box.w / 2, box.y + 6);
      } else if (id === 3) {
        // Kitchen / Water: Refrigerator & Stove
        drawRefrigerator(box.x + 16, box.y + box.h - 5);
        drawStove(box.x + 48, box.y + box.h - 5);
        drawWaterTank(box.x + box.w - 42, box.y + box.h - 5);
      } else if (id === 5) {
        // Workshop: Tool bench & CRT Monitor
        drawWorkbench(box.x + 16, box.y + box.h - 5);
        drawServerRack(box.x + box.w - 46, box.y + box.h - 5);
      } else if (id === 1) {
        // Main Generator: Heavy turbine with hazard stripes & spinning blades
        drawGeneratorTurbine(box.x + box.w / 2, box.y + box.h - 5, core.getSystemOperational(1));
      } else if (id === 6) {
        // Surface Gate: Blast door with diagonal hazard tape
        drawBlastDoor(box.x + box.w - 22, box.y + 6, 18, box.h - 10);
      } else if (id === 7) {
        // Outer Yard: Barbed wire & rubble
        drawBarbedWire(box.x + 8, box.y + box.h - 6, box.w - 16);
      }

      // Room Title Label (e.g. "LEVEL 2: DORMITORIES")
      context.fillStyle = isSelected ? '#e2e8dc' : '#88988a';
      context.font = '600 8px Consolas, monospace';
      context.textAlign = 'left';
      context.fillText(meta ? meta.label : `ROOM ${id}`, box.x + 8, box.y + 18);

      // Zombie Breach Warning & Click-to-Defend badge on room if breached
      if (zombies > 0.2) {
        const pulse = (Math.sin(animClock * 6) + 1) * 0.5;
        // Red alert translucent tint
        context.fillStyle = `rgba(212, 119, 97, ${0.12 + pulse * 0.14})`;
        context.fillRect(box.x, box.y, box.w, box.h);

        // Click to defend badge
        const badgeW = Math.min(136, box.w - 16);
        const badgeH = 18;
        const badgeX = box.x + (box.w - badgeW) / 2;
        const badgeY = box.y + box.h * 0.42;

        context.fillStyle = 'rgba(28, 12, 10, 0.92)';
        context.fillRect(badgeX, badgeY, badgeW, badgeH);
        context.strokeStyle = pulse > 0.5 ? '#ff5a4a' : '#d47761';
        context.lineWidth = 1.5;
        context.strokeRect(badgeX, badgeY, badgeW, badgeH);

        context.fillStyle = '#ffffff';
        context.font = '700 8.5px Consolas, monospace';
        context.textAlign = 'center';
        context.fillText('🛡️ CLICK TO DEFEND', badgeX + badgeW / 2, badgeY + 12);
        context.textAlign = 'left';

        // Warning banner
        context.fillStyle = '#ff7b6b';
        context.font = '700 8px Consolas, monospace';
        context.fillText('⚠️ ZOMBIE BREACH', box.x + 8, box.y + 30);
      }

      hitboxes.push({ id, label: meta ? meta.label : `ROOM ${id}`, ...box });
      context.restore();
    }

    // 5. Route Line Overlay (Pathfinding Graph visualization)
    const routeCount = core.getRouteCount();
    if (routeCount > 1) {
      context.save();
      context.strokeStyle = '#b9ce83';
      context.lineWidth = 2.5;
      context.setLineDash([4, 4]);
      context.lineDashOffset = -animClock * 15;
      context.beginPath();

      for (let r = 0; r < routeCount; r++) {
        const rId = core.getRouteRoom(r);
        const b = roomBoxes[rId];
        if (b) {
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          if (r === 0) context.moveTo(cx, cy);
          else context.lineTo(cx, cy);
        }
      }
      context.stroke();
      context.restore();
    }

    // 6. Draw Inmate Characters
    const inmateCount = core.getInmateCount();
    const roomInmateSlots = {};

    for (let i = 0; i < inmateCount; i++) {
      const status = core.getInmateStatus(i);
      if (status === 'LOST') continue;

      const rId = core.getInmateRoom(i);
      const b = roomBoxes[rId] || roomBoxes[1];
      const slot = roomInmateSlots[rId] || 0;
      roomInmateSlots[rId] = slot + 1;

      // Character position inside room
      const spacing = 28;
      const charX = b.x + 32 + (slot * spacing) % Math.max(30, b.w - 60);
      const charY = b.y + b.h - 6;

      drawInmateSprite(charX, charY, i, status === 'WORKING', status === 'PANICKED');

      // Floating Name/Health Tag if selected or hovered
      if (i === selectedInmateIndex || i === hoveredInmateIndex) {
        drawInmateOverheadTag(charX, charY - 34, i);
      }
    }

    // 7. Draw Zombies if room has pressure (e.g., Gate 6 or Yard 7)
    for (const [idStr, b] of Object.entries(roomBoxes)) {
      const id = parseInt(idStr, 10);
      const zPressure = core.getRoomZombiePressure(id - 1);
      if (zPressure > 0.25) {
        const count = Math.min(4, Math.ceil(zPressure * 4));
        for (let z = 0; z < count; z++) {
          const zx = b.x + b.w - 18 - z * 16 + Math.sin(animClock * 2 + z) * 3;
          const zy = b.y + b.h - 6;
          drawZombieSprite(zx, zy, z);
        }
      }
    }

    // 8. Particle updates (sparks, smoke, steam)
    updateAndDrawParticles();
  }

  // ============================================================
  // FURNITURE & SPRITE DRAWING HELPERS
  // ============================================================
  function drawBunkBed(x, y) {
    context.strokeStyle = '#5a6660';
    context.lineWidth = 1.5;
    // Bed posts
    context.beginPath();
    context.moveTo(x, y); context.lineTo(x, y - 28);
    context.moveTo(x + 28, y); context.lineTo(x + 28, y - 28);
    // Lower & Upper Mattress
    context.moveTo(x, y - 8); context.lineTo(x + 28, y - 8);
    context.moveTo(x, y - 22); context.lineTo(x + 28, y - 22);
    context.stroke();

    // Mattresses & Pillows
    context.fillStyle = '#658579';
    context.fillRect(x + 2, y - 10, 24, 4);
    context.fillRect(x + 2, y - 24, 24, 4);
    context.fillStyle = '#e5ede8';
    context.fillRect(x + 3, y - 12, 6, 3);
    context.fillRect(x + 3, y - 26, 6, 3);
  }

  function drawPendantLamp(x, y, color) {
    context.strokeStyle = '#333';
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + 10); context.stroke();
    context.fillStyle = color;
    context.beginPath(); context.arc(x, y + 12, 3, 0, Math.PI * 2); context.fill();

    // Warm radial light cone
    const grad = context.createRadialGradient(x, y + 12, 2, x, y + 12, 35);
    grad.addColorStop(0, 'rgba(247, 219, 153, 0.18)');
    grad.addColorStop(1, 'transparent');
    context.fillStyle = grad;
    context.beginPath(); context.arc(x, y + 12, 35, 0, Math.PI * 2); context.fill();
  }

  function drawHydroponicsTray(x, y, width) {
    // Metal tray base
    context.fillStyle = '#263b31';
    context.fillRect(x, y - 12, width, 12);
    context.strokeStyle = '#385848';
    context.strokeRect(x, y - 12, width, 12);

    // Green leafy seedling plants
    context.fillStyle = '#5ad47a';
    for (let px = x + 8; px < x + width - 6; px += 10) {
      context.beginPath();
      context.arc(px, y - 14, 4, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(px + 3, y - 16, 3, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawUVLamp(x, y) {
    context.fillStyle = '#b55ceb';
    context.fillRect(x - 22, y, 44, 4);
    // Purple UV glow
    const grad = context.createRadialGradient(x, y + 4, 4, x, y + 15, 45);
    grad.addColorStop(0, 'rgba(181, 92, 235, 0.25)');
    grad.addColorStop(1, 'transparent');
    context.fillStyle = grad;
    context.beginPath(); context.arc(x, y + 15, 45, 0, Math.PI * 2); context.fill();
  }

  function drawRefrigerator(x, y) {
    context.fillStyle = '#7a8c84';
    context.fillRect(x, y - 32, 18, 32);
    context.strokeStyle = '#3e4a44';
    context.strokeRect(x, y - 32, 18, 32);
    // Door split line & handles
    context.beginPath();
    context.moveTo(x, y - 18); context.lineTo(x + 18, y - 18);
    context.moveTo(x + 15, y - 26); context.lineTo(x + 15, y - 22);
    context.moveTo(x + 15, y - 14); context.lineTo(x + 15, y - 10);
    context.stroke();
  }

  function drawStove(x, y) {
    context.fillStyle = '#3a4440';
    context.fillRect(x, y - 20, 22, 20);
    // Burner glow
    context.fillStyle = '#ff6b3d';
    context.fillRect(x + 4, y - 21, 6, 2);
    context.fillRect(x + 12, y - 21, 6, 2);
  }

  function drawWaterTank(x, y) {
    context.fillStyle = '#2d4540';
    context.fillRect(x, y - 32, 22, 32);
    context.strokeStyle = '#41665e';
    context.strokeRect(x, y - 32, 22, 32);
    // Glass water level tube showing clear blue water
    context.fillStyle = '#81b6af';
    context.fillRect(x + 15, y - 26, 4, 22);
  }

  function drawWorkbench(x, y) {
    context.fillStyle = '#524336';
    context.fillRect(x, y - 14, 28, 14);
    context.strokeStyle = '#312820';
    context.strokeRect(x, y - 14, 28, 14);
    // Vice tool on bench
    context.fillStyle = '#73807a';
    context.fillRect(x + 2, y - 19, 5, 5);
  }

  function drawServerRack(x, y) {
    context.fillStyle = '#1a221e';
    context.fillRect(x, y - 32, 24, 32);
    context.strokeStyle = '#34453e';
    context.strokeRect(x, y - 32, 24, 32);
    // Glowing telemetry blinkers
    context.fillStyle = Math.sin(animClock * 5) > 0 ? '#b9ce83' : '#34453e';
    context.fillRect(x + 4, y - 26, 4, 3);
    context.fillStyle = Math.cos(animClock * 4) > 0 ? '#81b6af' : '#34453e';
    context.fillRect(x + 12, y - 26, 4, 3);
  }

  function drawGeneratorTurbine(x, y, isOnline) {
    // Massive turbine housing
    context.fillStyle = '#2e3833';
    context.fillRect(x - 36, y - 36, 72, 36);
    context.strokeStyle = isOnline ? '#b9ce83' : '#d47761';
    context.lineWidth = 1.5;
    context.strokeRect(x - 36, y - 36, 72, 36);

    // Hazard stripes on bottom
    for (let s = x - 34; s < x + 34; s += 8) {
      context.fillStyle = (Math.floor(s / 8) % 2 === 0) ? '#d6a668' : '#1e2420';
      context.fillRect(s, y - 8, 8, 7);
    }

    // Spinning circular turbine fan
    context.save();
    context.translate(x - 12, y - 22);
    if (isOnline) context.rotate(animClock * 12);
    context.fillStyle = '#4c5c54';
    context.beginPath(); context.arc(0, 0, 9, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#b9ce83';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-8, 0); context.lineTo(8, 0);
    context.moveTo(0, -8); context.lineTo(0, 8);
    context.stroke();
    context.restore();

    // Spawning spark particles if damaged
    if (!isOnline && Math.random() < 0.3) {
      particles.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y - 25,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 3,
        life: 1.0,
        color: '#ffaa33'
      });
    }
  }

  function drawBlastDoor(x, y, w, h) {
    context.fillStyle = '#3a443e';
    context.fillRect(x, y, w, h);
    // Hazard diagonal stripes
    context.fillStyle = '#d6a668';
    context.fillRect(x + 2, y + 4, w - 4, 4);
    context.fillRect(x + 2, y + h - 8, w - 4, 4);
  }

  function drawBarbedWire(x, y, width) {
    context.strokeStyle = '#5a615d';
    context.lineWidth = 1.5;
    context.beginPath();
    for (let bx = x; bx < x + width; bx += 8) {
      context.lineTo(bx, y - (Math.floor(bx / 8) % 2 === 0 ? 8 : 2));
    }
    context.stroke();
  }

  // ============================================================
  // CHARACTER SPRITE DRAWING (Inmates & Zombies)
  // ============================================================
  function drawInmateSprite(x, y, index, isWorking, isPanicked) {
    const style = INMATE_STYLES[index % INMATE_STYLES.length];
    const walkBob = isWorking ? Math.sin(animClock * 6) * 1.5 : Math.sin(animClock * 2) * 0.8;

    context.save();
    context.translate(x, y + walkBob);

    // Legs
    context.strokeStyle = '#222f29';
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(-3, -10); context.lineTo(-3, 0);
    context.moveTo(3, -10); context.lineTo(3, 0);
    context.stroke();

    // Body (Jumpsuit)
    context.fillStyle = style.clothes;
    context.fillRect(-5, -20, 10, 11);

    // Belt
    context.fillStyle = '#bfa56a';
    context.fillRect(-5, -11, 10, 2);

    // Arms
    context.strokeStyle = style.clothes;
    context.lineWidth = 2;
    context.beginPath();
    if (isWorking) {
      // Work pose (arms reaching forward)
      context.moveTo(-5, -18); context.lineTo(-8, -13);
      context.moveTo(5, -18); context.lineTo(8, -13);
    } else {
      context.moveTo(-5, -18); context.lineTo(-6, -10);
      context.moveTo(5, -18); context.lineTo(6, -10);
    }
    context.stroke();

    // Head
    context.fillStyle = style.skin;
    context.beginPath();
    context.arc(0, -25, 4.5, 0, Math.PI * 2);
    context.fill();

    // Hair
    context.fillStyle = style.hairColor;
    if (style.hairStyle === 'bob') {
      context.beginPath();
      context.arc(0, -27, 5, Math.PI, 0);
      context.lineTo(5, -24);
      context.lineTo(-5, -24);
      context.fill();
    } else if (style.hairStyle === 'ponytail') {
      context.beginPath();
      context.arc(0, -27, 5, Math.PI, 0);
      context.fill();
      context.fillRect(-7, -26, 4, 7); // ponytail tail
    } else if (style.hairStyle === 'beanie') {
      context.fillStyle = '#2b3831';
      context.fillRect(-5, -30, 10, 5);
    } else {
      context.beginPath();
      context.arc(0, -27, 5, Math.PI, 0);
      context.fill();
    }

    // Panic exclamation or sweat droplet
    if (isPanicked) {
      context.fillStyle = '#ff4a3d';
      context.font = '700 9px Consolas, monospace';
      context.fillText('!', 4, -30);
    }

    context.restore();
  }

  function drawZombieSprite(x, y, seed) {
    const shuffle = Math.sin(animClock * 3 + seed) * 1.5;
    context.save();
    context.translate(x, y + shuffle);

    // Decayed skin & torn rag clothes
    context.strokeStyle = '#43544a';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-3, -10); context.lineTo(-4, 0);
    context.moveTo(3, -10); context.lineTo(2, 0);
    context.stroke();

    context.fillStyle = '#3c4033'; // ragged clothes
    context.fillRect(-5, -19, 10, 10);

    // Outstretched claws
    context.strokeStyle = '#718c7c';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-5, -16); context.lineTo(-10, -14);
    context.moveTo(5, -16); context.lineTo(-9, -12);
    context.stroke();

    // Head (Decayed green/grey)
    context.fillStyle = '#718c7c';
    context.beginPath();
    context.arc(0, -24, 4.5, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }

  function drawInmateOverheadTag(x, y, index) {
    const name = core.getInmateName(index);
    const health = Math.round(core.getInmateHealth(index));
    const morale = Math.round(core.getInmateMorale(index));
    const task = core.getInmateTask(index) || 'Resting';

    const boxW = 100;
    const boxH = 34;
    const bx = Math.max(10, Math.min(drawWidth - boxW - 10, x - boxW / 2));
    const by = Math.max(10, y - boxH);

    context.save();
    context.fillStyle = 'rgba(20, 28, 23, 0.95)';
    context.strokeStyle = '#b9ce83';
    context.lineWidth = 1;
    context.fillRect(bx, by, boxW, boxH);
    context.strokeRect(bx, by, boxW, boxH);

    context.fillStyle = '#fff';
    context.font = '700 8px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText(name.toUpperCase(), bx + 6, by + 10);

    // Mini bars
    context.fillStyle = '#50b376';
    context.fillRect(bx + 6, by + 13, (boxW - 12) * (health / 100), 3);
    context.fillStyle = '#d6a668';
    context.fillRect(bx + 6, by + 18, (boxW - 12) * (morale / 100), 3);

    context.fillStyle = '#81b6af';
    context.font = '7px Consolas, monospace';
    context.fillText(task.length > 14 ? task.slice(0, 13) + '…' : task, bx + 6, by + 28);

    context.restore();
  }

  function updateAndDrawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      context.fillStyle = p.color;
      context.globalAlpha = p.life;
      context.fillRect(p.x, p.y, 2, 2);
      context.globalAlpha = 1.0;
    }
  }

  // ============================================================
  // FRAME TICK & CONTROLS BINDING
  // ============================================================
  function renderFrame() {
    if (!core) return;
    drawBunkerCrossSection();

    const now = performance.now();
    if (now - lastUiAt > 150) {
      lastUiAt = now;
      updateCounters();
      updateTaskCards();
    }
    if (activeDrawer && now - lastDrawerAt > 500) {
      lastDrawerAt = now;
      renderDrawer();
    }
  }

  function bindControls() {
    // Drawer buttons
    document.querySelectorAll('[data-drawer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        playCue('click');
        setDrawer(btn.dataset.drawer);
      });
    });
    document.getElementById('drawer-close').addEventListener('click', () => {
      playCue('click');
      closeDrawer();
    });

    // Pause & Advance Day
    const pauseBtn = document.getElementById('pause-button');
    pauseBtn.addEventListener('click', () => {
      playCue('click');
      if (core) {
        core.togglePause();
        const isPaused = core.getPaused();
        pauseBtn.querySelector('span:last-child').textContent = isPaused ? 'RESUME' : 'PAUSE';
      }
      updateCounters();
    });

    document.getElementById('advance-button').addEventListener('click', () => {
      playCue('chime');
      if (core) core.advanceDay();
      updateCounters();
      updateTaskCards();
    });

    // Scavenge & Breach Buttons
    const dispatchScavenge = () => {
      playCue('click');
      if (core) core.dispatchScavenge();
      updateCounters();
      updateTaskCards();
    };
    document.getElementById('scavenge-button').addEventListener('click', dispatchScavenge);
    document.getElementById('rail-scavenge-btn').addEventListener('click', dispatchScavenge);

    document.getElementById('rail-breach-test-btn').addEventListener('click', () => {
      playCue('alarm');
      if (core) core.triggerBreach(6);
      updateCounters();
      updateTaskCards();
    });

    // Allocate Rations buttons (Top bar and Rail)
    const handleAllocateRations = () => {
      if (!core) return;
      if (core.allocateRations()) {
        playCue('chime');
        eventLine.textContent = '🍖 RATIONS ALLOCATED: Crew fed & hydrated. Health restored, fatigue reduced by 35%!';
        updateCounters();
        updateTaskCards();
        if (selectedInmateIndex >= 0) updateInmatePanel(selectedInmateIndex);
      } else {
        playCue('alarm');
      }
    };
    // Allocate Rations buttons (Top bar and Rail)
    const handleAllocateRationsSecondary = () => {
      if (!core) return;
      if (core.allocateRations()) {
        playCue('chime');
        eventLine.textContent = '🍖 RATIONS ALLOCATED: Crew fed & hydrated. Health restored, fatigue reduced by 35%!';
        updateCounters();
        updateTaskCards();
        if (selectedInmateIndex >= 0) updateInmatePanel(selectedInmateIndex);
      } else {
        playCue('alarm');
        eventLine.textContent = '⚠️ INSUFFICIENT RATIONS: Need at least 8 Food and 8 Water to allocate rations!';
      }
    };
    const btnAlloc = document.getElementById('allocate-rations-btn');
    if (btnAlloc) btnAlloc.addEventListener('click', handleAllocateRations);
    const railRationsBtn = document.getElementById('rail-rations-btn');
    if (railRationsBtn) railRationsBtn.addEventListener('click', handleAllocateRations);

    // Next Wave buttons (Operations bar and Rail)
    const handleNextWave = () => {
      if (!core) return;
      playCue('alarm');
      core.startWave();
      const wave = core.getCurrentWave ? core.getCurrentWave() : 1;
      eventLine.textContent = `🧟 ZOMBIE WAVE ${wave} INCOMING! Rooms breached according to wave tier. Click breached rooms to defend!`;
      updateCounters();
      updateTaskCards();
    };
    const btnNextWave = document.getElementById('next-wave-btn');
    if (btnNextWave) btnNextWave.addEventListener('click', handleNextWave);
    const railWaveBtn = document.getElementById('rail-wave-btn');
    if (railWaveBtn) railWaveBtn.addEventListener('click', handleNextWave);

    // Sound toggle
    document.getElementById('sound-toggle').addEventListener('click', () => {
      audioEnabled = !audioEnabled;
      initAudio();
      document.getElementById('sound-glyph').textContent = audioEnabled ? '🔊' : '🔇';
      if (audioEnabled) playCue('chime');
    });

    // Game Over: retry restarts the bunker from Day 1
    if (retryButton) {
      retryButton.addEventListener('click', () => {
        playCue('click');
        if (core && core.restartGame) {
          core.restartGame();
          gameOverShown = false;
          selectedInmateIndex = -1;
          selectedRoomId = 1;
          roomPanel.hidden = true;
          inmatePanel.hidden = true;
          gameoverOverlay.hidden = true;
          closeDrawer();
          const pBtn = document.getElementById('pause-button');
          if (pBtn) pBtn.querySelector('span:last-child').textContent = 'PAUSE';
          eventLine.textContent = 'BUNKER RESTARTED — Day 01. Assign everyone wisely this time.';
          updateCounters();
          updateTaskCards();
        } else {
          window.location.reload();
        }
      });
    }

    // Inmate Panel Close
    inmatePanelClose.addEventListener('click', () => {
      selectedInmateIndex = -1;
      inmatePanel.hidden = true;
    });

    // Inmate Medical Rations
    btnInmateHeal.addEventListener('click', () => {
      if (core && selectedInmateIndex >= 0) {
        playCue('click');
        const spent = core.treatInmate(core.getInmateId(selectedInmateIndex));
        if (spent) {
          playCue('chime');
          eventLine.textContent = `💊 MED RATIONS USED on ${core.getInmateName(selectedInmateIndex)} — health & morale restored.`;
          updateCounters();
          updateInmatePanel(selectedInmateIndex);
          updateTaskCards();
        } else {
          playCue('alarm');
          eventLine.textContent = '⚠️ Not enough food & water to medic this inmate.';
        }
      }
    });

    // Inmate ASSIGN HERE: send selected inmate to the selected room
    btnInmateReassign.addEventListener('click', () => {
      if (!core || selectedInmateIndex < 0) return;
      playCue('click');
      const roomId = selectedRoomId || 1;
      if (core.assignInmate(core.getInmateId(selectedInmateIndex), roomId, 1)) {
        const name = core.getInmateName(selectedInmateIndex);
        const roomName = core.getRoomName(roomId - 1) || `Room ${roomId}`;
        eventLine.textContent = `✉️ ${name} reassigned to ${roomName}.`;
        updateInmatePanel(selectedInmateIndex);
        updateCounters();
        updateTaskCards();
      } else {
        playCue('alarm');
        eventLine.textContent = '⚠️ Cannot reassign: inmate is lost, already defending a breach, or room unreachable.';
      }
    });

    // Room Panel Buttons
    roomPanelClose.addEventListener('click', () => {
      roomPanel.hidden = true;
      selectedRoomId = 1;
    });
    roomBtnWork.addEventListener('click', () => {
      if (!core) return;
      playCue('click');
      const roomId = selectedRoomId || 1;
      const workerId = findFreeWorkerId();
      if (workerId >= 0 && core.assignInmate(workerId, roomId, 1)) {
        eventLine.textContent = `🔧 Work crew dispatched to ${core.getRoomName(roomId - 1) || 'room ' + roomId}.`;
        updateCounters();
        updateTaskCards();
      } else {
        playCue('alarm');
        eventLine.textContent = '⚠️ No idle inmate available to work in that room.';
      }
    });
    roomBtnDefend.addEventListener('click', () => {
      if (!core) return;
      playCue('alarm');
      const roomId = selectedRoomId || 1;
      if (core.defendRoom(roomId, 0)) {
        eventLine.textContent = `🛡️ DEFENDER DISPATCHED TO ROOM ${roomId}! Inmate will auto-return to quarters when secured.`;
        updateCounters();
        updateTaskCards();
      } else {
        playCue('alarm');
        eventLine.textContent = '⚠️ Cannot assign defend duty: no idle crew or room unreachable.';
      }
      roomPanel.hidden = true;
    });

    // Canvas Clicks & Hovers
    canvas.addEventListener('click', (e) => {
      if (!core) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check click on inmate
      let clickedInmate = false;
      const inmateCount = core.getInmateCount();
      for (let i = 0; i < inmateCount; i++) {
        const rId = core.getInmateRoom(i);
        const b = hitboxes.find((h) => h.id === rId);
        if (b) {
          const cx = b.x + 32 + ((i * 28) % (b.w - 60));
          const cy = b.y + b.h - 10;
          if (Math.hypot(x - cx, y - cy) < 18) {
            selectedInmateIndex = i;
            updateInmatePanel(i);
            playCue('click');
            clickedInmate = true;
            break;
          }
        }
      }

      if (!clickedInmate) {
        // Check click on room
        const room = hitboxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
        if (room) {
          selectedRoomId = room.id;
          core.selectRoom(room.id);
          const zPressure = core.getRoomZombiePressure(room.id - 1);

          // If room is under zombie attack / breach: clicking assigns defender immediately!
          if (zPressure > 0.15) {
            playCue('alarm');
            const dispatched = core.defendRoom(room.id, 0);
            if (dispatched) {
              const meta = ROOM_LAYOUT[room.id];
              const rName = meta ? meta.label : `ROOM ${room.id}`;
              eventLine.textContent = `🛡️ DEFENSE DISPATCHED TO ${rName}! Inmate will defend and return to their quarters once secured.`;
              updateCounters();
              updateTaskCards();
              if (selectedInmateIndex >= 0) updateInmatePanel(selectedInmateIndex);
              return;
            }
          }

          playCue('click');
          updateCounters();

          // Show room actions
          roomPanel.hidden = false;
          const meta = ROOM_LAYOUT[room.id];
          roomPanelName.textContent = meta ? meta.label : `ROOM ${room.id}`;
          roomPanelHazard.textContent = `${Math.round(core.getRoomHazard(room.id - 1) * 100)}%`;
          roomPanelZombies.textContent = `${Math.round(core.getRoomZombiePressure(room.id - 1) * 100)}%`;

          if (activeDrawer === 'routes') renderDrawer();
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!core) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check hover on inmate
      hoveredInmateIndex = -1;
      const inmateCount = core.getInmateCount();
      for (let i = 0; i < inmateCount; i++) {
        const rId = core.getInmateRoom(i);
        const b = hitboxes.find((h) => h.id === rId);
        if (b) {
          const cx = b.x + 32 + ((i * 28) % (b.w - 60));
          const cy = b.y + b.h - 10;
          if (Math.hypot(x - cx, y - cy) < 16) {
            hoveredInmateIndex = i;
            canvas.style.cursor = 'pointer';
            return;
          }
        }
      }

      const room = hitboxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      hoveredRoomId = room ? room.id : 0;
      canvas.style.cursor = room ? 'pointer' : 'default';
    });

    window.addEventListener('resize', () => { resizeCanvas(); if (core) drawBunkerCrossSection(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (activeDrawer) closeDrawer();
        inmatePanel.hidden = true;
        roomPanel.hidden = true;
      } else if (e.key === ' ') {
        if (core) {
          core.togglePause();
          const isPaused = core.getPaused();
          const pBtn = document.getElementById('pause-button');
          if (pBtn) pBtn.querySelector('span:last-child').textContent = isPaused ? 'RESUME' : 'PAUSE';
        }
        updateCounters();
      }
    });
  }

  // ============================================================
  // BOOT & LIFECYCLE (Robust Asynchronous Polling)
  // ============================================================
  async function boot() {
    bindControls();
    resizeCanvas();

    bootMessage.textContent = 'Loading C++ WebAssembly Core…';

    let attempts = 0;
    while (typeof window.RootDecayModule !== 'function') {
      attempts++;
      if (attempts > 160) { // 8 seconds timeout
        bootMessage.textContent = 'Failed to load WebAssembly module. Please refresh the page.';
        bootMessage.dataset.kind = 'error';
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    try {
      core = await window.RootDecayModule({ printErr: (msg) => console.error(msg) });
      bootMessage.hidden = true;
      wasmState.textContent = 'C++ / WASM 60FPS ONLINE';
      footerLed.dataset.ready = 'true';

      updateCounters();
      updateTaskCards();
      renderFrame();

      // Default select first inmate for inspection
      if (core.getInmateCount() > 0) {
        selectedInmateIndex = 0;
        updateInmatePanel(0);
      }
    } catch (err) {
      console.error('WASM Engine load error:', err);
      bootMessage.textContent = 'Failed to initialize WebAssembly core: ' + (err.message || err);
      bootMessage.dataset.kind = 'error';
    }
  }

  window.rootDecayOnFrame = () => {
    if (!core || frameQueued) return;
    frameQueued = true;
    window.requestAnimationFrame(() => {
      frameQueued = false;
      renderFrame();
    });
  };

  boot();
})();







