// js/views/character-import.js — Character import wizard

import { characters }         from '../api.js';
import { toast, setLoading, esc } from '../ui.js';
import { navigate }           from '../router.js';
import { showTopbar }         from './dashboard.js';

export function renderCharacterImport() {
  const app = document.getElementById('app');
  showTopbar('characters');

  app.innerHTML = `
    <div class="page" style="max-width:720px">
      <div class="page-header">
        <a href="#/dashboard" class="btn btn-ghost" style="margin-bottom:var(--sp-4);display:inline-flex">← Back</a>
        <div class="page-title">Add Character</div>
        <div class="page-subtitle">Import from D&amp;D Beyond, upload a PDF, or fill in manually</div>
      </div>

      <div class="tabs" style="margin-bottom:var(--sp-6)">
        <button class="tab active" data-tab="ddb">D&amp;D Beyond</button>
        <button class="tab"        data-tab="pdf">PDF Upload</button>
        <button class="tab"        data-tab="manual">Manual Entry</button>
      </div>

      <!-- DDB Import -->
      <div id="tab-ddb" class="tab-panel">
        <div class="card">
          <div class="card-title">Import from D&amp;D Beyond</div>
          <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:var(--sp-6)">
            Enter your character ID from the D&amp;D Beyond URL.
            Your character must be set to <strong>public visibility</strong> on D&amp;D Beyond.
          </p>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:var(--sp-5);
                    background:var(--bg-raised);border:1px solid var(--border);
                    border-radius:var(--radius);padding:var(--sp-3) var(--sp-4)">
            📌 URL format: <code style="color:var(--gold)">dndbeyond.com/characters/<strong>12345678</strong></code>
          </p>

          <div class="field">
            <label for="ddb-id">Character ID</label>
            <input id="ddb-id" type="text" placeholder="e.g. 87654321" inputmode="numeric"
              style="font-family:var(--font-mono);font-size:1.1rem;letter-spacing:0.05em">
            <span class="field-hint">Found in the URL on your D&amp;D Beyond character page</span>
          </div>

          <div id="ddb-error" class="field-error mt-4" hidden></div>

          <div style="margin-top:var(--sp-6)">
            <button class="btn btn-primary btn-lg" id="btn-import-ddb">Import Character</button>
          </div>
        </div>
      </div>

      <!-- PDF Import -->
      <div id="tab-pdf" class="tab-panel" hidden>
        <div class="card">
          <div class="card-title">Upload Character Sheet PDF</div>
          <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:var(--sp-6)">
            Export your character sheet from D&amp;D Beyond as a PDF and upload it here.
            We'll automatically extract your stats from the form fields.
          </p>

          <div class="upload-zone" id="pdf-drop-zone">
            <div class="upload-zone-icon">📄</div>
            <div class="upload-zone-text">Drop your PDF here or click to browse</div>
            <div class="upload-zone-hint">D&amp;D Beyond PDF export only · Max 20MB</div>
            <input type="file" id="pdf-file-input" accept=".pdf,application/pdf"
              style="display:none">
          </div>

          <div id="pdf-selected" hidden style="margin-top:var(--sp-4);display:flex;align-items:center;
               gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);background:var(--bg-raised);
               border:1px solid var(--border);border-radius:var(--radius)">
            <span style="font-size:1.2rem">📎</span>
            <div style="flex:1">
              <div id="pdf-filename" style="font-size:0.9rem;color:var(--text-primary)"></div>
              <div id="pdf-filesize" style="font-size:0.8rem;color:var(--text-muted)"></div>
            </div>
            <button class="btn btn-ghost btn-icon" id="pdf-remove" title="Remove">✕</button>
          </div>

          <div id="pdf-error" class="field-error mt-4" hidden></div>

          <div style="margin-top:var(--sp-6)">
            <button class="btn btn-primary btn-lg" id="btn-import-pdf" disabled>Upload & Import</button>
          </div>
        </div>
      </div>

      <!-- Manual Entry -->
      <div id="tab-manual" class="tab-panel" hidden>
        <div class="card">
          <div class="card-title">Manual Character Entry</div>
          <form id="manual-form" class="form" style="margin-top:var(--sp-2)">

            <div class="field-row">
              <div class="field">
                <label for="m-name">Character Name *</label>
                <input id="m-name" type="text" placeholder="Aric Stonehaven" required>
              </div>
              <div class="field">
                <label for="m-race">Race</label>
                <input id="m-race" type="text" placeholder="Half-Elf">
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="m-class">Class</label>
                <input id="m-class" type="text" placeholder="Fighter / Rogue">
              </div>
              <div class="field">
                <label for="m-level">Level</label>
                <input id="m-level" type="number" placeholder="1" min="1" max="20" value="1">
              </div>
            </div>

            <div class="field">
              <label for="m-background">Background</label>
              <input id="m-background" type="text" placeholder="Soldier">
            </div>

            <hr style="border:none;border-top:1px solid var(--border)">
            <div style="font-family:var(--font-display);font-size:0.7rem;letter-spacing:0.1em;
                        text-transform:uppercase;color:var(--text-muted)">Combat Stats</div>

            <div class="field-row">
              <div class="field">
                <label for="m-hp">Max HP</label>
                <input id="m-hp" type="number" placeholder="44" min="1">
              </div>
              <div class="field">
                <label for="m-ac">Armor Class</label>
                <input id="m-ac" type="number" placeholder="16" min="1">
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="m-speed">Speed (ft)</label>
                <input id="m-speed" type="number" placeholder="30" min="0" value="30">
              </div>
              <div class="field">
                <label for="m-init">Initiative Bonus</label>
                <input id="m-init" type="number" placeholder="+3">
              </div>
            </div>

            <hr style="border:none;border-top:1px solid var(--border)">
            <div style="font-family:var(--font-display);font-size:0.7rem;letter-spacing:0.1em;
                        text-transform:uppercase;color:var(--text-muted)">Ability Scores</div>

            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:var(--sp-3)">
              ${['STR','DEX','CON','INT','WIS','CHA'].map(a => `
                <div class="field" style="text-align:center">
                  <label for="m-${a.toLowerCase()}">${a}</label>
                  <input id="m-${a.toLowerCase()}" type="number" placeholder="10" min="1" max="30"
                    style="text-align:center;padding:var(--sp-3) var(--sp-2)">
                </div>`).join('')}
            </div>

            <div class="field">
              <label for="m-avatar">Avatar URL (optional)</label>
              <input id="m-avatar" type="url" placeholder="https://…/portrait.png">
            </div>

            <div id="manual-error" class="field-error" hidden></div>

            <button type="submit" class="btn btn-primary btn-lg" id="btn-import-manual">
              Save Character
            </button>
          </form>
        </div>
      </div>
    </div>`;

  wireTabSwitcher();
  wireDdbImport();
  wirePdfImport();
  wireManualForm();
}

