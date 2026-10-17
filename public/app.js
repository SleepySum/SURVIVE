(() => {
  'use strict';

  const canvas = document.getElementById('bunker-canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const bootMessage = document.getElementById('boot-message');
  const wasmState = document.getElementById('wasm-state');
  const drawer = document.getElementById('context-drawer');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerKicker = document.getElementById('drawer-kicker');
  const drawerSummary = document.getElementById('drawer-summary');
  const drawerContent = document.getElementById('drawer-content');
  const drawerFootnote = document.getElementById('drawer-footnote');
  const taskCards = document.getElementById('task-cards');
  const eventLine = document.getElementById('recent-event');
  const hitboxes = [];

  let core = null;
  let activeDrawer = '';
  let lastUiAt = 0;
  let lastDrawerAt = 0;
  let lastEventText = '';
  let drawWidth = 0;
  let drawHeight = 0;
  let pixelRatio = 1;
  let audioEnabled = false;
  let audioContext = null;
  let frameQueued = false;

  function showBoot(message, isError = false) {
    bootMessage.textContent = message;
    bootMessage.dataset.kind = isError ? 'error' : 'info';
    bootMessage.hidden = false;
    wasmState.textContent = isError ? 'BUILD REQUIRED' : 'WAITING FOR WASM';
    const led = document.querySelector('.footer-led');
    if (led) led.dataset.ready = 'false';
  }

  function hideBoot() {
    bootMessage.hidden = true;
    wasmState.textContent = 'C++ / WASM ONLINE';
    const led = document.querySelector('.footer-led');
    if (led) led.dataset.ready = 'true';
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(280, Math.floor(rect.width));
    const height = Math.max(250, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
    }
    drawWidth = width;
    drawHeight = height;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function fmt(value, digits = 0) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
  }

  function setCounterState(element, value, warningAt, lowAt) {
    if (!element) return;
    element.dataset.state = value <= lowAt ? 'low' : value <= warningAt ? 'warning' : 'steady';
  }

  function updateCounters() {
    if (!core) return;
    const food = core.getFood();
    const water = core.getWater();
    const power = core.getPowerPercent();
    const day = core.getDay();
    document.getElementById('food-value').textContent = fmt(food);
    document.getElementById('water-value').textContent = fmt(water);
    document.getElementById('power-value').textContent = fmt(power);
    document.getElementById('day-value').textContent = String(day).padStart(2, '0');
    setCounterState(document.querySelector('[data-resource="food"]'), food, 34, 18);
    setCounterState(document.querySelector('[data-resource="water"]'), water, 34, 18);
    setCounterState(document.querySelector('[data-resource="power"]'), power, 38, 18);

    const cycleProgress = core.getDayProgress();
    document.getElementById('day-progress').style.width = `${Math.round(cycleProgress * 100)}%`;
    document.getElementById('cycle-label').textContent = `${String(day).padStart(2, '0')} / ${Math.floor(cycleProgress * 34)}s`;
    document.getElementById('crew-count').textContent = String(core.getLivingInmates()).padStart(2, '0');

    const message = core.getRecentEvent();
    if (message && message !== lastEventText) {
      lastEventText = message;
      eventLine.textContent = message;
      if (audioEnabled) playCue(message.toLowerCase().includes('breach') || message.toLowerCase().includes('fire') ? 330 : 520);
    }

    const liveStatus = document.querySelector('.live-status');
    const gameOver = core.getGameOver();
    const strained = food < 18 || water < 18 || power < 18;
    const threatened = power < 38 || core.getRoomZombiePressure(5) > 0.52 || core.getRoomZombiePressure(6) > 0.52;
    liveStatus.dataset.state = gameOver ? 'critical' : strained ? 'critical' : threatened ? 'warning' : 'steady';
    document.getElementById('live-label').textContent = gameOver ? 'BUNKER SILENT' : strained ? 'SUPPLY CRITICAL' : threatened ? 'THREAT ELEVATED' : 'SYSTEMS HOLDING';

    const dayButton = document.getElementById('advance-button');
    const scavengeButton = document.getElementById('scavenge-button');
    const pauseButton = document.getElementById('pause-button');
    dayButton.disabled = gameOver;
    scavengeButton.disabled = gameOver;
    pauseButton.disabled = gameOver;
    pauseButton.querySelector('span:last-child').textContent = core.getPaused() ? 'RESUME' : 'PAUSE';
  }

  function makeTaskCard(index) {
    const name = core.getTaskName(index);
    const worker = core.getTaskWorker(index);
    const status = core.getTaskStatus(index);
    const progress = Math.max(0, Math.min(1, core.getTaskProgress(index)));
    const priority = core.getTaskPriority(index);
    const emergency = core.getTaskEmergency(index);
    const card = document.createElement('article');
    card.className = `task-card${emergency ? ' is-emergency' : ''}${status.includes('QUEUED') || status.includes('FIFO') ? ' is-queued' : ''}`;

    const top = document.createElement('div');
    top.className = 'task-card-top';
    const title = document.createElement('div');
    title.className = 'task-card-title';
    title.textContent = name || 'Unassigned work';
    const badge = document.createElement('span');
    badge.className = 'priority-badge';
    badge.textContent = emergency ? `P ${fmt(priority)}` : status === 'FIFO' ? 'FIFO' : `P ${fmt(priority)}`;
    top.append(title, badge);

    const meta = document.createElement('div');
    meta.className = 'task-card-meta';
    const workerName = document.createElement('span');
    workerName.className = 'worker-name';
    workerName.textContent = worker === 'Unassigned' ? 'AWAITING INMATE' : worker.toUpperCase();
    const state = document.createElement('span');
    state.textContent = status;
    meta.append(workerName, state);

    const progressTrack = document.createElement('div');
    progressTrack.className = 'task-progress';
    const progressFill = document.createElement('span');
    progressFill.style.width = `${Math.round(progress * 100)}%`;
    progressTrack.append(progressFill);
    card.append(top, meta, progressTrack);
    return card;
  }

  function updateTaskCards() {
    const count = core.getTaskCount();
    taskCards.replaceChildren();
    const visibleCount = Math.min(3, count);
    if (!visibleCount) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = 'NO DUTIES QUEUED — REST WHILE YOU CAN';
      taskCards.append(empty);
      return;
    }
    for (let index = 0; index < visibleCount; index += 1) taskCards.append(makeTaskCard(index));
  }

  function setDrawer(name) {
    activeDrawer = activeDrawer === name ? '' : name;
    drawer.hidden = !activeDrawer;
    drawer.setAttribute('aria-hidden', String(!activeDrawer));
    document.querySelectorAll('[data-drawer]').forEach((button) => {
      button.setAttribute('aria-expanded', String(button.dataset.drawer === activeDrawer));
    });
    if (activeDrawer) renderDrawer();
  }

  function closeDrawer() {
    activeDrawer = '';
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-drawer]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  function renderSystems() {
    drawerKicker.textContent = 'DEPENDENCY TREE';
    drawerTitle.textContent = 'Power tree';
    drawerSummary.textContent = `${fmt(core.getPowerPercent())}% BUS CHARGE · GENERATOR OUTPUT FEEDS EVERY DOWNSTREAM SYSTEM.`;
    drawerFootnote.textContent = 'DFS PROPAGATION / HEALTH 0 = SUBTREE FAILURE';
    drawerContent.replaceChildren();
    for (let index = 0; index < core.getSystemCount(); index += 1) {
      const row = document.createElement('div');
      const operational = core.getSystemOperational(index);
      row.className = `tree-row${operational ? '' : ' is-offline'}`;
      const name = document.createElement('div');
      name.className = 'tree-name';
      const depth = index === 0 ? 0 : index === 1 ? 1 : 2;
      name.dataset.depth = String(depth > 0 ? 1 : 0);
      const branch = document.createElement('span');
      branch.className = 'tree-branch';
      branch.textContent = depth === 0 ? '●' : depth === 1 ? '├' : '└';
      const label = document.createElement('span');
      label.textContent = core.getSystemName(index);
      name.append(branch, label);
      const healthBox = document.createElement('div');
      healthBox.className = 'tree-health';
      const meter = document.createElement('div');
      meter.className = 'tree-meter';
      const fill = document.createElement('span');
      const max = Math.max(1, core.getSystemMaxHealth(index));
      const percent = Math.max(0, Math.min(100, core.getSystemHealth(index) / max * 100));
      fill.style.width = `${percent}%`;
      meter.append(fill);
      const value = document.createElement('small');
      value.textContent = operational ? `${fmt(percent)}%` : 'OFF';
      healthBox.append(meter, value);
      row.append(name, healthBox);
      drawerContent.append(row);
    }
  }

  function renderQueue() {
    drawerKicker.textContent = 'TASK DISPATCH';
    drawerTitle.textContent = 'Priority queue';
    drawerSummary.textContent = 'FREE INMATES TAKE EMERGENCIES FIRST. ROUTINE DUTIES STAY FIFO.';
    drawerFootnote.textContent = 'PRIORITY = SEVERITY × 10 + PROXIMITY − FATIGUE × 0.5';
    drawerContent.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'queue-summary';
    [[core.getEmergencyQueueSize(), 'EMERGENCY HEAP'], [core.getStandardQueueSize(), 'ROUTINE FIFO']].forEach(([value, label]) => {
      const chip = document.createElement('div');
      chip.className = 'queue-chip';
      const number = document.createElement('strong');
      number.textContent = String(value).padStart(2, '0');
      const caption = document.createElement('span');
      caption.textContent = label;
      chip.append(number, caption);
      summary.append(chip);
    });
    drawerContent.append(summary);

    const count = Math.min(core.getTaskCount(), 24);
    if (!count) {
      const empty = document.createElement('div');
      empty.className = 'drawer-empty';
      empty.textContent = 'Nothing waiting. The crew has a moment to breathe.';
      drawerContent.append(empty);
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const emergency = core.getTaskEmergency(index);
      const item = document.createElement('div');
      item.className = `drawer-task${emergency ? ' is-emergency' : ''}`;
      const rank = document.createElement('div');
      rank.className = 'drawer-task-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const description = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'drawer-task-title';
      title.textContent = core.getTaskName(index);
      const sub = document.createElement('div');
      sub.className = 'drawer-task-sub';
      sub.textContent = `${core.getTaskStatus(index)} · ${core.getTaskWorker(index)}`;
      description.append(title, sub);
      const priority = document.createElement('span');
      priority.className = 'drawer-task-priority';
      priority.textContent = emergency ? `P${fmt(core.getTaskPriority(index))}` : 'FIFO';
      item.append(rank, description, priority);
      drawerContent.append(item);
    }
  }

  function roomData() {
    const rooms = [];
    for (let index = 0; index < core.getRoomCount(); index += 1) {
      rooms.push({
        id: core.getRoomId(index), name: core.getRoomName(index),
        x: core.getRoomX(index), y: core.getRoomY(index),
        hazard: core.getRoomHazard(index), zombies: core.getRoomZombiePressure(index),
        external: core.getRoomExternal(index), selected: core.getRoomSelected(index),
      });
    }
    return rooms;
  }

  function renderRoutes() {
    drawerKicker.textContent = 'A* ROUTING';
    drawerTitle.textContent = 'Graph route';
    drawerFootnote.textContent = 'EDGE COST = DISTANCE + ENVIRONMENTAL HAZARD';
    drawerContent.replaceChildren();
    const byId = new Map(roomData().map((room) => [room.id, room]));
    const routeCount = core.getRouteCount();
    drawerSummary.textContent = routeCount
      ? `CORE TO SELECTED ROOM · ${Math.max(0, routeCount - 1)} HALLWAY SEGMENTS · ROUTE REFRESHES AS CONDITIONS CHANGE.`
      : 'NO VALID ROUTE. A CORRIDOR IS COLLAPSED, FROZEN, OR BREACHED.';
    const caption = document.createElement('p');
    caption.className = 'route-caption';
    caption.textContent = 'TRAVERSED ROOMS';
    drawerContent.append(caption);
    if (!routeCount) {
      const empty = document.createElement('div');
      empty.className = 'drawer-empty';
      empty.textContent = 'Select another room or repair a passage to find a safe path.';
      drawerContent.append(empty);
      return;
    }
    for (let index = 0; index < routeCount; index += 1) {
      const room = byId.get(core.getRouteRoom(index));
      if (!room) continue;
      const row = document.createElement('div');
      row.className = `route-node${room.zombies > 0.48 || room.hazard > 0.56 ? ' is-danger' : ''}`;
      const number = document.createElement('span');
      number.className = 'route-node-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('span');
      label.textContent = room.name;
      row.append(number, label);
      drawerContent.append(row);
    }
  }

  function renderDrawer() {
    if (!core || !activeDrawer) return;
    if (activeDrawer === 'systems') renderSystems();
    else if (activeDrawer === 'tasks') renderQueue();
    else if (activeDrawer === 'routes') renderRoutes();
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawCanvas() {
    if (!core) return;
    resizeCanvas();
    if (!drawWidth || !drawHeight) return;
    const w = drawWidth;
    const h = drawHeight;
    context.clearRect(0, 0, w, h);
    context.fillStyle = '#131b17';
    context.fillRect(0, 0, w, h);

    context.strokeStyle = 'rgba(178,197,173,0.035)';
    context.lineWidth = 1;
    for (let x = 16; x < w; x += 26) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
    }
    for (let y = 10; y < h; y += 26) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
    }

    const rooms = roomData();
    const roomById = new Map();
    const roomWidth = Math.max(82, Math.min(120, w * 0.18));
    const roomHeight = Math.max(47, Math.min(62, h * 0.17));
    const padX = roomWidth / 2 + 17;
    const padY = roomHeight / 2 + 30;
    for (const room of rooms) {
      room.cx = padX + room.x * Math.max(10, w - padX * 2);
      room.cy = padY + room.y * Math.max(10, h - padY * 2);
      room.w = room.external ? roomWidth * 0.83 : roomWidth;
      room.h = room.external ? roomHeight * 0.88 : roomHeight;
      roomById.set(room.id, room);
    }

    const edgeCount = core.getEdgeCount();
    for (let index = 0; index < edgeCount; index += 1) {
      const a = roomById.get(core.getEdgeFrom(index));
      const b = roomById.get(core.getEdgeTo(index));
      if (!a || !b) continue;
      const blocked = core.getEdgeBlocked(index);
      const hazard = core.getEdgeHazard(index);
      context.beginPath();
      context.moveTo(a.cx, a.cy);
      context.lineTo(b.cx, b.cy);
      context.lineWidth = 3;
      context.setLineDash(blocked ? [5, 5] : []);
      context.strokeStyle = blocked ? 'rgba(212,119,97,0.64)' : hazard > 0.38 ? 'rgba(214,166,104,0.48)' : 'rgba(160,187,151,0.31)';
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc((a.cx + b.cx) / 2, (a.cy + b.cy) / 2, 2, 0, Math.PI * 2);
      context.fillStyle = blocked ? '#d47761' : hazard > 0.38 ? '#d6a668' : '#718675';
      context.fill();
    }

    if (activeDrawer === 'routes' && core.getRouteCount() > 1) {
      context.save();
      context.beginPath();
      for (let index = 0; index < core.getRouteCount(); index += 1) {
        const room = roomById.get(core.getRouteRoom(index));
        if (!room) continue;
        if (index === 0) context.moveTo(room.cx, room.cy); else context.lineTo(room.cx, room.cy);
      }
      context.lineWidth = 2;
      context.strokeStyle = 'rgba(185,206,131,0.95)';
      context.setLineDash([3, 5]);
      context.shadowColor = 'rgba(185,206,131,0.4)';
      context.shadowBlur = 7;
      context.stroke();
      context.restore();
    }

    hitboxes.length = 0;
    for (const room of rooms) {
      const pressure = Math.max(room.zombies, room.hazard * 0.30);
      const isCritical = room.zombies > 0.52 || room.hazard > 0.74;
      const border = room.selected ? '#b9ce83' : isCritical ? '#d47761' : room.external ? '#d6a668' : 'rgba(176,196,169,0.44)';
      context.save();
      context.shadowColor = room.selected ? 'rgba(185,206,131,0.22)' : 'transparent';
      context.shadowBlur = room.selected ? 15 : 0;
      roundedRect(room.cx - room.w / 2, room.cy - room.h / 2, room.w, room.h, 4);
      context.fillStyle = room.external ? 'rgba(48,41,31,0.94)' : room.selected ? 'rgba(41,54,38,0.97)' : 'rgba(29,40,33,0.96)';
      context.fill();
      context.lineWidth = room.selected ? 1.6 : 1;
      context.strokeStyle = border;
      context.stroke();
      context.restore();

      context.fillStyle = room.selected ? '#e1e7d5' : '#bdc9b9';
      context.font = '500 9px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(room.name.toUpperCase(), room.cx, room.cy - 6, room.w - 12);
      context.fillStyle = room.external ? '#d6a668' : isCritical ? '#d47761' : '#718074';
      context.font = '7px Consolas, monospace';
      const subline = room.external ? 'EXPOSED / OUTSIDE' : isCritical ? 'THREAT / ACTIVE' : `HAZ ${fmt(pressure * 100)}%`;
      context.fillText(subline, room.cx, room.cy + 10, room.w - 12);

      if (room.zombies > 0.34) {
        context.beginPath();
        context.arc(room.cx + room.w / 2 - 9, room.cy - room.h / 2 + 8, 3.4, 0, Math.PI * 2);
        context.fillStyle = '#d47761';
        context.fill();
      }
      hitboxes.push({ id: room.id, x: room.cx - room.w / 2, y: room.cy - room.h / 2, w: room.w, h: room.h });
    }

    const inmateCount = core.getInmateCount();
    const roomOccupancy = new Map();
    for (let index = 0; index < inmateCount; index += 1) {
      if (core.getInmateStatus(index) === 'LOST') continue;
      const room = roomById.get(core.getInmateRoom(index));
      if (!room) continue;
      const slot = roomOccupancy.get(room.id) || 0;
      roomOccupancy.set(room.id, slot + 1);
      const offset = (slot - 1) * 12;
      const x = room.cx + offset;
      const y = room.cy + room.h / 2 - 6;
      const working = core.getInmateStatus(index) === 'WORKING';
      const panicked = core.getInmateStatus(index) === 'PANICKED';
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fillStyle = panicked ? '#d47761' : working ? '#d6a668' : '#b9ce83';
      context.fill();
      context.fillStyle = '#172019';
      context.font = '700 6px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(core.getInmateName(index).slice(0, 1), x, y + 0.5);
    }

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = 'rgba(133,151,132,0.55)';
    context.font = '7px Consolas, monospace';
    context.fillText('NORTH / SERVICE SHAFT', 18, h - 18);
  }

  function renderFrame() {
    if (!core) return;
    drawCanvas();
    const now = performance.now();
    if (now - lastUiAt > 180) {
      lastUiAt = now;
      updateCounters();
      updateTaskCards();
    }
    if (activeDrawer && now - lastDrawerAt > 620) {
      lastDrawerAt = now;
      renderDrawer();
    }
  }

  function playCue(frequency) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = audioContext || new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, audioContext.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.14);
    } catch (_) {
      // Audio is optional; simulation state and interaction never depend on it.
    }
  }

  function bindControls() {
    document.querySelectorAll('[data-drawer]').forEach((button) => {
      button.addEventListener('click', () => setDrawer(button.dataset.drawer));
    });
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('pause-button').addEventListener('click', () => {
      if (core) core.togglePause();
      updateCounters();
    });
    document.getElementById('advance-button').addEventListener('click', () => {
      if (core) core.advanceDay();
      updateCounters();
      updateTaskCards();
    });
    document.getElementById('scavenge-button').addEventListener('click', () => {
      if (core) core.dispatchScavenge();
      updateCounters();
      updateTaskCards();
    });
    document.getElementById('sound-toggle').addEventListener('click', (event) => {
      audioEnabled = !audioEnabled;
      event.currentTarget.setAttribute('aria-pressed', String(audioEnabled));
      event.currentTarget.setAttribute('aria-label', audioEnabled ? 'Mute sound cues' : 'Enable sound cues');
      if (audioEnabled) playCue(620);
    });
    canvas.addEventListener('click', (event) => {
      if (!core) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const room = hitboxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      if (room) {
        core.selectRoom(room.id);
        updateCounters();
        if (activeDrawer === 'routes') renderDrawer();
      }
    });
    window.addEventListener('resize', () => { resizeCanvas(); if (core) drawCanvas(); });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeDrawer) closeDrawer();
    });
  }

  async function boot() {
    bindControls();
    resizeCanvas();
    if (typeof window.RootDecayModule !== 'function') {
      showBoot('WASM core is not built yet. Run scripts/build-wasm.ps1, then reload this page.', true);
      return;
    }
    try {
      core = await window.RootDecayModule({ printErr: (message) => console.error(message) });
      hideBoot();
      updateCounters();
      updateTaskCards();
      renderFrame();
    } catch (error) {
      console.error('Root & Decay could not start:', error);
      showBoot('The WebAssembly core failed to load. Rebuild the C++ module and reload.', true);
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
