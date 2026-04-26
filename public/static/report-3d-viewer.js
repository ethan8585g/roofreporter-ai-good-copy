// ============================================================
// Report 3D Viewer (Phase 2)
//
// Mounts an interactive Three.js scene over each per-structure
// diagram in the HTML report. The SVG underneath stays as the
// print fallback — CSS hides the canvas in print.
//
// Reads window.__roofReport3D = { structures: [{ index, label,
// eaves: [{lat,lng}], pitch_deg, dominant_pitch_label, true_area_sqft }] }
// (injected by report-html.ts when the report renders).
// ============================================================
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var data = window.__roofReport3D;
  if (!data || !Array.isArray(data.structures) || data.structures.length === 0) return;

  // Find every viewer mount in the document.
  var mounts = Array.prototype.slice.call(document.querySelectorAll('[data-roof3d-mount]'));
  if (!mounts.length) return;

  // Skip entirely in print contexts (print stylesheet hides the mount, but
  // double-check via media query so we don't waste cycles).
  if (window.matchMedia && window.matchMedia('print').matches) return;

  // Lazy-load Three.js + OrbitControls from the same CDN already used by
  // the dashboard visualizer.
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  var ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js';

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load fail: ' + url)); };
      document.head.appendChild(s);
    });
  }

  loadScript(THREE_URL)
    .then(function () { return loadScript(ORBIT_URL); })
    .then(function () {
      mounts.forEach(function (mount) {
        var idx = parseInt(mount.getAttribute('data-roof3d-mount'), 10);
        var struct = data.structures.find(function (s) { return s.index === idx; });
        if (!struct) return;
        try { mountViewer(mount, struct); }
        catch (err) { console.warn('[report-3d] viewer init failed', err); }
      });
    })
    .catch(function (err) {
      console.warn('[report-3d] Three.js failed to load; SVG fallback remains', err);
    });

  function mountViewer(mount, struct) {
    var THREE = window.THREE;
    if (!THREE || !THREE.OrbitControls) return;

    // Hide the SVG once the canvas takes over (still visible in print).
    var svgEl = mount.querySelector('svg');
    if (svgEl) svgEl.style.display = 'none';

    var width = mount.clientWidth || 560;
    var height = mount.clientHeight || 320;
    if (height < 200) height = 320;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF8FAFC);

    var camera = new THREE.PerspectiveCamera(35, width / height, 0.5, 2000);
    var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;border-radius:4px';

    // Lights
    var hemi = new THREE.HemisphereLight(0xfafafa, 0xcbd5e1, 0.55);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(-30, 60, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    // Ground
    var groundGeo = new THREE.PlaneGeometry(400, 400);
    var groundMat = new THREE.MeshStandardMaterial({ color: 0xE5E7EB, roughness: 0.95 });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Build mesh from eaves polygon + pitch.
    var eavesXY = projectEavesToMeters(struct.eaves);
    var pitchRise = 12 * Math.tan((struct.dominant_pitch_deg || 20) * Math.PI / 180);
    var roofGroup = buildHipRoofGroup(THREE, eavesXY, pitchRise);
    scene.add(roofGroup);

    // Frame the camera around the building footprint.
    var bbox = new THREE.Box3().setFromObject(roofGroup);
    var size = bbox.getSize(new THREE.Vector3());
    var center = bbox.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.z);
    camera.position.set(center.x + maxDim * 1.4, maxDim * 1.1, center.z + maxDim * 1.4);
    camera.lookAt(center);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = maxDim * 0.6;
    controls.maxDistance = maxDim * 4;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.update();

    // Top-right overlay label
    var label = document.createElement('div');
    label.textContent = 'Drag to rotate • Scroll to zoom';
    label.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:9px;color:#64748B;background:rgba(255,255,255,0.85);padding:2px 8px;border-radius:8px;pointer-events:none;font-family:Inter,sans-serif';
    if (mount.style.position !== 'absolute' && mount.style.position !== 'relative') {
      mount.style.position = 'relative';
    }
    mount.appendChild(label);

    // Render loop
    var stopped = false;
    function tick() {
      if (stopped) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();

    // Stash the renderer/scene/camera on the mount so Phase 3 can snapshot
    // it at print time without rebuilding the world.
    mount.__roof3d = { renderer: renderer, scene: scene, camera: camera, structure: struct };

    // Resize on container resize.
    var ro = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var w = entries[i].contentRect.width;
        var h = entries[i].contentRect.height || 320;
        if (w < 50 || h < 50) continue;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(mount);
  }

  // Project lat/lng to local meters around centroid.
  function projectEavesToMeters(eaves) {
    if (!eaves || eaves.length < 3) return [];
    var refLat = eaves.reduce(function (s, p) { return s + p.lat; }, 0) / eaves.length;
    var refLng = eaves.reduce(function (s, p) { return s + p.lng; }, 0) / eaves.length;
    var cosLat = Math.cos(refLat * Math.PI / 180);
    var M_PER_DEG_LAT = 111320;
    return eaves.map(function (p) {
      return {
        x: (p.lng - refLng) * 111320 * cosLat,
        z: (p.lat - refLat) * M_PER_DEG_LAT,
      };
    });
  }

  // Build a Three.js group containing walls + a hip-roof mesh.
  function buildHipRoofGroup(THREE, eavesXY, pitchRise) {
    var group = new THREE.Group();
    if (eavesXY.length < 3) return group;

    // Bounds
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < eavesXY.length; i++) {
      var p = eavesXY[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    var w = maxX - minX, d = maxZ - minZ;
    var shortSide = Math.min(w, d);
    var ridgeHeight = (shortSide / 2) * (pitchRise / 12);
    var wallHeight = Math.max(2.4, shortSide * 0.20); // a sensible visual wall height

    var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    // Walls — extrude the footprint upward to wallHeight.
    var shape = new THREE.Shape();
    shape.moveTo(eavesXY[0].x, eavesXY[0].z);
    for (var j = 1; j < eavesXY.length; j++) shape.lineTo(eavesXY[j].x, eavesXY[j].z);
    shape.lineTo(eavesXY[0].x, eavesXY[0].z);
    var extrudeGeo = new THREE.ExtrudeGeometry(shape, { depth: wallHeight, bevelEnabled: false });
    extrudeGeo.rotateX(-Math.PI / 2);
    extrudeGeo.translate(0, wallHeight, 0);
    var wallMat = new THREE.MeshStandardMaterial({ color: 0xE2E8F0, roughness: 0.9 });
    var walls = new THREE.Mesh(extrudeGeo, wallMat);
    walls.castShadow = true; walls.receiveShadow = true;
    group.add(walls);

    // Roof — build hip mesh: 2 trapezoids + 2 triangles for rectangular
    // footprints; pyramid for non-rectangular.
    var isRect = eavesXY.length === 4;
    var roofMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78, side: THREE.DoubleSide });

    if (isRect) {
      var longestX = w >= d;
      var ridgeA = new THREE.Vector3(
        longestX ? cx - (w - shortSide) / 2 : cx,
        wallHeight + ridgeHeight,
        longestX ? cz : cz - (d - shortSide) / 2
      );
      var ridgeB = new THREE.Vector3(
        longestX ? cx + (w - shortSide) / 2 : cx,
        wallHeight + ridgeHeight,
        longestX ? cz : cz + (d - shortSide) / 2
      );
      // Lift corners to wall top.
      var corners = eavesXY.map(function (p) { return new THREE.Vector3(p.x, wallHeight, p.z); });
      // Group corners by which ridge endpoint they're closer to.
      var sideA = [], sideB = [];
      corners.forEach(function (c) {
        var dA = c.distanceTo(ridgeA);
        var dB = c.distanceTo(ridgeB);
        if (dA < dB) sideA.push(c); else sideB.push(c);
      });
      if (sideA.length >= 2 && sideB.length >= 2) {
        addQuad(group, roofMat, [sideA[0], sideB[0], ridgeB, ridgeA]);
        addQuad(group, roofMat, [sideB[1], sideA[1], ridgeA, ridgeB]);
        addTri(group, roofMat, [sideA[0], ridgeA, sideA[1]]);
        addTri(group, roofMat, [sideB[0], sideB[1], ridgeB]);
      } else {
        addPyramid(group, roofMat, corners, new THREE.Vector3(cx, wallHeight + ridgeHeight, cz));
      }
    } else {
      var corners2 = eavesXY.map(function (p) { return new THREE.Vector3(p.x, wallHeight, p.z); });
      addPyramid(group, roofMat, corners2, new THREE.Vector3(cx, wallHeight + ridgeHeight, cz));
    }

    function addQuad(grp, mat, verts) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array([
        verts[0].x, verts[0].y, verts[0].z,
        verts[1].x, verts[1].y, verts[1].z,
        verts[2].x, verts[2].y, verts[2].z,
        verts[0].x, verts[0].y, verts[0].z,
        verts[2].x, verts[2].y, verts[2].z,
        verts[3].x, verts[3].y, verts[3].z,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
    }
    function addTri(grp, mat, verts) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array([
        verts[0].x, verts[0].y, verts[0].z,
        verts[1].x, verts[1].y, verts[1].z,
        verts[2].x, verts[2].y, verts[2].z,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
    }
    function addPyramid(grp, mat, base, apex) {
      for (var k = 0; k < base.length; k++) {
        addTri(grp, mat, [base[k], base[(k + 1) % base.length], apex]);
      }
    }

    return group;
  }
})();
