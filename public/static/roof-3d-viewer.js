// ============================================================
// 3D Roof Viewer — Three.js Interactive Roof Model
// ============================================================
(function() {
  'use strict';

  var root = document.getElementById('viewer-root');
  if (!root) return;

  var reportData = window.__reportData || {};
  var segments = reportData.segments || [];
  var edges = reportData.edges || [];
  var totalArea = reportData.total_area_sqft || 0;
  var pitch = reportData.pitch || '6/12';
  var address = reportData.address || 'Roof Model';

  // Colors for roof segments
  var SEGMENT_COLORS = [
    0x8B4513, // saddle brown (default shingles)
    0x9B5523,
    0x7B3503,
    0x6B2503,
    0xA86032,
    0x8B5513,
    0x7B4503,
    0x9B6533,
  ];

  var currentRoofColor = 0x8B4513;

  // Material presets
  var MATERIALS = {
    'Asphalt Shingles': { color: 0x4a4a4a, roughness: 0.9 },
    'Charcoal Shingles': { color: 0x333333, roughness: 0.85 },
    'Brown Shingles': { color: 0x8B4513, roughness: 0.9 },
    'Red Metal': { color: 0xB22222, roughness: 0.3 },
    'Blue Metal': { color: 0x2E5090, roughness: 0.3 },
    'Green Metal': { color: 0x2E8B57, roughness: 0.3 },
    'Black Metal': { color: 0x1a1a1a, roughness: 0.25 },
    'Silver Metal': { color: 0xC0C0C0, roughness: 0.2 },
    'Clay Tile': { color: 0xCC6633, roughness: 0.7 },
    'Slate Gray': { color: 0x708090, roughness: 0.6 },
    'Cedar Shake': { color: 0xA0522D, roughness: 0.95 },
    'White': { color: 0xf5f5f5, roughness: 0.5 },
  };

  // UI
  root.innerHTML =
    '<div style="position:relative;width:100%;height:70vh;min-height:400px;background:#0a0a0a;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">' +
      '<canvas id="roof3dCanvas" style="width:100%;height:100%;display:block"></canvas>' +
      '<div style="position:absolute;top:16px;left:16px;color:white;font-size:14px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,0.5)">' +
        '<div style="font-size:18px;margin-bottom:4px">' + address + '</div>' +
        '<div style="font-size:12px;color:#9ca3af;font-weight:400">' + Math.round(totalArea) + ' sq ft | Pitch: ' + pitch + ' | ' + segments.length + ' segments</div>' +
      '</div>' +
      '<div style="position:absolute;top:16px;right:16px;display:flex;flex-direction:column;gap:6px" id="materialPicker"></div>' +
      '<div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:#6b7280;font-size:11px;text-align:center">Drag to rotate • Scroll to zoom • Right-click to pan</div>' +
    '</div>';

  // Build material picker
  var picker = document.getElementById('materialPicker');
  Object.keys(MATERIALS).forEach(function(name) {
    var m = MATERIALS[name];
    var btn = document.createElement('button');
    btn.style.cssText = 'width:28px;height:28px;border-radius:6px;border:2px solid rgba(255,255,255,0.2);cursor:pointer;transition:all 0.2s;';
    btn.style.background = '#' + m.color.toString(16).padStart(6, '0');
    btn.title = name;
    btn.onclick = function() { changeRoofColor(m.color, m.roughness); };
    btn.onmouseover = function() { btn.style.borderColor = 'white'; btn.style.transform = 'scale(1.2)'; };
    btn.onmouseout = function() { btn.style.borderColor = 'rgba(255,255,255,0.2)'; btn.style.transform = 'scale(1)'; };
    picker.appendChild(btn);
  });

  // Load Three.js
  var script1 = document.createElement('script');
  script1.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  script1.onload = function() {
    var script2 = document.createElement('script');
    script2.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js';
    script2.onload = initScene;
    document.head.appendChild(script2);
  };
  document.head.appendChild(script1);

  var scene, camera, renderer, controls, roofMeshes = [];

  function initScene() {
    var canvas = document.getElementById('roof3dCanvas');
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.015);

    // Camera
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(20, 25, 30);
    camera.lookAt(0, 2, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 10;
    controls.maxDistance = 80;
    controls.target.set(0, 3, 0);

    // Lights
    var ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    var sunLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sunLight.position.set(15, 30, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    scene.add(sunLight);

    var fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // Ground plane
    var groundGeo = new THREE.PlaneGeometry(100, 100);
    var groundMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.95 });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper (subtle)
    var grid = new THREE.GridHelper(100, 50, 0x333333, 0x222222);
    grid.position.y = 0.01;
    scene.add(grid);

    // Build roof from segments
    buildRoof();

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    window.addEventListener('resize', function() {
      var w2 = canvas.clientWidth;
      var h2 = canvas.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
  }

  function buildRoof() {
    // Clear existing roof meshes
    roofMeshes.forEach(function(m) { scene.remove(m); });
    roofMeshes = [];

    // Build house walls (simple box)
    var houseWidth = Math.sqrt(totalArea / 2) * 0.3 || 10;
    var houseDepth = houseWidth * 0.7;
    var wallHeight = 3;

    var wallGeo = new THREE.BoxGeometry(houseWidth, wallHeight, houseDepth);
    var wallMat = new THREE.MeshStandardMaterial({ color: 0xd4c5a9, roughness: 0.8 });
    var walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = wallHeight / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    scene.add(walls);
    roofMeshes.push(walls);

    // Build roof based on available segment data
    if (segments.length > 0) {
      // Use real segment data
      buildSegmentedRoof(houseWidth, houseDepth, wallHeight);
    } else {
      // Fallback: simple gable roof from pitch
      buildSimpleRoof(houseWidth, houseDepth, wallHeight);
    }
  }

  function buildSegmentedRoof(w, d, wallH) {
    var pitchDeg = segments[0] ? (segments[0].pitch_degrees || 25) : 25;
    var pitchRad = pitchDeg * Math.PI / 180;
    var ridgeHeight = wallH + (w / 2) * Math.tan(pitchRad);

    // Create gable roof shape based on dominant pitch
    var overhang = 1.0;
    var hw = w / 2 + overhang;
    var hd = d / 2 + overhang;

    // Front face (left slope)
    var frontGeo = new THREE.BufferGeometry();
    var frontVerts = new Float32Array([
      -hw, wallH, -hd,
       0, ridgeHeight, -hd,
       0, ridgeHeight, hd,
      -hw, wallH, hd,
    ]);
    var frontIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    frontGeo.setAttribute('position', new THREE.BufferAttribute(frontVerts, 3));
    frontGeo.setIndex(new THREE.BufferAttribute(frontIdx, 1));
    frontGeo.computeVertexNormals();

    var roofMat = new THREE.MeshStandardMaterial({
      color: currentRoofColor,
      roughness: 0.85,
      side: THREE.DoubleSide
    });

    var frontMesh = new THREE.Mesh(frontGeo, roofMat.clone());
    frontMesh.castShadow = true;
    frontMesh.receiveShadow = true;
    scene.add(frontMesh);
    roofMeshes.push(frontMesh);

    // Back face (right slope)
    var backGeo = new THREE.BufferGeometry();
    var backVerts = new Float32Array([
      hw, wallH, -hd,
      0, ridgeHeight, -hd,
      0, ridgeHeight, hd,
      hw, wallH, hd,
    ]);
    var backIdx = new Uint16Array([0, 2, 1, 0, 3, 2]);
    backGeo.setAttribute('position', new THREE.BufferAttribute(backVerts, 3));
    backGeo.setIndex(new THREE.BufferAttribute(backIdx, 1));
    backGeo.computeVertexNormals();

    var backMesh = new THREE.Mesh(backGeo, roofMat.clone());
    backMesh.castShadow = true;
    backMesh.receiveShadow = true;
    scene.add(backMesh);
    roofMeshes.push(backMesh);

    // Gable end triangles
    var gableMat = new THREE.MeshStandardMaterial({ color: 0xd4c5a9, roughness: 0.8, side: THREE.DoubleSide });

    // Front gable
    var fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, wallH, -hd, hw, wallH, -hd, 0, ridgeHeight, -hd
    ]), 3));
    fg.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    fg.computeVertexNormals();
    scene.add(new THREE.Mesh(fg, gableMat));
    roofMeshes.push(scene.children[scene.children.length - 1]);

    // Back gable
    var bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, wallH, hd, hw, wallH, hd, 0, ridgeHeight, hd
    ]), 3));
    bg.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 2, 1]), 1));
    bg.computeVertexNormals();
    scene.add(new THREE.Mesh(bg, gableMat));
    roofMeshes.push(scene.children[scene.children.length - 1]);

    // Ridge line (bright green)
    var ridgeGeo = new THREE.BufferGeometry();
    ridgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, ridgeHeight + 0.05, -hd, 0, ridgeHeight + 0.05, hd
    ]), 3));
    var ridgeLine = new THREE.Line(ridgeGeo, new THREE.LineBasicMaterial({ color: 0x00FF88, linewidth: 3 }));
    scene.add(ridgeLine);
    roofMeshes.push(ridgeLine);

    // Eave lines
    var eaveMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 });
    [[-hw, wallH, -hd, -hw, wallH, hd], [hw, wallH, -hd, hw, wallH, hd]].forEach(function(coords) {
      var eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coords), 3));
      scene.add(new THREE.Line(eg, eaveMat));
      roofMeshes.push(scene.children[scene.children.length - 1]);
    });
  }

  function buildSimpleRoof(w, d, wallH) {
    // Same as segmented but with default 6/12 pitch
    buildSegmentedRoof(w, d, wallH);
  }

  function changeRoofColor(color, roughness) {
    currentRoofColor = color;
    roofMeshes.forEach(function(mesh) {
      if (mesh.material && mesh.material.color && mesh.material !== undefined) {
        // Only change roof faces, not walls or lines
        if (mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
          var positions = mesh.geometry.attributes.position;
          // Check if any vertex is above wall height (it's a roof face)
          var isRoof = false;
          for (var i = 0; i < positions.count; i++) {
            if (positions.getY(i) > 4) { isRoof = true; break; }
          }
          if (isRoof && !(mesh instanceof THREE.Line)) {
            mesh.material.color.setHex(color);
            mesh.material.roughness = roughness || 0.85;
            mesh.material.needsUpdate = true;
          }
        }
      }
    });
  }

})();
