import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, TAGS, normalizeTags, expandTags, familyOf, tagsForBpm } from '../shared/genres.js';
import { suggestUsername, usernameProblem } from '../shared/users.js';

test('every tag id is unique and well-formed', () => {
  const ids = FAMILIES.flatMap((f) => [f.id, ...f.genres.map((g) => g.id)]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(TAGS.size, ids.length);
});

test('normalizeTags keeps known ids, in order, without repeats, up to the limit', () => {
  assert.deepEqual(normalizeTags(['techno', 'nope', 'techno', 'house', 3], 5), ['techno', 'house']);
  assert.deepEqual(normalizeTags(['a', 'techno', 'house', 'dnb'], 2), ['techno', 'house']);
  assert.deepEqual(normalizeTags('techno', 5), []);
});

test('expandTags reaches up to the family and down to its genres', () => {
  assert.deepEqual(expandTags(['dub-techno']).sort(), ['dub-techno', 'techno']);
  const dnb = expandTags(['dnb']);
  assert.ok(dnb.includes('jungle') && dnb.includes('dnb'));
  assert.equal(familyOf('jungle'), 'dnb');
  assert.equal(familyOf('dnb'), 'dnb');
  assert.equal(familyOf('nope'), null);
});

test('tempo hints', () => {
  assert.ok(tagsForBpm(174).includes('dnb'));
  assert.ok(!tagsForBpm(174).includes('house'));
});

test('usernames', () => {
  assert.equal(suggestUsername('Ada Lovelace'), 'ada_lovelace');
  assert.equal(suggestUsername('42'), 'user_42');
  assert.equal(suggestUsername(''), 'user');
  assert.equal(usernameProblem('ada'), null);
  assert.ok(usernameProblem('Ada'));
  assert.ok(usernameProblem('a'));
  assert.ok(usernameProblem('1abc'));
  assert.ok(usernameProblem(''));
});
