import { computeFootprintFromLatLng } from './src/services/roof-measurement-engine';

// At lat 53.5: 1 degree lat = ~111,139m, 1 degree lng = 111139 * cos(53.5°) = ~66,183m
// Test: 20m x 15m rectangle = 300 m² ≈ 3229 sqft
const lat0 = 53.5067;
const lng0 = -113.2227;
const dLat = 20 / 111139;   // ~20m
const dLng = 15 / 66183;    // ~15m

const sqft1 = computeFootprintFromLatLng([
  { lat: lat0, lng: lng0 },
  { lat: lat0 + dLat, lng: lng0 },
  { lat: lat0 + dLat, lng: lng0 + dLng },
  { lat: lat0, lng: lng0 + dLng },
]);
const expected1 = 300 * 10.7639;
console.log(`Test 1: 20m x 15m at lat 53.5`);
console.log(`  Expected: ${expected1.toFixed(0)} sqft | Got: ${sqft1.toFixed(0)} sqft | Error: ${((sqft1-expected1)/expected1*100).toFixed(1)}%`);

// Test: typical house 17m x 18m = 306 m² ≈ 3294 sqft 
const dLat2 = 17 / 111139;
const dLng2 = 18 / 66183;
const sqft2 = computeFootprintFromLatLng([
  { lat: lat0, lng: lng0 },
  { lat: lat0 + dLat2, lng: lng0 },
  { lat: lat0 + dLat2, lng: lng0 + dLng2 },
  { lat: lat0, lng: lng0 + dLng2 },
]);
const expected2 = (17*18) * 10.7639;
console.log(`\nTest 2: 17m x 18m (typical house at this address)`);
console.log(`  Expected: ${expected2.toFixed(0)} sqft | Got: ${sqft2.toFixed(0)} sqft | Error: ${((sqft2-expected2)/expected2*100).toFixed(1)}%`);

// User got 3249 sqft from 10 eave pts — let's see what size that implies
console.log(`\nUser's result: 3249 sqft = ${(3249/10.7639).toFixed(0)} m²`);
console.log(`  That's a ${Math.sqrt(3249/10.7639).toFixed(1)}m x ${Math.sqrt(3249/10.7639).toFixed(1)}m equiv square`);

// The real question: is the engine computing the polygon area correctly
// from traced lat/lng points? The shoelace formula and projection should be fine.
// The REAL issue might be that the eave trace polygon doesn't match the roof —
// but the user says it DOES and the number isn't close.
// Let me check if there's a known building size at this address.
