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
      installPrintHook(mounts);
    })
    .catch(function (err) {
      console.warn('[report-3d] Three.js failed to load; SVG fallback remains', err);
    });

  // ─── PHASE 3: print-time PNG snapshot ───
  // When the browser is about to print, render each canvas at higher
  // resolution and inject the PNG into the print DOM so the PDF gets
  // the 3D rendering instead of the axonometric SVG fallback.
  function installPrintHook(mounts) {
    if (window.__roof3dPrintHookInstalled) return;
    window.__roof3dPrintHookInstalled = true;

    function snapshotAll() {
      mounts.forEach(function (mount) {
        var ctx = mount.__roof3d;
        if (!ctx || !ctx.renderer) return;

        try {
          // Rerender at higher resolution for crisp PDF output.
          var origSize = new (window.THREE.Vector2)();
          ctx.renderer.getSize(origSize);
          var origPixelRatio = ctx.renderer.getPixelRatio();
          var printPixelRatio = 4; // ~384 DPI at print scale
          ctx.renderer.setPixelRatio(printPixelRatio);
          ctx.renderer.setSize(origSize.x, origSize.y, false);
          ctx.renderer.render(ctx.scene, ctx.camera);

          var dataUrl = ctx.renderer.domElement.toDataURL('image/png');

          // Restore live render
          ctx.renderer.setPixelRatio(origPixelRatio);
          ctx.renderer.setSize(origSize.x, origSize.y, false);
          ctx.renderer.render(ctx.scene, ctx.camera);

          // Inject print-only image; SVG/canvas already hidden by @media print.
          var existing = mount.querySelector('img.roof3d-print-img');
          if (!existing) {
            existing = document.createElement('img');
            existing.className = 'roof3d-print-img';
            existing.style.cssText = 'display:none;width:100%;height:auto';
            mount.appendChild(existing);
          }
          existing.src = dataUrl;
        } catch (err) {
          console.warn('[report-3d] snapshot failed for structure', err);
        }
      });

      // Inject one-time print stylesheet that prefers the PNG over the SVG.
      if (!document.getElementById('roof3d-print-style')) {
        var style = document.createElement('style');
        style.id = 'roof3d-print-style';
        style.textContent = '@media print { ' +
          '.roof3d-frame canvas { display: none !important; } ' +
          '.roof3d-frame img.roof3d-print-img { display: block !important; } ' +
          '.roof3d-frame:has(img.roof3d-print-img) svg { display: none !important; } ' +
        '}';
        document.head.appendChild(style);
      }
    }

    window.addEventListener('beforeprint', snapshotAll);

    // Safari fallback: matchMedia('print')
    if (window.matchMedia) {
      var mq = window.matchMedia('print');
      var listener = function (e) { if (e.matches) snapshotAll(); };
      if (mq.addEventListener) mq.addEventListener('change', listener);
      else if (mq.addListener) mq.addListener(listener);
    }
  }

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
    // Richer mid-tones + correct gamma. ACES gives a more photographic look
    // than the default Linear/None pair, and SRGBColorSpace ensures the
    // material colours map correctly to display-referred values.
    if (THREE.SRGBColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }
    renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;border-radius:4px;cursor:pointer';

    // Lights
    var hemi = new THREE.HemisphereLight(0xfafafa, 0xcbd5e1, 0.55);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(-30, 60, 40);
    sun.castShadow = true;
    // Higher shadow-map resolution noticeably reduces aliasing at 3-4x print
    // pixel ratio. 4096 is well within WebGL spec floor (2048) on modern
    // hardware; the renderer falls back gracefully if exceeded.
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0005;
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

    // Frame the camera around the building's true bounding sphere so long /
    // skinny roofs (which the old maxDim(x,z) heuristic cropped) and tall
    // ridges (ignored by the old heuristic entirely) both fit cleanly.
    var bbox = new THREE.Box3().setFromObject(roofGroup);
    var sphere = bbox.getBoundingSphere(new THREE.Sphere());
    var center = sphere.center.clone();
    var radius = sphere.radius;
    var fovV = camera.fov * Math.PI / 180;
    var fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    var distance = radius / Math.sin(Math.min(fovV, fovH) / 2) * 1.18; // 18% padding
    var dirVec = new THREE.Vector3(1, 0.85, 1).normalize();
    camera.position.copy(center).addScaledVector(dirVec, distance);
    camera.lookAt(center);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = radius * 1.1;
    controls.maxDistance = distance * 3.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.update();

    // Top-right overlay label
    var label = document.createElement('div');
    label.textContent = 'Drag to rotate • Scroll to zoom • Click a face';
    label.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:9px;color:#64748B;background:rgba(255,255,255,0.85);padding:2px 8px;border-radius:8px;pointer-events:none;font-family:Inter,sans-serif';
    if (mount.style.position !== 'absolute' && mount.style.position !== 'relative') {
      mount.style.position = 'relative';
    }
    mount.appendChild(label);

    // ─── Click-to-inspect: raycaster + measurement panel ───
    var panel = document.createElement('div');
    panel.className = 'roof3d-panel';
    panel.style.cssText = 'position:absolute;top:8px;right:8px;font-size:10px;font-family:Inter,sans-serif;background:rgba(255,255,255,0.94);border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;min-width:148px;max-width:200px;box-shadow:0 2px 6px rgba(15,23,42,0.10);pointer-events:none;line-height:1.45';
    panel.innerHTML = '<div style="font-weight:800;color:#0F766E;letter-spacing:0.5px;text-transform:uppercase;font-size:8.5px;margin-bottom:3px">Selection</div><div style="color:#64748B">Click a roof face for measurements</div>';
    mount.appendChild(panel);

    var raycaster = new THREE.Raycaster();
    var pointerVec = new THREE.Vector2();
    var HIGHLIGHT_HEX = 0xF59E0B;
    var selected = null;

    function clearSelection() {
      if (selected && selected.material && selected.userData) {
        selected.material.color.setHex(selected.userData.original_color);
        selected.material.needsUpdate = true;
      }
      selected = null;
    }

    function showInfo(mesh) {
      var u = mesh.userData;
      panel.innerHTML =
        '<div style="font-weight:800;color:#0F766E;letter-spacing:0.5px;text-transform:uppercase;font-size:8.5px;margin-bottom:3px">' + u.id + '</div>' +
        '<div style="display:grid;grid-template-columns:auto 1fr;gap:1px 8px">' +
          '<span style="color:#64748B">Type</span><span style="font-weight:700;text-align:right">' + u.kind + '</span>' +
          '<span style="color:#64748B">Area</span><span style="font-weight:800;text-align:right;color:#0F172A">' + u.area_sqft.toFixed(1) + ' sqft</span>' +
          '<span style="color:#64748B">Pitch</span><span style="font-weight:700;text-align:right">' + u.pitch_deg.toFixed(1) + '°</span>' +
        '</div>';
    }

    function onPointerDown(ev) {
      // Skip drags — only treat as a click if pointer doesn't move much.
      var startX = ev.clientX, startY = ev.clientY;
      function onUp(uev) {
        renderer.domElement.removeEventListener('pointerup', onUp);
        var dx = uev.clientX - startX, dy = uev.clientY - startY;
        if (Math.hypot(dx, dy) > 4) return; // dragging, not clicking
        var rect = renderer.domElement.getBoundingClientRect();
        pointerVec.x = ((uev.clientX - rect.left) / rect.width) * 2 - 1;
        pointerVec.y = -((uev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerVec, camera);
        var hits = raycaster.intersectObjects(roofGroup.children, true);
        var pickable = null;
        for (var i = 0; i < hits.length; i++) {
          if (hits[i].object && hits[i].object.userData && hits[i].object.userData.roofPickable) {
            pickable = hits[i].object; break;
          }
        }
        clearSelection();
        if (!pickable) {
          panel.innerHTML = '<div style="font-weight:800;color:#0F766E;letter-spacing:0.5px;text-transform:uppercase;font-size:8.5px;margin-bottom:3px">Selection</div><div style="color:#64748B">Click a roof face for measurements</div>';
          return;
        }
        pickable.material.color.setHex(HIGHLIGHT_HEX);
        pickable.material.needsUpdate = true;
        selected = pickable;
        showInfo(pickable);
      }
      renderer.domElement.addEventListener('pointerup', onUp);
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

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

    var faceCounter = 0;
    function nextFaceId(kind) { faceCounter += 1; return 'Face_' + kind + '_' + faceCounter; }
    var M2_PER_M2_FT2 = 10.7639;

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
        addQuad(group, roofMat, [sideA[0], sideB[0], ridgeB, ridgeA], { id: nextFaceId('Slope'), kind: 'Main slope' });
        addQuad(group, roofMat, [sideB[1], sideA[1], ridgeA, ridgeB], { id: nextFaceId('Slope'), kind: 'Main slope' });
        addTri(group, roofMat, [sideA[0], ridgeA, sideA[1]], { id: nextFaceId('Hip'), kind: 'Hip end' });
        addTri(group, roofMat, [sideB[0], sideB[1], ridgeB], { id: nextFaceId('Hip'), kind: 'Hip end' });
      } else {
        addPyramid(group, roofMat, corners, new THREE.Vector3(cx, wallHeight + ridgeHeight, cz));
      }
    } else {
      var corners2 = eavesXY.map(function (p) { return new THREE.Vector3(p.x, wallHeight, p.z); });
      addPyramid(group, roofMat, corners2, new THREE.Vector3(cx, wallHeight + ridgeHeight, cz));
    }

    function attachFaceMeta(mesh, verts, meta) {
      // Compute true area (sloped) for the polygon and the pitch from the
      // face normal vs. world up. These numbers feed the click-to-inspect
      // panel.
      var area = 0;
      for (var t = 1; t < verts.length - 1; t++) {
        var a = verts[0], b = verts[t], c = verts[t + 1];
        var ab = new THREE.Vector3().subVectors(b, a);
        var ac = new THREE.Vector3().subVectors(c, a);
        area += new THREE.Vector3().crossVectors(ab, ac).length() * 0.5;
      }
      var areaSqFt = area * M2_PER_M2_FT2;
      var ab2 = new THREE.Vector3().subVectors(verts[1], verts[0]);
      var ac2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
      var normal = new THREE.Vector3().crossVectors(ab2, ac2).normalize();
      if (normal.y < 0) normal.multiplyScalar(-1);
      var pitchDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
      mesh.userData = {
        roofPickable: true,
        id: meta.id,
        kind: meta.kind,
        area_sqft: areaSqFt,
        pitch_deg: pitchDeg,
        original_color: mesh.material.color.getHex(),
      };
    }

    function addQuad(grp, mat, verts, meta) {
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
      // Each pickable face needs its own material instance so highlighting
      // one doesn't recolor every roof face that shares the shared base mat.
      var mesh = new THREE.Mesh(geo, mat.clone());
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (meta) attachFaceMeta(mesh, verts, meta);
      grp.add(mesh);
    }
    function addTri(grp, mat, verts, meta) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array([
        verts[0].x, verts[0].y, verts[0].z,
        verts[1].x, verts[1].y, verts[1].z,
        verts[2].x, verts[2].y, verts[2].z,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, mat.clone());
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (meta) attachFaceMeta(mesh, verts, meta);
      grp.add(mesh);
    }
    function addPyramid(grp, mat, base, apex) {
      for (var k = 0; k < base.length; k++) {
        addTri(grp, mat, [base[k], base[(k + 1) % base.length], apex], { id: nextFaceId('Slope'), kind: 'Roof slope' });
      }
    }

    return group;
  }
})();
