/*
 * GEOGRAPHY — boundaries for the two maps.
 *
 *   world      Natural Earth 1:50m countries + land  (data/files/world-50m.topo.json)
 *   provinces  geoBoundaries IDN ADM1, 34 provinces  (data/files/idn-provinces.topo.json)
 *
 * Both are TopoJSON: borders shared by neighbours are stored once, so the
 * files are small and neighbouring shapes never leave gaps. topojson-client
 * turns them back into GeoJSON features that d3.geoPath can draw.
 * Rebuild them with scripts/build_geo.sh.
 */
(function () {
  // dashboard key -> ISO 3166-1 numeric id used by Natural Earth / world-atlas
  const ISO_NUM = { us: '840', id: '360', th: '764', vn: '704', kr: '410', in: '356', au: '036', cn: '156', tw: '158', ph: '608', my: '458', jp: '392' };
  const KEY_OF = Object.fromEntries(Object.entries(ISO_NUM).map(([k, v]) => [v, k]));

  let memoFor = null, memo = null;

  // Decoded geography, or null while the files are still loading.
  window.eoGeo = function () {
    const w = dash.data('world'), p = dash.data('provinces');
    if (w.status !== 'ok' || p.status !== 'ok' || !w.data.objects || !p.data.objects) return null;
    if (memoFor && memoFor[0] === w.data && memoFor[1] === p.data) return memo;
    const W = w.data, P = p.data;
    const countries = topojson.feature(W, W.objects.countries);
    const provinces = topojson.feature(P, P.objects.provinces);
    memo = {
      land: topojson.feature(W, W.objects.land),
      borders: topojson.mesh(W, W.objects.countries, (a, b) => a !== b),
      // the 12 markets the dashboard compares, keyed like the rest of the code
      ctry: {
        type: 'FeatureCollection',
        features: countries.features.filter((f) => KEY_OF[f.id]).map((f) => ({ type: 'Feature', properties: { i: KEY_OF[f.id], name: f.properties.name }, geometry: f.geometry })),
      },
      provinces,
      byBps: Object.fromEntries(provinces.features.map((f) => [f.properties.bps, f])),
      provBorders: topojson.mesh(P, P.objects.provinces, (a, b) => a !== b),  // inner borders
      coast: topojson.mesh(P, P.objects.provinces, (a, b) => a === b),        // outer edge
    };
    memoFor = [W, P];
    return memo;
  };

  // Where to put a province's circle and label.
  //  1. the point from the Sheet, if it lies inside the province (it encodes
  //     judgment: e.g. Batam/Bintan, not the larger but emptier Natuna);
  //  2. otherwise the centre of the province's island nearest to that point;
  //  3. otherwise the interior point computed when the file was built.
  window.eoAnchor = function (feature, lonlat) {
    const props = feature.properties;
    const ok = lonlat && isFinite(lonlat[0]) && isFinite(lonlat[1]);
    if (ok && d3.geoContains(feature, lonlat)) return lonlat;
    if (ok) {
      const g = feature.geometry;
      const parts = g.type === 'MultiPolygon' ? g.coordinates.map((c) => ({ type: 'Polygon', coordinates: c })) : [g];
      let best = null, bestD = Infinity;
      parts.forEach((part) => {
        const c = d3.geoCentroid(part), dist = d3.geoDistance(c, lonlat);
        if (dist < bestD) { bestD = dist; best = { part, c }; }
      });
      if (best && d3.geoContains(best.part, best.c)) return best.c;
    }
    return [props.lx, props.ly];
  };
})();
