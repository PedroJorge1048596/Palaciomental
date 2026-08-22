// Sons curtos e simples, gerados na hora com Web Audio API (sem precisar de arquivos de áudio).
// Usados para: entrar na call, sair da call, e iniciar uma transmissão de tela.

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  // Navegadores suspendem o contexto até haver interação do usuário; como esses sons
  // sempre tocam a partir de um clique (entrar/sair/compartilhar), isso já resolve.
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, duration, { type = "sine", delay = 0, gain = 0.15 } = {}) {
  try {
    const audioCtx = getCtx();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const startTime = audioCtx.currentTime + delay;
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  } catch {
    // Se o navegador bloquear áudio por algum motivo, apenas ignora — não é crítico.
  }
}

// Duas notas subindo — "entrou na call"
export function playJoinSound() {
  tone(520, 0.11, { delay: 0 });
  tone(780, 0.14, { delay: 0.08 });
}

// Duas notas descendo — "saiu da call"
export function playLeaveSound() {
  tone(600, 0.11, { delay: 0 });
  tone(360, 0.16, { delay: 0.07 });
}

// Três notas curtas tipo "chime" — "começou a transmitir a tela"
export function playStreamSound() {
  tone(440, 0.08, { delay: 0, gain: 0.13 });
  tone(660, 0.08, { delay: 0.07, gain: 0.13 });
  tone(920, 0.15, { delay: 0.14, gain: 0.15 });
}
