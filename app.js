const state = {
  rows: 6,
  cols: 8,
  pads: [],
  selectedKey: null,
  players: new Map(),
  draggingKey: null,
};

const DEFAULT_GRAY = '#6b7280';

const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const filePicker = document.getElementById('filePicker');
const importPicker = document.getElementById('importPicker');
const nameInput = document.getElementById('padName');
const loopInput = document.getElementById('padLoop');
const colorInput = document.getElementById('padColor');

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

const keyOf = (row, col) => `${row}:${col}`;

function randomVibrantColor() {
  const hue = Math.random();
  const sat = 0.8;
  const val = 0.92;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = val * (1 - sat);
  const q = val * (1 - f * sat);
  const t = val * (1 - (1 - f) * sat);

  let r; let g; let b;
  switch (i % 6) {
    case 0: [r, g, b] = [val, t, p]; break;
    case 1: [r, g, b] = [q, val, p]; break;
    case 2: [r, g, b] = [p, val, t]; break;
    case 3: [r, g, b] = [p, q, val]; break;
    case 4: [r, g, b] = [t, p, val]; break;
    default: [r, g, b] = [val, p, q];
  }

  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getPad(row, col) {
  return state.pads.find((p) => p.row === row && p.col === col) ?? null;
}

function setPad(pad) {
  const existingIndex = state.pads.findIndex((p) => p.row === pad.row && p.col === pad.col);
  if (existingIndex >= 0) {
    state.pads[existingIndex] = pad;
  } else {
    state.pads.push(pad);
  }
}

function emptyPad(row, col) {
  state.pads = state.pads.filter((p) => !(p.row === row && p.col === col));
}

async function loadState() {
  const response = await fetch('?api=state');
  const data = await response.json();
  state.rows = data.rows;
  state.cols = data.cols;
  state.pads = data.pads;
  render();
}

function render() {
  grid.style.setProperty('--rows', state.rows);
  grid.style.setProperty('--cols', state.cols);
  grid.innerHTML = '';

  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      const pad = getPad(row, col);
      const button = document.createElement('button');
      button.className = 'pad';
      button.dataset.row = row;
      button.dataset.col = col;
      button.draggable = true;

      const padColor = pad?.color ?? DEFAULT_GRAY;
      button.style.background = `radial-gradient(circle at center, color-mix(in oklab, ${padColor}, white 18%), ${padColor})`;

      if (pad) {
        const time = `<span class="time" id="time-${keyOf(row, col)}">--:--</span>`;
        const meter = `<div class="meter"><div class="meter-bar" id="meter-${keyOf(row, col)}"></div></div>`;
        button.innerHTML = `<strong>${pad.name || 'Pad'}</strong>${time}${meter}`;
      } else {
        button.classList.add('empty');
        button.innerHTML = '<strong>+ Įkelti</strong><span class="time">be MP3/WAV</span>';
      }

      if (state.selectedKey === keyOf(row, col)) {
        button.classList.add('selected');
      }

      button.addEventListener('click', () => onPadClick(row, col));
      button.addEventListener('dragstart', () => {
        state.draggingKey = keyOf(row, col);
      });
      button.addEventListener('dragover', (e) => e.preventDefault());
      button.addEventListener('drop', () => onDrop(row, col));
      grid.appendChild(button);
    }
  }
}

function ensurePad(row, col) {
  const pad = getPad(row, col);
  if (pad) {
    return pad;
  }

  const fresh = {
    row,
    col,
    name: `Pad ${row + 1}-${col + 1}`,
    loop: false,
    file: null,
    color: DEFAULT_GRAY,
  };
  setPad(fresh);
  return fresh;
}

function syncEditor(pad) {
  if (!pad) {
    nameInput.value = '';
    loopInput.checked = false;
    colorInput.value = DEFAULT_GRAY;
    return;
  }

  nameInput.value = pad.name;
  loopInput.checked = !!pad.loop;
  colorInput.value = normalizeToHex(pad.color) || DEFAULT_GRAY;
}

