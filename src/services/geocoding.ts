export type LatLng = { lat: number; lng: number }

export async function geocodeAddress(address: string, apiKey: string): Promise<LatLng | null> {
  if (!address || !apiKey) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data: any = await res.json()
  const loc = data?.results?.[0]?.geometry?.location
  if (!loc || typeof loc.lat !== 'number') return null
  return { lat: loc.lat, lng: loc.lng }
}

export type OptimizedRoute = {
  order: number[]
  totalMeters: number
  totalSeconds: number
  polyline: string
  legs: Array<{ distanceMeters: number; durationSeconds: number }>
}

export async function optimizeRoute(
  origin: LatLng,
  stops: LatLng[],
  apiKey: string,
  destination?: LatLng
): Promise<OptimizedRoute | null> {
  if (!apiKey || stops.length === 0) return null
  const dest = destination || stops[stops.length - 1]
  const waypointStops = destination ? stops : stops.slice(0, -1)
  const waypoints = waypointStops.length
    ? `&waypoints=optimize:true|${waypointStops.map(s => `${s.lat},${s.lng}`).join('|')}`
    : ''
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}${waypoints}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data: any = await res.json()
  const route = data?.routes?.[0]
  if (!route) return null
  const waypointOrder: number[] = route.waypoint_order || []
  const order = destination
    ? waypointOrder
    : [...waypointOrder, stops.length - 1]
  const legs = (route.legs || []).map((l: any) => ({
    distanceMeters: l.distance?.value || 0,
    durationSeconds: l.duration?.value || 0,
  }))
  return {
    order,
    totalMeters: legs.reduce((a: number, l: any) => a + l.distanceMeters, 0),
    totalSeconds: legs.reduce((a: number, l: any) => a + l.durationSeconds, 0),
    polyline: route.overview_polyline?.points || '',
    legs,
  }
}
