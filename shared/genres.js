/**
 * A taxonomy of electronic music, for labelling songs and for saying what
 * you're into. Two levels: families (House, Techno, …) and the genres within
 * them. Either level is a valid tag — "techno" says as much as anyone needs
 * for a sketch, "dub-techno" says more.
 *
 * Ids are stable and stored in songs and profiles; labels are for display
 * and may change. `bpm` is the usual tempo range, a hint for suggestions.
 */

const family = (id, label, bpm, genres) => ({
  id, label, bpm,
  genres: genres.map(([gid, glabel, gbpm]) => ({ id: gid, label: glabel, bpm: gbpm ?? bpm, family: id })),
});

export const FAMILIES = Object.freeze([
  family('house', 'House', [118, 130], [
    ['chicago-house', 'Chicago house'],
    ['deep-house', 'Deep house', [118, 125]],
    ['tech-house', 'Tech house', [124, 130]],
    ['acid-house', 'Acid house'],
    ['progressive-house', 'Progressive house', [124, 130]],
    ['french-house', 'French house'],
    ['electro-house', 'Electro house', [126, 132]],
    ['bass-house', 'Bass house', [126, 130]],
    ['tropical-house', 'Tropical house', [100, 118]],
    ['afro-house', 'Afro house', [118, 125]],
    ['lo-fi-house', 'Lo-fi house', [115, 125]],
    ['microhouse', 'Microhouse', [120, 128]],
    ['ghetto-house', 'Ghetto house', [130, 145]],
  ]),
  family('techno', 'Techno', [125, 145], [
    ['detroit-techno', 'Detroit techno', [125, 135]],
    ['minimal-techno', 'Minimal techno', [125, 132]],
    ['dub-techno', 'Dub techno', [118, 128]],
    ['acid-techno', 'Acid techno', [130, 145]],
    ['industrial-techno', 'Industrial techno', [130, 145]],
    ['hard-techno', 'Hard techno', [140, 160]],
    ['melodic-techno', 'Melodic techno', [120, 126]],
    ['ambient-techno', 'Ambient techno', [110, 130]],
    ['ghettotech', 'Ghettotech', [145, 160]],
  ]),
  family('trance', 'Trance', [130, 145], [
    ['progressive-trance', 'Progressive trance', [128, 138]],
    ['uplifting-trance', 'Uplifting trance', [136, 142]],
    ['vocal-trance', 'Vocal trance', [132, 140]],
    ['tech-trance', 'Tech trance', [135, 142]],
    ['goa-trance', 'Goa trance', [135, 150]],
    ['psytrance', 'Psytrance', [138, 150]],
    ['hard-trance', 'Hard trance', [140, 150]],
  ]),
  family('electro', 'Electro', [120, 135], [
    ['electro-funk', 'Electro-funk', [115, 130]],
    ['miami-bass', 'Miami bass', [120, 135]],
    ['freestyle', 'Freestyle', [115, 130]],
    ['electroclash', 'Electroclash', [120, 135]],
    ['skweee', 'Skweee', [90, 115]],
  ]),
  family('breakbeat', 'Breakbeat', [120, 140], [
    ['big-beat', 'Big beat', [110, 130]],
    ['nu-skool-breaks', 'Nu-skool breaks', [125, 140]],
    ['progressive-breaks', 'Progressive breaks', [125, 135]],
    ['florida-breaks', 'Florida breaks', [125, 140]],
    ['acid-breaks', 'Acid breaks', [125, 140]],
  ]),
  family('garage', 'Garage', [128, 140], [
    ['uk-garage', 'UK garage', [130, 138]],
    ['2-step', '2-step', [130, 138]],
    ['speed-garage', 'Speed garage', [130, 140]],
    ['bassline', 'Bassline', [135, 142]],
    ['uk-funky', 'UK funky', [128, 135]],
    ['future-garage', 'Future garage', [125, 140]],
  ]),
  family('bass', 'Dubstep & bass', [135, 150], [
    ['dubstep', 'Dubstep', [138, 142]],
    ['brostep', 'Brostep', [140, 150]],
    ['riddim', 'Riddim', [140, 150]],
    ['uk-bass', 'UK bass', [125, 140]],
    ['grime', 'Grime', [136, 142]],
    ['future-bass', 'Future bass', [130, 160]],
    ['wave', 'Wave', [130, 160]],
    ['wonky', 'Wonky', [120, 145]],
    ['glitch-hop', 'Glitch hop', [90, 115]],
    ['trap-edm', 'Trap', [135, 160]],
  ]),
  family('dnb', 'Drum & bass', [160, 180], [
    ['jungle', 'Jungle', [155, 170]],
    ['liquid-dnb', 'Liquid', [170, 176]],
    ['neurofunk', 'Neurofunk', [170, 178]],
    ['techstep', 'Techstep', [170, 176]],
    ['jump-up', 'Jump-up', [170, 176]],
    ['darkstep', 'Darkstep', [170, 180]],
    ['drumfunk', 'Drumfunk', [165, 175]],
    ['halftime', 'Halftime', [85, 90]],
    ['atmospheric-dnb', 'Atmospheric', [165, 175]],
  ]),
  family('hardcore', 'Hardcore', [150, 200], [
    ['happy-hardcore', 'Happy hardcore', [160, 180]],
    ['uk-hardcore', 'UK hardcore', [165, 180]],
    ['gabber', 'Gabber', [160, 200]],
    ['hardstyle', 'Hardstyle', [145, 155]],
    ['rawstyle', 'Rawstyle', [150, 160]],
    ['frenchcore', 'Frenchcore', [190, 220]],
    ['breakcore', 'Breakcore', [160, 250]],
    ['speedcore', 'Speedcore', [250, 400]],
    ['digital-hardcore', 'Digital hardcore', [160, 200]],
  ]),
  family('club', 'Club & global bass', [125, 160], [
    ['juke', 'Juke', [155, 165]],
    ['footwork', 'Footwork', [155, 165]],
    ['jersey-club', 'Jersey club', [130, 140]],
    ['baltimore-club', 'Baltimore club', [130, 140]],
    ['kuduro', 'Kuduro', [125, 140]],
    ['gqom', 'Gqom', [120, 130]],
    ['amapiano', 'Amapiano', [110, 118]],
    ['baile-funk', 'Baile funk', [125, 135]],
    ['moombahton', 'Moombahton', [108, 112]],
    ['deconstructed-club', 'Deconstructed club', [120, 160]],
  ]),
  family('ambient-downtempo', 'Ambient & downtempo', [60, 110], [
    ['ambient', 'Ambient', [60, 90]],
    ['dark-ambient', 'Dark ambient', [60, 90]],
    ['drone', 'Drone', [60, 80]],
    ['downtempo', 'Downtempo', [80, 110]],
    ['trip-hop', 'Trip-hop', [80, 100]],
    ['chillout', 'Chillout', [80, 110]],
    ['chillwave', 'Chillwave', [80, 110]],
    ['psybient', 'Psybient', [80, 110]],
    ['new-age', 'New age', [60, 90]],
    ['dub', 'Dub', [70, 90]],
  ]),
  family('experimental', 'IDM & experimental', [80, 160], [
    ['idm', 'IDM', [100, 160]],
    ['braindance', 'Braindance', [100, 160]],
    ['glitch', 'Glitch', [80, 140]],
    ['electroacoustic', 'Electroacoustic', [60, 120]],
    ['noise', 'Noise', [60, 200]],
    ['microsound', 'Microsound', [60, 120]],
    ['plunderphonics', 'Plunderphonics', [80, 130]],
  ]),
  family('synth', 'Synth & pop', [90, 130], [
    ['synthpop', 'Synthpop', [110, 130]],
    ['electropop', 'Electropop', [110, 130]],
    ['synthwave', 'Synthwave', [85, 118]],
    ['darksynth', 'Darksynth', [100, 130]],
    ['vaporwave', 'Vaporwave', [60, 90]],
    ['futurepop', 'Futurepop', [120, 135]],
    ['hyperpop', 'Hyperpop', [120, 180]],
    ['chiptune', 'Chiptune', [120, 170]],
    ['bitpop', 'Bitpop', [110, 140]],
  ]),
  family('disco-dance', 'Disco & dance', [110, 140], [
    ['disco', 'Disco', [110, 125]],
    ['italo-disco', 'Italo disco', [115, 130]],
    ['nu-disco', 'Nu-disco', [110, 125]],
    ['space-disco', 'Space disco', [110, 125]],
    ['boogie', 'Boogie', [105, 120]],
    ['hi-nrg', 'Hi-NRG', [125, 140]],
    ['eurodance', 'Eurodance', [130, 145]],
    ['eurobeat', 'Eurobeat', [150, 165]],
  ]),
  family('industrial-dark', 'Industrial & dark', [100, 140], [
    ['industrial', 'Industrial', [100, 140]],
    ['ebm', 'EBM', [115, 130]],
    ['dark-electro', 'Dark electro', [120, 140]],
    ['aggrotech', 'Aggrotech', [130, 145]],
    ['power-noise', 'Power noise', [120, 150]],
    ['darkwave', 'Darkwave', [100, 130]],
    ['coldwave', 'Coldwave', [110, 140]],
    ['minimal-wave', 'Minimal wave', [110, 135]],
    ['witch-house', 'Witch house', [60, 80]],
  ]),
  family('hiphop', 'Hip-hop & beats', [70, 100], [
    ['instrumental-hip-hop', 'Instrumental hip-hop', [80, 100]],
    ['lo-fi-hip-hop', 'Lo-fi hip-hop', [70, 90]],
    ['trap', 'Trap', [65, 80]],
    ['drill', 'Drill', [138, 145]],
    ['phonk', 'Phonk', [125, 145]],
    ['cloud-rap', 'Cloud rap', [60, 80]],
    ['beat-scene', 'Beat scene', [80, 100]],
  ]),
]);

