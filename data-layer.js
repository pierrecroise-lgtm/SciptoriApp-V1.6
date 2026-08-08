// ScriptoriApp — data-layer.js
//
// Couche d'accès aux données de la Réserve — maintenant branchée sur
// Firestore (users/{uid}/books/{bookId}), en temps réel via onSnapshot :
// un livre ajouté sur un appareil apparaît automatiquement sur les autres,
// sans recharger la page.
//
// IMPORTANT — changement de pattern par rapport à la version localStorage :
// getBooks() ne suffit plus pour être notifié des changements distants.
// Utilise subscribeBooks(callback) pour être rappelé à chaque mise à jour
// (locale ou venant d'un autre appareil). getBooks() reste disponible pour
// une lecture ponctuelle du cache déjà chargé (ex: ouvrir la modale
// d'édition avec les valeurs actuelles).

import { db } from './firebase-init.js';
import { authReady } from './auth-guard.js';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getGenreGroup } from './genreGroups.js';

let uid = null;
let booksCache = [];
let listeners = [];
let snapshotStarted = false;

async function ready() {
  if (!uid) uid = await authReady;
  return uid;
}

function booksCollection() {
  return collection(db, 'users', uid, 'books');
}

function bookDoc(id) {
  return doc(db, 'users', uid, 'books', id);
}

async function startListening() {
  await ready();
  if (snapshotStarted) return;
  snapshotStarted = true;
  onSnapshot(booksCollection(), (snap) => {
    booksCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(booksCache));
  });
}

export function subscribeBooks(callback) {
  listeners.push(callback);
  callback(booksCache);
  startListening();
  return () => {
    listeners = listeners.filter((cb) => cb !== callback);
  };
}

export function getBooks() {
  return booksCache;
}

export async function addBook(bookData) {
  await ready();
  const newBook = {
    title: bookData.title,
    author: bookData.author,
    genre: bookData.genre,
    pageCount: Number(bookData.pageCount) || 0,
    pagesRead: 0,
    provenance: bookData.provenance,
    coverUrl: bookData.coverUrl || '',
    synopsis: bookData.synopsis || '',
    status: bookData.status || 'backlog',
    countsForXp: bookData.countsForXp !== false,
    // Difficulté déclarée par le joueur (1 à 3 étoiles), ex-"arcanesLevel".
    // Sert désormais au calcul de la Curiosité (bonus de fin de livre) et
    // au doublement du bonus de Régularité pendant la lecture d'un 3/3.
    difficulte: bookData.difficulte || 1,
    // Passe à true dès que le popup d'ajustement de difficulté (déclenché
    // à 60 pages lues, cf. encours-app.js) a été présenté une fois — il ne
    // doit plus jamais réapparaître ensuite pour ce livre.
    difficultePopupShown: false,
    finishedAt: bookData.status === 'finished' ? Date.now() : null,
    // Remplis au moment où "Marquer comme terminé" est confirmé.
    noteFinale: null,
    commentaireFinal: '',
    xpEarnedOnFinish: null,
    addedAt: Date.now(),
  };
  await addDoc(booksCollection(), newBook);
}

export async function startReading(id) {
  await ready();
  // .filter (pas .find) : si un doublon existe déjà (deux appareils ayant
  // démarré une lecture avant synchronisation), on les repasse TOUS en pause,
  // pas seulement le premier trouvé.
  const autresEnCours = booksCache.filter((b) => b.status === 'reading' && b.id !== id);
  await Promise.all(autresEnCours.map((b) => updateDoc(bookDoc(b.id), { status: 'backlog' })));
  await updateDoc(bookDoc(id), { status: 'reading', startedAt: Date.now() });
}

/**
 * Sélectionne LE livre en cours parmi une liste, même si plusieurs livres ont
 * (par accident, ex. collision multi-appareils) le statut "reading" : on
 * garde celui dont startedAt est le plus récent. S'auto-corrige donc même
 * si des doublons existent déjà dans Firestore, sans intervention manuelle.
 */
