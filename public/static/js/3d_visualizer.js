// ============================================================
// 3D ROOF VISUALIZER — Three.js Sales Tool
// Procedural house generation + real-time roof color swapping
// Works entirely client-side with CDN Three.js
// ============================================================

(function() {
  'use strict';

  // ── Color Palette Definitions ──
  const SHINGLE_COLORS = [
    { name: 'Onyx Black',     hex: '#222222',  type: 'shingle', metalness: 0.05, roughness: 0.85 },
    { name: 'Charcoal Gray',  hex: '#36454F',  type: 'shingle', metalness: 0.05, roughness: 0.82 },
    { name: 'Weathered Wood', hex: '#8B8378',  type: 'shingle', metalness: 0.03, roughness: 0.90 },
    { name: 'Estate Gray',    hex: '#7A7A7A',  type: 'shingle', metalness: 0.04, roughness: 0.80 },
    { name: 'Brownwood',      hex: '#5C4033',  type: 'shingle', metalness: 0.03, roughness: 0.88 },
    { name: 'Hunter Green',   hex: '#355E3B',  type: 'shingle', metalness: 0.04, roughness: 0.85 },
    { name: 'Terra Cotta',    hex: '#E2725B',  type: 'shingle', metalness: 0.05, roughness: 0.78 },
    { name: 'Crimson Red',    hex: '#990000',  type: 'shingle', metalness: 0.06, roughness: 0.80 },
    { name: 'Driftwood',      hex: '#B8A088',  type: 'shingle', metalness: 0.03, roughness: 0.88 },
    { name: 'Slate Blue',     hex: '#4A6580',  type: 'shingle', metalness: 0.05, roughness: 0.82 },
    { name: 'Autumn Brown',   hex: '#6B4226',  type: 'shingle', metalness: 0.04, roughness: 0.86 },
    { name: 'Desert Tan',     hex: '#C2A878',  type: 'shingle', metalness: 0.03, roughness: 0.84 },
  ];

  const METAL_COLORS = [
    { name: 'Galvalume Silver', hex: '#C0C0C0', type: 'metal', metalness: 0.85, roughness: 0.25 },
    { name: 'Copper Patina',    hex: '#43B3AE', type: 'metal', metalness: 0.70, roughness: 0.35 },
    { name: 'Bronze',           hex: '#CD7F32', type: 'metal', metalness: 0.75, roughness: 0.30 },
    { name: 'Matte Black',      hex: '#1C1C1C', type: 'metal', metalness: 0.60, roughness: 0.45 },
    { name: 'Classic Blue',     hex: '#0F52BA', type: 'metal', metalness: 0.65, roughness: 0.35 },
    { name: 'Forest Green',     hex: '#228B22', type: 'metal', metalness: 0.65, roughness: 0.35 },
    { name: 'Barn Red',         hex: '#7C0A02', type: 'metal', metalness: 0.60, roughness: 0.40 },
    { name: 'Charcoal Metal',   hex: '#2F3640', type: 'metal', metalness: 0.70, roughness: 0.30 },
  ];

  // ── State ──
  let scene, camera, renderer, controls, animationId;
  let roofMeshes = [];
  let autoRotate = true;
  let currentMode = '3d'; // '3d' or '2d'
  let currentColor = SHINGLE_COLORS[0];
  let reportData = null;

  // ── Initialize ──
  window.initVisualizer = function(data) {
    reportData = data;
    buildSwatchPanel();
    if (currentMode === '3d') {
      init3DScene();
    } else {
      init2DScene();
    }
  };

  // ============================================================
  // 3D SCENE — Procedural house with swappable roof materials
  // ============================================================
  function init3DScene() {
    const container = document.getElementById('canvas-3d');
    if (!container) return;
    cleanup3D();

    // Show loading
    container.innerHTML = '<div class="vis-loader" id="vis-3d-loader"><div class="vis-spinner"></div><p style="color:#94a3b8;font-size:13px;margin-top:12px">Building 3D model...</p></div>';

    const THREE = window.THREE;
    if (!THREE) {
      container.innerHTML = '<div class="vis-loader"><p style="color:#ef4444">Three.js not loaded</p></div>';
      return;
    }

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);

    // Camera
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(12, 8, 14);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Remove loader, add canvas
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // OrbitControls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 2.5, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 6;
    controls.maxDistance = 35;
    controls.update();

    // Lighting
    addLighting(THREE);

    // Ground
    addGround(THREE);

    // Build House
    buildHouse(THREE);

    // Resize handler
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw && nh) {
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
    };
    window.addEventListener('resize', onResize);
    container._resizeHandler = onResize;

    // Animate
    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();
  }

  function cleanup3D() {
    if (animationId) cancelAnimationFrame(animationId);
    if (renderer) renderer.dispose();
    roofMeshes = [];
    const c = document.getElementById('canvas-3d');
    if (c && c._resizeHandler) {
      window.removeEventListener('resize', c._resizeHandler);
    }
  }

  function addLighting(THREE) {
    // Ambient
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    // Sun
    const sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sun.position.set(10, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    // Fill
    const fill = new THREE.DirectionalLight(0x88aacc, 0.3);
    fill.position.set(-5, 8, -3);
    scene.add(fill);
    // Hemisphere
    scene.add(new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.35));
  }

  function addGround(THREE) {
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Driveway
    const driveGeo = new THREE.PlaneGeometry(4, 8);
    const driveMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 });
    const drive = new THREE.Mesh(driveGeo, driveMat);
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(0, 0.01, 7);
    drive.receiveShadow = true;
    scene.add(drive);
  }

  function buildHouse(THREE) {
    roofMeshes = [];

    // ── Main body ──
    const bodyW = 8, bodyH = 4, bodyD = 10;
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.8 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, bodyH / 2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    // ── Garage extension ──
    const garW = 5, garH = 3.5, garD = 6;
    const garGeo = new THREE.BoxGeometry(garW, garH, garD);
    const garMat = new THREE.MeshStandardMaterial({ color: 0xede8dd, roughness: 0.8 });
    const garage = new THREE.Mesh(garGeo, garMat);
    garage.position.set(bodyW / 2 + garW / 2 - 0.5, garH / 2, -2);
    garage.castShadow = true;
    garage.receiveShadow = true;
    scene.add(garage);

    // ── Garage door ──
    const gdGeo = new THREE.PlaneGeometry(3.5, 2.8);
    const gdMat = new THREE.MeshStandardMaterial({ color: 0xd4c8b8, roughness: 0.7 });
    const gd = new THREE.Mesh(gdGeo, gdMat);
    gd.position.set(bodyW / 2 + garW / 2 - 0.5, 1.5, garD / 2 - 2 + 0.01);
    scene.add(gd);

    // ── Front door ──
    const doorGeo = new THREE.PlaneGeometry(1.2, 2.5);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.7 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(-1, 1.3, bodyD / 2 + 0.01);
    scene.add(door);

    // ── Windows ──
    const winGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const winMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.1, metalness: 0.3 });
    [[-3, 2.8, bodyD/2+0.01], [1.5, 2.8, bodyD/2+0.01], [3, 2.8, bodyD/2+0.01],
     [-3, 2.8, -(bodyD/2+0.01)], [0, 2.8, -(bodyD/2+0.01)], [3, 2.8, -(bodyD/2+0.01)]
    ].forEach(([x,y,z]) => {
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(x, y, z);
      if (z < 0) w.rotation.y = Math.PI;
      scene.add(w);
    });

    // ── MAIN ROOF (Gable) ──
    const roofMat = createRoofMaterial(THREE, currentColor);
    const roofPeak = 2.5;
    const roofOverhang = 0.6;

    // Front face
    const roofFrontShape = new THREE.Shape();
    roofFrontShape.moveTo(-(bodyW/2 + roofOverhang), 0);
    roofFrontShape.lineTo(0, roofPeak);
    roofFrontShape.lineTo(bodyW/2 + roofOverhang, 0);
    const roofFrontGeo = new THREE.ExtrudeGeometry(roofFrontShape, {
      depth: bodyD + roofOverhang * 2,
      bevelEnabled: false
    });
    const roofFront = new THREE.Mesh(roofFrontGeo, roofMat);
    roofFront.position.set(0, bodyH, -(bodyD/2 + roofOverhang));
    roofFront.castShadow = true;
    roofFront.receiveShadow = true;
    scene.add(roofFront);
    roofMeshes.push(roofFront);

    // ── GARAGE ROOF (Shed/Lean-to) ──
    const garRoofGeo = new THREE.BoxGeometry(garW + 0.8, 0.15, garD + 1);
    const garRoof = new THREE.Mesh(garRoofGeo, roofMat.clone());
    garRoof.position.set(bodyW/2 + garW/2 - 0.5, garH + 0.5, -2);
    garRoof.rotation.z = -0.18;
    garRoof.castShadow = true;
    scene.add(garRoof);
    roofMeshes.push(garRoof);

    // ── Chimney ──
    const chimGeo = new THREE.BoxGeometry(0.8, 2, 0.8);
    const chimMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
    const chimney = new THREE.Mesh(chimGeo, chimMat);
    chimney.position.set(-2.5, bodyH + roofPeak - 0.3, -1);
    chimney.castShadow = true;
    scene.add(chimney);

    // ── Foundation ──
    const foundGeo = new THREE.BoxGeometry(bodyW + 0.4, 0.4, bodyD + 0.4);
    const foundMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.95 });
    const found = new THREE.Mesh(foundGeo, foundMat);
    found.position.set(0, 0.2, 0);
    scene.add(found);

    // ── Simple trees ──
    addTree(THREE, -8, 0, -4);
    addTree(THREE, -9, 0, 3);
    addTree(THREE, 10, 0, -6);
  }

  function addTree(THREE, x, y, z) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.2, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 })
    );
    trunk.position.set(x, 1, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2d6a2e, roughness: 0.9 })
    );
    foliage.position.set(x, 3.2, z);
    foliage.castShadow = true;
    scene.add(foliage);
  }

  function createRoofMaterial(THREE, colorDef) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorDef.hex),
      roughness: colorDef.roughness,
      metalness: colorDef.metalness,
      flatShading: colorDef.type === 'shingle',
    });
  }

  // ── Change roof color ──
  function changeRoofColor(colorDef) {
    currentColor = colorDef;
    if (currentMode === '3d' && window.THREE) {
      const THREE = window.THREE;
      const newMat = createRoofMaterial(THREE, colorDef);
      roofMeshes.forEach(mesh => {
        if (mesh.material) mesh.material.dispose();
        mesh.material = newMat.clone();
      });
    }
    if (currentMode === '2d') {
      apply2DRoofOverlay(colorDef);
    }
    // Update label
    const label = document.getElementById('vis-current-color');
    if (label) label.textContent = colorDef.name + ' (' + colorDef.type + ')';
  }

  // ============================================================
  // 2D SCENE — Street View + AI Mask Overlay
  // ============================================================
  function init2DScene() {
    const container = document.getElementById('canvas-2d');
    if (!container) return;

    if (!reportData || !reportData.latitude || !reportData.longitude) {
      container.innerHTML = '<div class="vis-loader"><p style="color:#94a3b8;text-align:center;padding:20px"><i class="fas fa-map-marker-alt" style="font-size:32px;opacity:0.3;display:block;margin-bottom:12px"></i>No GPS coordinates available for this report.<br>The 2D Street View overlay requires latitude/longitude.</p></div>';
      return;
    }

    const googleKey = reportData.google_maps_key || '';
    if (!googleKey) {
      container.innerHTML = '<div class="vis-loader"><p style="color:#f59e0b;text-align:center;padding:20px"><i class="fas fa-key" style="font-size:32px;opacity:0.3;display:block;margin-bottom:12px"></i>Google Maps API key not configured.<br>Street View imagery requires a valid API key.</p></div>';
      return;
    }

    const lat = reportData.latitude;
    const lng = reportData.longitude;
    const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&fov=80&pitch=15&source=outdoor&key=${googleKey}`;

    container.innerHTML = '<div class="vis-loader" id="vis-2d-loader"><div class="vis-spinner"></div><p style="color:#94a3b8;font-size:13px;margin-top:12px">Loading Street View...</p></div>';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      container.innerHTML = '';
      const stack = document.createElement('div');
      stack.id = 'streetview-stack';
      stack.appendChild(img);

      // Create overlay canvas for tinting
      const overlay = document.createElement('canvas');
      overlay.id = 'roof-overlay-canvas';
      overlay.width = img.naturalWidth;
      overlay.height = img.naturalHeight;
      stack.appendChild(overlay);

      container.appendChild(stack);
      container.dataset.loaded = '1';

      // Apply current color
      apply2DRoofOverlay(currentColor);
    };
    img.onerror = function() {
      container.innerHTML = '<div class="vis-loader"><p style="color:#ef4444">Street View image unavailable for this address</p></div>';
    };
    img.src = svUrl;
  }

  function apply2DRoofOverlay(colorDef) {
    const overlay = document.getElementById('roof-overlay-canvas');
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    const w = overlay.width;
    const h = overlay.height;

    ctx.clearRect(0, 0, w, h);

    // Draw a semi-transparent color overlay on the upper portion of the image (approximate roof area)
    // In production this would use an AI-generated mask, but for now we use a gradient approximation
    ctx.save();

    // Create a triangular/trapezoidal roof mask (approximate)
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.55);  // lower-left of roof area
    ctx.lineTo(w * 0.50, h * 0.08);  // peak
    ctx.lineTo(w * 0.95, h * 0.55);  // lower-right of roof area
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = colorDef.hex;
    ctx.globalAlpha = colorDef.type === 'metal' ? 0.45 : 0.38;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  // ============================================================
  // UI — Build swatch panel
  // ============================================================
  function buildSwatchPanel() {
    const shingleGrid = document.getElementById('shingle-swatches');
    const metalGrid = document.getElementById('metal-swatches');
    if (!shingleGrid || !metalGrid) return;

    shingleGrid.innerHTML = '';
    metalGrid.innerHTML = '';

    SHINGLE_COLORS.forEach(function(c, i) {
      shingleGrid.appendChild(createSwatchButton(c, i === 0));
    });
    METAL_COLORS.forEach(function(c) {
      metalGrid.appendChild(createSwatchButton(c, false));
    });
  }

  function createSwatchButton(colorDef, isActive) {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn' + (isActive ? ' active' : '');
    btn.title = colorDef.name;
    btn.innerHTML = '<span class="swatch-color" style="background:' + colorDef.hex + '"></span><span class="swatch-label">' + colorDef.name + '</span>';
    btn.onclick = function() {
      document.querySelectorAll('.swatch-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      changeRoofColor(colorDef);
    };
    return btn;
  }

  // ============================================================
  // MODE SWITCHING — 3D / 2D tabs
  // ============================================================
  window.switchVisMode = function(mode) {
    currentMode = mode;
    document.querySelectorAll('.vis-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    var c3d = document.getElementById('canvas-3d');
    var c2d = document.getElementById('canvas-2d');
    if (c3d) c3d.style.display = mode === '3d' ? 'flex' : 'none';
    if (c2d) c2d.style.display = mode === '2d' ? 'flex' : 'none';

    if (mode === '3d') init3DScene();
    if (mode === '2d') init2DScene();
  };

  // ============================================================
  // CONTROLS
  // ============================================================
  window.toggleAutoRotate = function() {
    autoRotate = !autoRotate;
    if (controls) controls.autoRotate = autoRotate;
    var btn = document.getElementById('btn-auto-rotate');
    if (btn) {
      btn.innerHTML = autoRotate
        ? '<i class="fas fa-pause mr-1"></i>Pause'
        : '<i class="fas fa-play mr-1"></i>Rotate';
    }
  };

  window.resetCamera = function() {
    if (camera && controls) {
      camera.position.set(12, 8, 14);
      controls.target.set(0, 2.5, 0);
      controls.update();
    }
  };

  window.takeScreenshot = function() {
    var canvas;
    if (currentMode === '3d' && renderer) {
      canvas = renderer.domElement;
    } else {
      var stack = document.getElementById('streetview-stack');
      if (!stack) return;
      var tempCanvas = document.createElement('canvas');
      var img = stack.querySelector('img');
      if (!img) return;
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      var ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var overlay = document.getElementById('roof-overlay-canvas');
      if (overlay) ctx.drawImage(overlay, 0, 0);
      canvas = tempCanvas;
    }

    // Flash effect
    var container = document.getElementById(currentMode === '3d' ? 'canvas-3d' : 'canvas-2d');
    if (container) {
      var flash = document.createElement('div');
      flash.className = 'screenshot-flash';
      container.appendChild(flash);
      setTimeout(function() { flash.remove(); }, 400);
    }

    // Download
    var link = document.createElement('a');
    link.download = 'roof-visualization-' + (currentColor.name.replace(/\s+/g, '-').toLowerCase()) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  window.shareVisualization = function() {
    if (navigator.share) {
      navigator.share({
        title: 'Roof Color Visualization',
        text: 'Check out how ' + currentColor.name + ' roofing looks! Powered by RoofReporterAI',
        url: window.location.href
      }).catch(function() {});
    } else {
      navigator.clipboard.writeText(window.location.href).then(function() {
        alert('Link copied to clipboard!');
      });
    }
  };

})();