function normalizeToHex(color) {
  if (!color) return null;
  if (color.startsWith('#')) return color;

  const temp = document.createElement('div');
  temp.style.color = color;
  document.body.appendChild(temp);
  const rgb = getComputedStyle(temp).color;
  document.body.removeChild(temp);

  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return null;
  return `#${Number(match[1]).toString(16).padStart(2, '0')}${Number(match[2]).toString(16).padStart(2, '0')}${Number(match[3]).toString(16).padStart(2, '0')}`;
}

async function onPadClick(row, col) {
  const pad = ensurePad(row, col);
  state.selectedKey = keyOf(row, col);
  syncEditor(pad);
  render();

  if (!pad.file) {
    filePicker.dataset.row = `${row}`;
    filePicker.dataset.col = `${col}`;
    filePicker.click();
    return;
  }

  await togglePadPlayback(pad);
}

async function togglePadPlayback(pad) {
  await audioContext.resume();
  const key = keyOf(pad.row, pad.col);
  let player = state.players.get(key);

  if (!player) {
    player = createPlayer(pad, key);
  }

  if (!player.audio.paused) {
    stopPlayer(key, player, true);
    return;
  }

  player.audio.loop = !!pad.loop;
  player.audio.currentTime = 0;
  await player.audio.play();
  animateMeter(key, player);
}

function createPlayer(pad, key) {
  const audio = new Audio(pad.file);
  audio.loop = !!pad.loop;
  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const player = { audio, analyser, raf: null };
  state.players.set(key, player);

  audio.addEventListener('ended', () => {
    stopMeter(key, player);
    setRemainingTime(key, 0);
  });

  return player;
}

function stopPlayer(key, player, resetTime = false) {
  player.audio.pause();
  if (resetTime) {
    player.audio.currentTime = 0;
  }
  stopMeter(key, player);
  setRemainingTime(key, 0);
}

function stopAll() {
  for (const [key, player] of state.players.entries()) {
    stopPlayer(key, player, true);
  }
  status('⏹️ Visi garsai sustabdyti');
}

function animateMeter(key, player) {
  const data = new Uint8Array(player.analyser.frequencyBinCount);

  const draw = () => {
    player.analyser.getByteFrequencyData(data);
    const avg = data.reduce((acc, n) => acc + n, 0) / data.length;
    const level = Math.min(100, Math.round((avg / 255) * 100));
    const meter = document.getElementById(`meter-${key}`);
    if (meter) {
      meter.style.width = `${level}%`;
    }

    const remaining = Math.max(0, (player.audio.duration || 0) - player.audio.currentTime);
    setRemainingTime(key, remaining);

    if (!player.audio.paused) {
      player.raf = requestAnimationFrame(draw);
    }
  };

  stopMeter(key, player);
  draw();
}

function setRemainingTime(key, secs) {
  const timeEl = document.getElementById(`time-${key}`);
  if (!timeEl) return;
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  timeEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function stopMeter(key, player) {
  if (player.raf) {
    cancelAnimationFrame(player.raf);
    player.raf = null;
  }
  const meter = document.getElementById(`meter-${key}`);
  if (meter) {
    meter.style.width = '0%';
  }
}

async function uploadAudio(file, row, col) {
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('row', String(row));
  formData.append('col', String(col));

  const response = await fetch('?api=upload', {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Upload klaida');
  }

  const pad = ensurePad(row, col);
  pad.file = payload.file;
  pad.color = randomVibrantColor();
  if (!pad.name || pad.name.startsWith('Pad ')) {
    pad.name = file.name.replace(/\.[^.]+$/, '');
  }
  setPad(pad);
  status(`✅ Priskirta: ${file.name}`);
  render();
}

function onDrop(targetRow, targetCol) {
  if (!state.draggingKey) return;

  const [fromRow, fromCol] = state.draggingKey.split(':').map(Number);
  if (fromRow === targetRow && fromCol === targetCol) return;

  const fromPad = getPad(fromRow, fromCol);
  const toPad = getPad(targetRow, targetCol);

  if (fromPad) {
    fromPad.row = targetRow;
    fromPad.col = targetCol;
  }

  if (toPad) {
    toPad.row = fromRow;
    toPad.col = fromCol;
  }

  if (!toPad) {
    emptyPad(fromRow, fromCol);
  }

  if (fromPad) setPad(fromPad);
  if (toPad) setPad(toPad);

  state.draggingKey = null;
  render();
}

function status(text) {
  statusEl.textContent = text;
  setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, 2500);
}

async function saveState() {
  const response = await fetch('?api=save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: state.rows, cols: state.cols, pads: state.pads }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Nepavyko išsaugoti');
  }
  status('💾 Išsaugota (globaliai JSON faile)');
}