/** Every tag, by id: families and genres alike. */
export const TAGS = new Map();
for (const f of FAMILIES) {
  TAGS.set(f.id, { id: f.id, label: f.label, bpm: f.bpm, family: null });
  for (const g of f.genres) TAGS.set(g.id, g);
}

export const TAG_LIMITS = Object.freeze({
  perSong: 5,
  interests: 40,
});

export const tagLabel = (id) => TAGS.get(id)?.label ?? id;

/** A tag's family (itself, for a family tag). */
export const familyOf = (id) => {
  const t = TAGS.get(id);
  return t ? t.family ?? t.id : null;
};

/**
 * Clean a list of tags: known ids only, no repeats, at most `max`. Anything
 * that isn't a list gives an empty one — a song can always be saved.
 */
export function normalizeTags(x, max) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const t of x) {
    if (typeof t === 'string' && TAGS.has(t) && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The tags a set of interests should match. Liking a family means liking
 * everything in it; liking a genre also means liking songs tagged only with
 * its family, since a song tagged "house" might well be deep house.
 */
export function expandTags(ids) {
  const out = new Set();
  for (const id of ids) {
    const t = TAGS.get(id);
    if (!t) continue;
    out.add(t.id);
    if (t.family) out.add(t.family);
    else for (const g of FAMILIES.find((f) => f.id === t.id).genres) out.add(g.id);
  }
  return [...out];
}

/** Tags whose usual tempo range covers `bpm`, families first. */
export function tagsForBpm(bpm) {
  return [...TAGS.values()].filter((t) => bpm >= t.bpm[0] && bpm <= t.bpm[1]).map((t) => t.id);
}
