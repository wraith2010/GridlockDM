// js/views/character-import.js — Add character

import { characters }             from '../api.js';
import { toast, setLoading, esc } from '../ui.js';
import { navigate }               from '../router.js';
import { showTopbar }             from './dashboard.js';

export function renderCharacterImport() {
  const app = document.getElementById('app');
  showTopbar('characters');

  app.innerHTML = `
    <div class="page" style="max-width:480px">
      <div class="page-header">
        <a href="#/dashboard" class="btn btn-ghost"
           style="margin-bottom:var(--sp-4);display:inline-flex">← Back</a>
        <div class="page-title">Add Character</div>
      </div>

      <div class="card">
        <form id="add-char-form" class="form">

          <div class="field">
            <label for="m-name">Character Name *</label>
            <input id="m-name" type="text" placeholder="Halwan Tencloak" required autofocus>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="m-class">Class &amp; Level</label>
              <input id="m-class" type="text" placeholder="Wizard 5">
            </div>
            <div class="field" style="max-width:100px">
              <label for="m-speed">Speed (ft)</label>
              <input id="m-speed" type="number" placeholder="30" min="0" value="30">
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="m-hp">Max HP</label>
              <input id="m-hp" type="number" placeholder="37" min="1">
            </div>
            <div class="field">
              <label for="m-ac">Armor Class</label>
              <input id="m-ac" type="number" placeholder="13" min="1">
            </div>
          </div>

          <div id="add-char-error" class="field-error" hidden></div>

          <button type="submit" class="btn btn-primary btn-lg btn-full" id="btn-add-char">
            Add Character
          </button>
        </form>
      </div>
    </div>`;

  wireForm();
}

function wireForm() {
  const form  = document.getElementById('add-char-form');
  const errEl = document.getElementById('add-char-error');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-add-char');
    errEl.hidden = true;

    const rawClass = document.getElementById('m-class').value.trim();
    const dto = {
      name:      document.getElementById('m-name').value.trim(),
      className: rawClass || null,
      level:     parseClassLevel(rawClass),
      speed:     intVal('m-speed', 30),
      maxHp:     intVal('m-hp'),
      armorClass: intVal('m-ac'),
    };

    setLoading(btn, true, 'Saving…');
    try {
      const char = await characters.createManual(dto);
      toast(`${char.name} added!`, 'success');
      navigate('/dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}

/** Extract trailing number from "Wizard 5" or "Fighter 3 / Rogue 2" → total level */
function parseClassLevel(raw) {
  if (!raw) return null;
  const nums = [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function intVal(id, fallback = null) {
  const raw = document.getElementById(id)?.value.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}