function exportState() {
  const data = JSON.stringify({ rows: state.rows, cols: state.cols, pads: state.pads }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mixpad_export_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  status('⬇️ JSON eksportas paruoštas');
}

async function importState(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (typeof parsed.rows !== 'number' || typeof parsed.cols !== 'number' || !Array.isArray(parsed.pads)) {
    throw new Error('Netinkamas JSON formatas importui');
  }

  state.rows = parsed.rows;
  state.cols = parsed.cols;
  state.pads = parsed.pads;
  stopAll();
  render();
  await saveState();
  status('⬆️ Importas atliktas ir išsaugotas');
}

filePicker.addEventListener('change', async () => {
  const file = filePicker.files?.[0];
  if (!file) return;

  const row = Number(filePicker.dataset.row);
  const col = Number(filePicker.dataset.col);

  try {
    await uploadAudio(file, row, col);
  } catch (error) {
    status(`❌ ${error.message}`);
  } finally {
    filePicker.value = '';
  }
});

importPicker.addEventListener('change', async () => {
  const file = importPicker.files?.[0];
  if (!file) return;
  try {
    await importState(file);
  } catch (error) {
    status(`❌ ${error.message}`);
  } finally {
    importPicker.value = '';
  }
});

document.getElementById('addRow').addEventListener('click', () => {
  state.rows += 1;
  render();
});

document.getElementById('addCol').addEventListener('click', () => {
  state.cols += 1;
  render();
});

document.getElementById('saveState').addEventListener('click', async () => {
  try {
    await saveState();
  } catch (error) {
    status(`❌ ${error.message}`);
  }
});

document.getElementById('stopAll').addEventListener('click', stopAll);
document.getElementById('exportState').addEventListener('click', exportState);
document.getElementById('importState').addEventListener('click', () => importPicker.click());

nameInput.addEventListener('input', () => {
  if (!state.selectedKey) return;
  const [row, col] = state.selectedKey.split(':').map(Number);
  const pad = ensurePad(row, col);
  pad.name = nameInput.value;
  setPad(pad);
  render();
});

loopInput.addEventListener('change', () => {
  if (!state.selectedKey) return;
  const [row, col] = state.selectedKey.split(':').map(Number);
  const pad = ensurePad(row, col);
  pad.loop = loopInput.checked;
  setPad(pad);
});

colorInput.addEventListener('input', () => {
  if (!state.selectedKey) return;
  const [row, col] = state.selectedKey.split(':').map(Number);
  const pad = ensurePad(row, col);
  pad.color = colorInput.value;
  setPad(pad);
  render();
});

document.getElementById('clearAudio').addEventListener('click', () => {
  if (!state.selectedKey) return;
  const [row, col] = state.selectedKey.split(':').map(Number);
  const pad = ensurePad(row, col);
  pad.file = null;
  pad.color = DEFAULT_GRAY;
  setPad(pad);
  render();
});

loadState().catch((error) => {
  status(`❌ ${error.message}`);
});
