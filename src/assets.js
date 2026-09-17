'use strict';
// Loads the packed atlas pages (assets/atlas-N.png) and attaches the page image to every sheet, slice and tilemap record.
TS.Assets = (() => {
  const pages = [];
  const S = TS_ATLAS.sheets;
  function load(onProgress) {
    const list = TS_ATLAS.pages;
    let done = 0;
    return Promise.all(list.map((p, i) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { pages[i] = img; done++; if (onProgress) onProgress(done, list.length); resolve(); };
      img.onerror = () => reject(new Error('Failed to load atlas page: ' + p));
      img.src = p;
    }))).then(() => {
      for (const k in S) S[k].img = pages[S[k].pg];
      for (const k in TS_ATLAS.nine) TS_ATLAS.nine[k].img = pages[TS_ATLAS.nine[k].pg];
      for (const k in TS_ATLAS.three) TS_ATLAS.three[k].img = pages[TS_ATLAS.three[k].pg];
      for (const k in TS_ATLAS.tilemaps) TS_ATLAS.tilemaps[k].img = pages[TS_ATLAS.tilemaps[k].pg];
      return pages;
    });
  }
  function sheet(key) { const s = S[key]; if (!s) throw new Error('Unknown sheet ' + key); return s; }
  function tilemap(key) { return TS_ATLAS.tilemaps[key]; }
  return { pages, S, load, sheet, tilemap };
})();
