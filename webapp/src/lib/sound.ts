let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function playTone(audio: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

/**
 * Короткий восходящий «дзынь» без аудио-ассета — два тона на растущей громкости-огибающей,
 * как подтверждение платежа. Вызывать только по прямому действию пользователя (сабмит формы) —
 * иначе браузер заблокирует AudioContext политикой автовоспроизведения.
 */
export function playSuccessChime(): void {
  try {
    const audio = getContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    playTone(audio, 660, now, 0.16);
    playTone(audio, 990, now + 0.1, 0.25);
  } catch {
    // Звук не критичен — молча игнорируем (Safari/автоплей-политика/старые браузеры).
  }
}