export function getCurrentReadingBook(books) {
  const enCours = books.filter((b) => b.status === 'reading');
  if (enCours.length === 0) return null;
  return enCours.reduce((plusRecent, b) =>
    (b.startedAt || 0) > (plusRecent.startedAt || 0) ? b : plusRecent
  );
}

export async function updateBook(id, patch) {
  await ready();
  await updateDoc(bookDoc(id), patch);
}

export async function deleteBook(id) {
  await ready();
  await deleteDoc(bookDoc(id));
}

export function computeStats(books) {
  const totalBooksOwned = books.length;
  const finished = books.filter((b) => b.status === 'finished');
  const totalBooksFinished = finished.length;

  const genresExplored = new Set(finished.map((b) => b.genre));
  const genresNeverExplored = new Set(
    books
      .filter((b) => b.status !== 'finished')
      .map((b) => b.genre)
      .filter((g) => !genresExplored.has(g))
  );

  const hasFinishedHorsTheme = finished.some(
    (b) => b.countsForXp && getGenreGroup(b.genre) !== 'favori'
  );

  return {
    totalBooksOwned,
    totalBooksFinished,
    genresNeverExploredCount: genresNeverExplored.size,
    hasFinishedHorsTheme,
  };
}
function seanceDoc(id) {
  return doc(db, 'users', uid, 'seances', id);
}

export async function updateSeance(id, patch) {
  await ready();
  await updateDoc(seanceDoc(id), patch);
}

// --- Acquisitions (Tableau des Primes) --------------------------------
// Sous-collection distincte de "books" : une acquisition est une envie
// (pas encore possédée), qui se transforme en livre de Réserve au moment
// où elle est "acquise" (cf. acquisitionToBook ci-dessous), puis disparaît
// de cette liste. Aucune notion de prix/budget ni de lien avec l'XP.

let acquisitionsCache = [];
let acquisitionsListeners = [];
let acquisitionsSnapshotStarted = false;

function acquisitionsCollection() {
  return collection(db, 'users', uid, 'acquisitions');
}

function acquisitionDoc(id) {
  return doc(db, 'users', uid, 'acquisitions', id);
}

async function startListeningAcquisitions() {
  await ready();
  if (acquisitionsSnapshotStarted) return;
  acquisitionsSnapshotStarted = true;
  onSnapshot(acquisitionsCollection(), (snap) => {
    acquisitionsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    acquisitionsListeners.forEach((cb) => cb(acquisitionsCache));
  });
}

export function subscribeAcquisitions(callback) {
  acquisitionsListeners.push(callback);
  callback(acquisitionsCache);
  startListeningAcquisitions();
  return () => {
    acquisitionsListeners = acquisitionsListeners.filter((cb) => cb !== callback);
  };
}

export async function addAcquisition(data) {
  await ready();
  await addDoc(acquisitionsCollection(), {
    title: data.title,
    author: data.author,
    genre: data.genre,
    priorite: Number(data.priorite) || 1,
    lienExterne: data.lienExterne || '',
    addedAt: Date.now(),
    // Angle d'affichage figé à la création (look "punaisé au hasard"),
    // pour ne pas que chaque avis pivote différemment à chaque rendu.
    inclinaison: Math.round((Math.random() * 6 - 3) * 10) / 10,
  });
}

export async function updateAcquisition(id, patch) {
  await ready();
  await updateDoc(acquisitionDoc(id), patch);
}

export async function deleteAcquisition(id) {
  await ready();
  await deleteDoc(acquisitionDoc(id));
}

/**
 * Convertit une acquisition en livre de Réserve (statut "backlog",
 * difficulté par défaut 1 — la difficulté de lecture n'a aucun rapport
 * avec la priorité d'envie), puis supprime l'avis du tableau.
 */
export async function acquerirLivre(acquisition) {
  await ready();
  await addBook({
    title: acquisition.title,
    author: acquisition.author,
    genre: acquisition.genre,
    provenance: 'achete',
    status: 'backlog',
  });
  await deleteAcquisition(acquisition.id);
}
