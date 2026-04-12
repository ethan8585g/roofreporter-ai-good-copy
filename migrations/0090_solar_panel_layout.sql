-- Solar panel layout for the solar designer
-- Stores Google-suggested panel positions plus any user edits as JSON.
-- Schema: { suggested_panels: [...], user_panels: [...] | null,
--           panel_capacity_watts, panel_height_meters, panel_width_meters,
--           image_center: {lat,lng}, image_zoom, image_size_px,
--           yearly_energy_kwh, panel_count, roof_segment_summaries: [...] }
ALTER TABLE reports ADD COLUMN solar_panel_layout TEXT;
