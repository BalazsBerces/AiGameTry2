import type Phaser from 'phaser';
import { complete } from '../../core/console/console';
import type { GameScene } from '../scenes/GameScene';

/**
 * The dev console's overlay (playtesting): the key under Esc, by its position on any layout,
 * opens a text box over the top third of the screen. The game keeps running, but while it is
 * open no key reaches the game. Commands live in core/console; GameScene carries them out.
 */

const HISTORY_KEY = 'devConsole.history';
const HISTORY_MAX = 50;
const LOG_MAX = 50;
/** The key under Esc, whatever the layout types there. */
const TOGGLE_CODE = 'Backquote';

function loadHistory(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // No storage (a private window): history lasts until reload.
  }
}

export function mountDevConsole(game: Phaser.Game) {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: '33vh',
    display: 'none',
    flexDirection: 'column',
    background: 'rgba(8, 6, 10, 0.86)',
    color: '#e8d7b0',
    font: '13px monospace',
    zIndex: '10',
    boxSizing: 'border-box',
    padding: '6px 10px',
    borderBottom: '1px solid #4a3a2a',
  });
  const log = document.createElement('div');
  Object.assign(log.style, { flex: '1', overflowY: 'auto', whiteSpace: 'pre-wrap' });
  const input = document.createElement('input');
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'help';
  Object.assign(input.style, {
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    border: 'none',
    borderTop: '1px solid #4a3a2a',
    outline: 'none',
    padding: '4px 0 0',
  });
  root.append(log, input);
  document.body.append(root);

  const print = (lines: string[], color?: string) => {
    for (const line of lines) {
      const row = document.createElement('div');
      row.textContent = line;
      if (color) row.style.color = color;
      log.append(row);
    }
    while (log.childElementCount > LOG_MAX) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  };

  const history = loadHistory();
  let recalled = history.length;
  let open = false;

  const setOpen = (on: boolean) => {
    open = on;
    root.style.display = on ? 'flex' : 'none';
    // Keys typed here never reach the game; keys held as it opened are let go.
    if (game.input?.keyboard) game.input.keyboard.enabled = !on;
    if (on) for (const scene of game.scene.getScenes(true)) scene.input?.keyboard?.resetKeys();
    if (on) input.focus();
    else input.blur();
  };

  const submit = () => {
    const line = input.value.trim();
    input.value = '';
    if (!line) return;
    if (history[history.length - 1] !== line) history.push(line);
    history.splice(0, Math.max(0, history.length - HISTORY_MAX));
    recalled = history.length;
    saveHistory(history);
    print([`> ${line}`], '#8a8394');
    if (!game.scene.isActive('game')) return print(['no run in progress'], '#ff6b5a');
    try {
      print((game.scene.getScene('game') as GameScene).runConsole(line));
    } catch (e) {
      print([`error: ${e instanceof Error ? e.message : String(e)}`], '#ff6b5a');
    }
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code !== TOGGLE_CODE) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(!open);
    },
    true,
  );

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      recalled = Math.max(0, Math.min(history.length, recalled + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[recalled] ?? '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const done = complete(input.value);
      input.value = done.line;
      if (done.candidates.length) print([done.candidates.join('  ')], '#8a8394');
    }
  });
}
