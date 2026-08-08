// ScriptoriApp — acquisition-app.js
//
// Le Tableau des Primes : liste d'envies, distincte de la Réserve (un
// livre y figure tant qu'il n'est pas possédé). Pas de prix/budget, pas
// de lien avec l'XP — uniquement une priorité (1 à 3 étoiles) et un
// bouton "Acquérir" qui transforme l'avis en livre de Réserve.

import {
  subscribeAcquisitions,
  addAcquisition,
  updateAcquisition,
  deleteAcquisition,
  acquerirLivre,
} from './data-layer.js';
import { getGenreLabel } from './genreGroups.js';

const els = {
  hint: document.getElementById('acquisitions-hint'),
  list: document.getElementById('avis-list'),
  openAddModal: document.getElementById('open-add-modal'),
  modal: document.getElementById('modal-avis'),
  modalTitle: document.getElementById('modal-title'),
  form: document.getElementById('avis-form'),
  cancelBtn: document.getElementById('cancel-avis'),
  deleteBtn: document.getElementById('delete-avis'),
  submitBtn: document.getElementById('modal-submit-btn'),
  prioriteEtoiles: document.getElementById('f-priorite-etoiles'),
  prioriteInput: document.getElementById('f-priorite'),
};

let editingId = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function setPrioriteEtoiles(valeur) {
  els.prioriteInput.value = String(valeur);
  els.prioriteEtoiles.querySelectorAll('.etoile').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.valeur) <= valeur);
  });
}

els.prioriteEtoiles.querySelectorAll('.etoile').forEach((btn) => {
  btn.addEventListener('click', () => setPrioriteEtoiles(Number(btn.dataset.valeur)));
});

function renderEtoiles(priorite) {
  return `★★★`.slice(0, priorite) +
    `<span class="etoile-vide">${'★'.repeat(3 - priorite)}</span>`;
}

function renderAvis(avis) {
  const li = document.createElement('li');
  li.className = 'avis';
  li.style.setProperty('--incl', `${avis.inclinaison ?? 0}deg`);
  li.dataset.id = avis.id;
  li.innerHTML = `
    <span class="avis__genre">${escapeHtml(getGenreLabel(avis.genre))}</span>
    <p class="avis__title">${escapeHtml(avis.title)}</p>
    <p class="avis__author">${escapeHtml(avis.author)}</p>
    <div class="avis__etoiles">${renderEtoiles(avis.priorite || 1)}</div>
    ${avis.lienExterne ? `<a class="avis__lien" href="${escapeHtml(avis.lienExterne)}" target="_blank" rel="noopener">${escapeHtml(avis.lienExterne)}</a>` : ''}
    <div class="avis__actions">
      <button class="btn-acquerir" type="button" data-action="acquerir">Acquérir</button>
      <button class="btn-editer" type="button" data-action="editer" aria-label="Modifier">✏️</button>
    </div>
  `;

  li.querySelector('[data-action="acquerir"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await acquerirLivre(avis);
    } catch (error) {
      console.error("Impossible d'acquérir ce livre", error);
      btn.disabled = false;
      btn.textContent = 'Acquérir';
    }
  });

  li.querySelector('[data-action="editer"]').addEventListener('click', () => openEditModal(avis));

  return li;
}

function renderList(acquisitions) {
  els.list.innerHTML = '';

  if (acquisitions.length === 0) {
    els.hint.textContent = 'Le tableau est vide — aucune convoitise en attente.';
    return;
  }

  els.hint.textContent = `${acquisitions.length} avis en attente sur le tableau.`;
  const parPriorite = [...acquisitions].sort((a, b) => (b.priorite || 1) - (a.priorite || 1));
  parPriorite.forEach((avis) => els.list.appendChild(renderAvis(avis)));
}

subscribeAcquisitions(renderList);

// --- Modale d'ajout / modification -----------------------------------

function openAddModal() {
  editingId = null;
  els.form.reset();
  setPrioriteEtoiles(1);
  els.modalTitle.textContent = 'Placer un avis';
  els.submitBtn.textContent = "Placer l'avis";
  els.deleteBtn.hidden = true;
  els.modal.classList.add('is-open');
}

function openEditModal(avis) {
  editingId = avis.id;
  els.form.elements['title'].value = avis.title;
  els.form.elements['author'].value = avis.author;
  els.form.elements['genre'].value = avis.genre;
  els.form.elements['lienExterne'].value = avis.lienExterne || '';
  setPrioriteEtoiles(avis.priorite || 1);
  els.modalTitle.textContent = 'Modifier l’avis';
  els.submitBtn.textContent = 'Enregistrer';
  els.deleteBtn.hidden = false;
  els.modal.classList.add('is-open');
}

function closeModal() {
  els.modal.classList.remove('is-open');
  editingId = null;
}

els.openAddModal.addEventListener('click', openAddModal);
els.cancelBtn.addEventListener('click', closeModal);

els.deleteBtn.addEventListener('click', async () => {
  if (!editingId) return;
  await deleteAcquisition(editingId);
  closeModal();
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(els.form);
  const payload = {
    title: (data.get('title') || '').trim(),
    author: (data.get('author') || '').trim(),
    genre: data.get('genre'),
    priorite: Number(data.get('priorite')) || 1,
    lienExterne: (data.get('lienExterne') || '').trim(),
  };

  if (!payload.title || !payload.author) return;

  if (editingId) {
    await updateAcquisition(editingId, payload);
  } else {
    await addAcquisition(payload);
  }

  closeModal();
});
