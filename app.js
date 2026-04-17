const state = {
  rows: 8,
  cols: 8,
  pads: [],
  selectedKey: null,
  players: new Map(),
  draggingKey: null,
};

const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const filePicker = document.getElementById('filePicker');
const nameInput = document.getElementById('padName');
const loopInput = document.getElementById('padLoop');
const colorInput = document.getElementById('padColor');

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

const keyOf = (row, col) => `${row}:${col}`;

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
      button.style.setProperty('--pad-color', pad?.color ?? '#6b7280');

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
    color: '#6b7280',
  };
  setPad(fresh);
  return fresh;
}

function syncEditor(pad) {
  if (!pad) {
    nameInput.value = '';
    loopInput.checked = false;
    colorInput.value = '#6b7280';
    return;
  }

  nameInput.value = pad.name;
  loopInput.checked = !!pad.loop;
  colorInput.value = pad.color || '#6b7280';
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

  await playPad(pad);
}

async function playPad(pad) {
  await audioContext.resume();
  const key = keyOf(pad.row, pad.col);
  let player = state.players.get(key);

  if (!player) {
    const audio = new Audio(pad.file);
    audio.loop = !!pad.loop;
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    player = { audio, analyser, raf: null };
    state.players.set(key, player);

    audio.addEventListener('ended', () => {
      stopMeter(key, player);
      setRemainingTime(key, 0);
    });
  }

  player.audio.loop = !!pad.loop;
  player.audio.currentTime = 0;
  await player.audio.play();
  animateMeter(key, player);
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
  status('💾 Išsaugota');
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
  setPad(pad);
  render();
});

loadState().catch((error) => {
  status(`❌ ${error.message}`);
});
