// app.js — bootstrap: registra le rotte (equivalente delle @app.route Flask) e avvia il router

import { route, startRouter } from './router.js';
import {
  viewHome, viewSearch,
  viewTripsList, viewTripForm, viewTripDetail, viewTripTags,
  viewCountriesList, viewCountryDetail,
  viewTagsList,
  viewEntryDetail, viewEntryForm,
  viewAnnotationForm, viewAnnotationDetail,
  viewBackup,
} from './views.js';

// le rotte con segmento fisso (es. /trips/new) vanno registrate PRIMA di
// quelle con parametro (es. /trips/:id), altrimenti ':id' catturerebbe 'new'
route('/', viewHome);
route('/search', viewSearch);
route('/backup', viewBackup);

route('/trips', viewTripsList);
route('/trips/new', viewTripForm);
route('/trips/:id/tags', viewTripTags);
route('/trips/:id/edit', viewTripForm);
route('/trips/:id', viewTripDetail);

route('/countries', viewCountriesList);
route('/countries/:id', viewCountryDetail);

route('/tags', viewTagsList);

route('/entry/new', viewEntryForm);
route('/entry/:id/edit', viewEntryForm);
route('/entry/:id/annotation/new', (params) => viewAnnotationForm({ entryId: params.id }));
route('/entry/:id', viewEntryDetail);

route('/annotation/:id/edit', (params) => viewAnnotationForm({ annotationId: params.id }));
route('/annotation/:id', viewAnnotationDetail);

startRouter();

// service worker: rende l'app disponibile offline dopo il primo caricamento
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('registrazione service worker fallita:', err);
    });
  });
}

// richiede storage persistente, così Android non svuota i dati dell'app
// in caso di poco spazio (concessa quasi sempre senza prompt visibile)
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((granted) => {
    console.log('storage persistente:', granted ? 'concesso' : 'non concesso');
  });
}
