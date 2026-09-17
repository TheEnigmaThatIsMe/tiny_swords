'use strict';
// Loads every PNG referenced by TS_ATLAS and attaches `img` to each sheet/slice record.
TS.Assets = (() => {
  const images = {};
  const S = TS_ATLAS.sheets;
  function load(onProgress) {
    const paths = new Set();
    for (const k in S) paths.add(S[k].p);
    for (const k in TS_ATLAS.nine) paths.add(TS_ATLAS.nine[k].p);
    for (const k in TS_ATLAS.three) paths.add(TS_ATLAS.three[k].p);
    for (const k in TS_ATLAS.tilemaps) paths.add(TS_ATLAS.tilemaps[k]);
    const list = Array.from(paths);
    let done = 0;
    return Promise.all(list.map(p => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images[p] = img; done++; if (onProgress) onProgress(done, list.length); resolve(); };
      img.onerror = () => reject(new Error('Failed to load image: ' + p));
      img.src = TS_ATLAS.base + p;
    }))).then(() => {
      for (const k in S) S[k].img = images[S[k].p];
      for (const k in TS_ATLAS.nine) TS_ATLAS.nine[k].img = images[TS_ATLAS.nine[k].p];
      for (const k in TS_ATLAS.three) TS_ATLAS.three[k].img = images[TS_ATLAS.three[k].p];
      return images;
    });
  }
  function sheet(key) { const s = S[key]; if (!s) throw new Error('Unknown sheet ' + key); return s; }
  function tilemap(key) { return images[TS_ATLAS.tilemaps[key]]; }
  return { images, S, load, sheet, tilemap };
})();
