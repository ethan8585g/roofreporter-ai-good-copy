// ============================================================
// Storm Scout — Satellite imagery service (Phase 5)
// - NASA GIBS WMTS tile URLs for storm-day cloud/true-color overlays
// - Google Static Maps URLs for roof-level before/after snapshots
//
// GIBS: https://nasa-gibs.github.io/gibs-api-docs/
// No API key required. Tiles are served in EPSG:3857 (Google-compatible)
// at the GoogleMapsCompatible_Level9 TileMatrixSet.
// ============================================================

export const GIBS_LAYERS = {
  // Daily true-color composite, 250m, MODIS Terra
  modis_true_color: 'MODIS_Terra_CorrectedReflectance_TrueColor',
  // Daily true-color composite, 375m, VIIRS SNPP (more recent coverage)
  viirs_true_color: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  // Precipitation rate (IMERG Late) — shows rain bands on event day
  precip_rate: 'IMERG_Precipitation_Rate'
} as const

export type GibsLayerKey = keyof typeof GIBS_LAYERS

const LAYER_FORMAT: Record<string, { ext: string; tileMatrixSet: string; maxLevel: number }> = {
  MODIS_Terra_CorrectedReflectance_TrueColor: { ext: 'jpg', tileMatrixSet: 'GoogleMapsCompatible_Level9', maxLevel: 9 },
  VIIRS_SNPP_CorrectedReflectance_TrueColor:  { ext: 'jpg', tileMatrixSet: 'GoogleMapsCompatible_Level9', maxLevel: 9 },
  IMERG_Precipitation_Rate:                   { ext: 'png', tileMatrixSet: 'GoogleMapsCompatible_Level6', maxLevel: 6 }
}

export function getGibsTileUrl(layer: string, date: string, z: number, x: number, y: number): string {
  const fmt = LAYER_FORMAT[layer] || LAYER_FORMAT.MODIS_Terra_CorrectedReflectance_TrueColor
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/${fmt.tileMatrixSet}/${z}/${y}/${x}.${fmt.ext}`
}

export function getGibsMaxZoom(layer: string): number {
  return (LAYER_FORMAT[layer] || LAYER_FORMAT.MODIS_Terra_CorrectedReflectance_TrueColor).maxLevel
}

// ------------------------------------------------------------
// Google Static Maps — high-res roof-level snapshots
// API key is kept server-side; the client asks the backend for a URL
// (generated with the key) and renders it in an <img>.
// ------------------------------------------------------------
export interface SnapshotOptions {
  lat: number
  lng: number
  zoom?: number          // default 19 — roof-level
  size?: string          // "640x640" default (max free tier)
  scale?: 1 | 2          // 2 = retina
  mapType?: 'satellite' | 'hybrid' | 'roadmap'
}

// ------------------------------------------------------------
// Basemap providers — higher-quality alternatives to Google Satellite
// ------------------------------------------------------------
export interface BasemapProvider {
  id: string
  name: string
  maxZoom: number
  attribution: string
  urlTemplate: string     // {z}/{x}/{y} placeholders (Mapbox) or {z}/{y}/{x} (Esri). Token may be {token}.
  requiresToken: boolean
}

export const BASEMAP_PROVIDERS: Record<string, BasemapProvider> = {
  esri_world_imagery: {
    id: 'esri_world_imagery',
    name: 'Esri World Imagery',
    maxZoom: 19,
    attribution: 'Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community',
    // Esri uses z/y/x ordering
    urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    requiresToken: false
  },
  mapbox_satellite: {
    id: 'mapbox_satellite',
    name: 'Mapbox Satellite',
    maxZoom: 22,
    attribution: '© Mapbox © Maxar',
    urlTemplate: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token={token}',
    requiresToken: true
  },
  nearmap: {
    // Placeholder for the future Nearmap integration (Phase B upgrade).
    id: 'nearmap',
    name: 'Nearmap (5.8 cm)',
    maxZoom: 22,
    attribution: '© Nearmap',
    urlTemplate: 'https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey={token}',
    requiresToken: true
  }
}

export function buildGoogleStaticMapUrl(apiKey: string, opts: SnapshotOptions): string {
  const zoom = opts.zoom ?? 19
  const size = opts.size ?? '640x640'
  const scale = opts.scale ?? 2
  const mapType = opts.mapType ?? 'satellite'
  const params = new URLSearchParams({
    center: `${opts.lat},${opts.lng}`,
    zoom: String(zoom),
    size,
    scale: String(scale),
    maptype: mapType,
    key: apiKey
  })
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
}
