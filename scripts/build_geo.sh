#!/usr/bin/env bash
# Rebuild the map boundaries in data/files/ from their public sources.
#
#   World:     Natural Earth 1:50m countries + land (public domain),
#              via the npm package world-atlas@2.0.2 (TopoJSON).
#   Indonesia: geoBoundaries IDN ADM1, 34 provinces (William & Mary geoLab,
#              data from OpenStreetMap, licence ODbL 1.0).
#
# Needs Node.js (npx). Run from the project folder:  ./scripts/build_geo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- World --------------------------------------------------------------
(cd "$TMP" && npm pack --silent world-atlas@2.0.2 >/dev/null && tar xzf world-atlas-2.0.2.tgz)
cp "$TMP/package/countries-50m.json" data/files/world-50m.topo.json

# ---- Indonesia provinces ----------------------------------------------------
GB=https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/IDN/ADM1
curl -sSL -o "$TMP/idn.geojson" "$GB/geoBoundaries-IDN-ADM1_simplified.geojson"

# BPS province code (used by Bank Indonesia's SEKDA tables and the
# "Kredit per Provinsi" tab) <- ISO 3166-2:ID code (used by geoBoundaries).
cat > "$TMP/codes.csv" <<'CSV'
iso,bps,nama
ID-AC,11,Aceh
ID-SU,12,Sumatera Utara
ID-SB,13,Sumatera Barat
ID-RI,14,Riau
ID-JA,15,Jambi
ID-SS,16,Sumatera Selatan
ID-BE,17,Bengkulu
ID-LA,18,Lampung
ID-BB,19,Kepulauan Bangka Belitung
ID-KR,21,Kepulauan Riau
ID-JK,31,DKI Jakarta
ID-JB,32,Jawa Barat
ID-JT,33,Jawa Tengah
ID-YO,34,DI Yogyakarta
ID-JI,35,Jawa Timur
ID-BT,36,Banten
ID-BA,51,Bali
ID-NB,52,Nusa Tenggara Barat
ID-NT,53,Nusa Tenggara Timur
ID-KB,61,Kalimantan Barat
ID-KT,62,Kalimantan Tengah
ID-KS,63,Kalimantan Selatan
ID-KI,64,Kalimantan Timur
ID-KU,65,Kalimantan Utara
ID-SA,71,Sulawesi Utara
ID-ST,72,Sulawesi Tengah
ID-SN,73,Sulawesi Selatan
ID-SG,74,Sulawesi Tenggara
ID-GO,75,Gorontalo
ID-SR,76,Sulawesi Barat
ID-MA,81,Maluku
ID-MU,82,Maluku Utara
ID-PA,91,Papua
ID-PB,92,Papua Barat
CSV

# simplify: keep 12% of vertices, never drop a whole island-province part,
#           shared borders stay shared (topology), so no gaps or overlaps
# join:     add the BPS code and Indonesian name
# each:     an interior point (always inside the polygon, unlike a centroid,
#           which can fall in the sea for an archipelago) for the circle/label
npx --yes mapshaper@0.6.102 "$TMP/idn.geojson" name=provinces \
  -rename-fields iso=shapeISO \
  -filter-fields iso \
  -join "$TMP/codes.csv" keys=iso,iso string-fields=bps,iso \
  -simplify 12% keep-shapes \
  -filter-islands min-area=4km2 \
  -each 'lx=+this.innerX.toFixed(3), ly=+this.innerY.toFixed(3)' \
  -o data/files/idn-provinces.topo.json format=topojson quantization=100000

ls -la data/files/
