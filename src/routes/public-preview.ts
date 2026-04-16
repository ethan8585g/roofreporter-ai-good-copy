import { Hono } from 'hono';

// Simple in-memory rate limiter (resets on worker restart, fine for rate limiting)
const ipHourly = new Map<string, {count: number, reset: number}>();

export const publicPreviewRoutes = new Hono<{Bindings: any}>();

publicPreviewRoutes.post('/preview', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

  // Rate limit: 10/hour per IP
  const now = Date.now();
  const hourKey = ip;
  const existing = ipHourly.get(hourKey);
  if (existing && now < existing.reset) {
    if (existing.count >= 10) {
      return c.json({ error: 'preview_limit', message: 'Free previews are paused. Create an account for unlimited access.' }, 429);
    }
    existing.count++;
  } else {
    ipHourly.set(hourKey, { count: 1, reset: now + 3600000 });
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_body' }, 400); }

  const address = (body.address || '').trim();
  if (!address) return c.json({ error: 'address_required' }, 400);

  const utm = body.utm || {};
  const previewId = crypto.randomUUID();

  try {
    // Use the Google Geocoding + Solar API
    // First geocode the address to get lat/lng
    const mapsKey = (c.env as any).GOOGLE_MAPS_API_KEY || (c.env as any).GOOGLE_SOLAR_API_KEY;
    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}`);
    const geoData = await geoRes.json() as any;

    if (!geoData.results || geoData.results.length === 0) {
      return c.json({ error: 'address_not_found', message: 'Could not find that address. Try a full street address with city.' }, 400);
    }

    const loc = geoData.results[0].geometry.location;
    const lat = loc.lat;
    const lng = loc.lng;

    // Fetch Solar API building insights
    const solarKey = (c.env as any).GOOGLE_SOLAR_API_KEY;
    const solarRes = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${solarKey}`);

    let footprintM2 = 0;
    let pitchDeg = 0;
    let segmentCount = 0;

    if (solarRes.ok) {
      const solarData = await solarRes.json() as any;
      const stats = solarData?.solarPotential?.roofSegmentStats;
      if (stats && stats.length > 0) {
        segmentCount = stats.length;
        pitchDeg = stats.reduce((sum: number, s: any) => sum + (s.pitchDegrees || 0), 0) / stats.length;
        footprintM2 = stats.reduce((sum: number, s: any) => sum + (s.stats?.areaMeters2 || 0), 0);
      }
    }

    const estimatedAreaSqft = Math.round(footprintM2 * 10.764);
    const satelliteTileUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=600x400&maptype=satellite&key=${mapsKey}`;

    // Write to D1
    try {
      await (c.env as any).DB.prepare(`
        INSERT INTO preview_requests (preview_id, address, lat, lng, footprint_m2, pitch_deg, segment_count, ip, user_agent, utm_source, utm_medium, utm_campaign)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        previewId, address, lat, lng, footprintM2,
        Math.round(pitchDeg * 10) / 10, segmentCount,
        ip, c.req.header('User-Agent') || '',
        utm.source || '', utm.medium || '', utm.campaign || ''
      ).run();
    } catch (dbErr) {
      // Non-fatal — still return the preview
      console.error('preview_requests insert failed:', dbErr);
    }

    return c.json({
      preview_id: previewId,
      lat, lng,
      footprint_m2: footprintM2,
      pitch_deg: Math.round(pitchDeg * 10) / 10,
      segment_count: segmentCount,
      satellite_tile_url: satelliteTileUrl,
      estimated_area_sqft: estimatedAreaSqft
    });

  } catch (err: any) {
    console.error('preview error:', err);
    return c.json({ error: 'preview_failed', message: 'Could not generate preview. Please try again.' }, 500);
  }
});