// ── Tabs ──────────────────────────────────────────────────────────

function wireTabSwitcher() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.hidden = true);
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).hidden = false;
    });
  });
}

// ── DDB import ────────────────────────────────────────────────────

function wireDdbImport() {
  const btn   = document.getElementById('btn-import-ddb');
  const errEl = document.getElementById('ddb-error');

  btn.addEventListener('click', async () => {
    const id = document.getElementById('ddb-id').value.trim();
    if (!id) {
      document.getElementById('ddb-id').focus();
      return;
    }

    errEl.hidden = true;
    setLoading(btn, true, 'Fetching from D&D Beyond…');

    try {
      const char = await characters.importDdb(id);
      toast(`Imported ${char.name}! 🎲`, 'success');
      navigate('/dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}

// ── PDF import ────────────────────────────────────────────────────

function wirePdfImport() {
  const dropZone  = document.getElementById('pdf-drop-zone');
  const fileInput = document.getElementById('pdf-file-input');
  const btn       = document.getElementById('btn-import-pdf');
  const errEl     = document.getElementById('pdf-error');
  let selectedFile = null;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  document.getElementById('pdf-remove').addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    document.getElementById('pdf-selected').hidden = true;
    btn.disabled = true;
  });

  function selectFile(file) {
    if (!file.name.endsWith('.pdf') && file.type !== 'application/pdf') {
      toast('Please select a PDF file', 'error');
      return;
    }
    selectedFile = file;
    document.getElementById('pdf-filename').textContent = file.name;
    document.getElementById('pdf-filesize').textContent =
      (file.size / 1024).toFixed(1) + ' KB';
    document.getElementById('pdf-selected').hidden = false;
    btn.disabled = false;
    errEl.hidden = true;
  }

  btn.addEventListener('click', async () => {
    if (!selectedFile) return;
    errEl.hidden = true;
    setLoading(btn, true, 'Parsing PDF…');

    try {
      const char = await characters.importPdf(selectedFile);
      toast(`Imported ${char.name} from PDF! 📄`, 'success');
      navigate('/dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}

// ── Manual form ───────────────────────────────────────────────────

function wireManualForm() {
  const form  = document.getElementById('manual-form');
  const errEl = document.getElementById('manual-error');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-import-manual');
    errEl.hidden = true;

    const dto = {
      name:            document.getElementById('m-name').value.trim(),
      race:            document.getElementById('m-race').value.trim() || null,
      className:       document.getElementById('m-class').value.trim() || null,
      level:           intVal('m-level', 1),
      background:      document.getElementById('m-background').value.trim() || null,
      maxHp:           intVal('m-hp'),
      armorClass:      intVal('m-ac'),
      speed:           intVal('m-speed', 30),
      initiativeBonus: intVal('m-init', 0),
      strength:        intVal('m-str'),
      dexterity:       intVal('m-dex'),
      constitution:    intVal('m-con'),
      intelligence:    intVal('m-int'),
      wisdom:          intVal('m-wis'),
      charisma:        intVal('m-cha'),
      avatarUrl:       document.getElementById('m-avatar').value.trim() || null,
    };

    setLoading(btn, true, 'Saving…');
    try {
      const char = await characters.createManual(dto);
      toast(`Character ${char.name} saved!`, 'success');
      navigate('/dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}

function intVal(id, fallback = null) {
  const raw = document.getElementById(id)?.value.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}
