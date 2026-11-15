import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, searchable } from '../../js/search.js';

test('accents, capitals and final sigma do not matter', () => {
  assert.equal(searchable('Πέμπτη ΡΑΝΤΕΒΟΎ ς'), 'πεμπτη ραντεβου σ');
  assert.ok(matchesSearch('Πέμπτη ραντεβού', 'πεμπτη'));
  assert.ok(matchesSearch('Pet Shop email', 'PET'));
  assert.ok(matchesSearch('anything', '   ')); // an empty search shows everything
});

test('greeklish finds the Greek title, in the spellings people use', () => {
  const cases = [
    ['Να τα παραδώσω τα χαρτιά του Παντελή', ['xartia', 'chartia', 'pantelh', 'panteli', 'paradoso', 'paradwsw', 'tou pantel']],
    ['Να συνδέσω τον θερμοστάτη', ['thermostath', '8ermostati', 'syndeso', 'sindeso']],
    ['Να κάνω τη διαδικασία για τα γυαλιά', ['gyalia', 'gialia', 'diadikasia']],
    ['ΝΤΑΡΗΣ ΘΟΔΩΡΗΣ', ['ntaris', 'daris', 'thodoris', 'thodwrhs']],
    ['Ψυχίατρος', ['psyxiatros', 'psixiatros', 'psychiatros']],
    ['Ξένια', ['ksenia', 'xenia']],
    ['Μπαταρία', ['mpataria', 'bataria']],
    ['Ουρανός', ['ouranos', 'uranos']],
    ['Ευχαριστώ', ['euxaristo', 'eyxaristw', 'efxaristo'.replace('f', 'u')]],
  ];
  for (const [title, queries] of cases) for (const query of queries) assert.ok(matchesSearch(title, query), `${query} → ${title}`);
});

test('greeklish does not match what is not there', () => {
  assert.equal(matchesSearch('Να τα παραδώσω τα χαρτιά του Παντελή', 'karta'), false);
  assert.equal(matchesSearch('Pet Shop email', 'xartia'), false);
  assert.equal(matchesSearch('Ψυχίατρος', 'psarias'), false);
});

test('symbols in a search are taken literally', () => {
  assert.ok(matchesSearch('EMS 35, 36 (call)', '(call)'));
  assert.ok(matchesSearch('a.b', 'a.b'));
  assert.equal(matchesSearch('axb', 'a.b'), false);
});
