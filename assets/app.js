/* Consica Robots - 3D viewers and assembly animations.
   Geometry comes from models.js / components.js, generated from the FreeCAD
   assemblies and the component STEP library (millimetres, Y up, +Z = front). */
(function () {
  'use strict';
  const M = window.CONSICA_MODELS, C = window.CONSICA_COMPONENTS;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- geometry
  const geoCache = new Map();
  function bytes(b64) {
    const s = atob(b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  function geometry(p) {
    if (geoCache.has(p)) return geoCache.get(p);
    const q = new Int16Array(bytes(p.v)), pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = q[i] * p.s;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(p.w === 4 ? new Uint32Array(bytes(p.i)) : new Uint16Array(bytes(p.i)), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    geoCache.set(p, g);
    return g;
  }
  function material(hex, opts) {
    const c = new THREE.Color(hex);
    const light = c.r + c.g + c.b > 2.4;
    return new THREE.MeshStandardMaterial(Object.assign({
      color: c, roughness: light ? 0.62 : 0.45, metalness: 0.0, envMapIntensity: 0.45,
    }, opts || {}));
  }
  const edgeCache = new Map();
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x1b2433, transparent: true, opacity: 0.28 });
  function edges(p) {
    if (!edgeCache.has(p)) edgeCache.set(p, new THREE.EdgesGeometry(geometry(p), 35));
    return edgeCache.get(p);
  }
  function partMesh(p, noEdges) {
    const m = new THREE.Mesh(geometry(p), material(p.c));
    if (!noEdges) { const l = new THREE.LineSegments(edges(p), edgeMat); l.raycast = () => {}; m.add(l); m.userData.edges = l; }
    m.position.set(p.o[0], p.o[1], p.o[2]);
    m.userData.home = m.position.clone();
    m.userData.part = p;
    return m;
  }

  // ---------------------------------------------------------------- viewer
  let envTexture = null;
  class Viewer {
    constructor(el, opt) {
      opt = opt || {};
      this.el = el;
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      el.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      if (!envTexture) {
        const pm = new THREE.PMREMGenerator(this.renderer);
        envTexture = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
        pm.dispose();
      }
      this.scene.environment = envTexture;
      const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.2, 2, 1.6);
      const rim = new THREE.DirectionalLight(0xdbe6ff, 0.3); rim.position.set(-2, 0.6, -1.5);
      this.scene.add(key, rim);
      this.camera = new THREE.PerspectiveCamera(opt.fov || 30, 1, 1, 20000);
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = false;
      this.controls.enableZoom = opt.zoom !== false;
      this.controls.autoRotate = !reduceMotion && opt.autoRotate !== false;
      this.controls.autoRotateSpeed = opt.autoRotateSpeed || 0.9;
      this.controls.maxPolarAngle = opt.maxPolar || Math.PI * 0.62;
      this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this._resume); });
      this.controls.addEventListener('end', () => {
        if (reduceMotion || opt.autoRotate === false) return;
        this._resume = setTimeout(() => (this.controls.autoRotate = true), 4000);
      });
      this.root = new THREE.Group();
      this.scene.add(this.root);
      this.shadow = contactShadow();
      this.scene.add(this.shadow);
      this.update = null;
      this.visible = false;
      this.clock = new THREE.Clock();
      new ResizeObserver(() => this.resize()).observe(el);
      new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; if (this.visible) this.clock.getDelta(); }, { rootMargin: '100px' }).observe(el);
      this.resize();
      Viewer.all.push(this);
    }
    resize() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    frame(center, radius, dir, fill) {
      // place the camera so a sphere of `radius` around `center` fills the view
      const fov = this.camera.fov * DEG;
      const fit = Math.max(1, 1 / Math.max(this.camera.aspect, 0.01));
      const dist = (radius / Math.sin(fov / 2)) * (fill || 1.05) * Math.max(1, fit * 0.85);
      this.controls.target.copy(center);
      this.camera.position.copy(center).add((dir || new THREE.Vector3(0.55, 0.32, 1)).clone().normalize().multiplyScalar(dist));
      this.camera.near = dist / 50; this.camera.far = dist * 10;
      this.camera.updateProjectionMatrix();
      this.controls.minDistance = dist * 0.25;
      this.controls.maxDistance = dist * 2.2;
      this.controls.update();
    }
    distFor(radius, fill) {
      const fov = this.camera.fov * DEG;
      const fit = Math.max(1, 1 / Math.max(this.camera.aspect, 0.01));
      return (radius / Math.sin(fov / 2)) * (fill || 1.05) * Math.max(1, fit * 0.85);
    }
    zoomTo(radius) {
      // keep the viewing direction, change only the distance
      const off = this.camera.position.clone().sub(this.controls.target);
      off.setLength(this.distFor(radius, 1));
      this.camera.position.copy(this.controls.target).add(off);
    }
    setFloor(y, size) {
      this.shadow.position.y = y + 0.2;
      this.shadow.scale.setScalar(size);
    }
    tick() {
      if (!this.visible) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.update) this.update(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  }
  Viewer.all = [];
  function loop() { Viewer.all.forEach((v) => v.tick()); requestAnimationFrame(loop); }

  function contactShadow() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(16,24,40,0.28)'); grd.addColorStop(0.55, 'rgba(16,24,40,0.10)'); grd.addColorStop(1, 'rgba(16,24,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  // ---------------------------------------------------------------- assembly helper
  // Every part flies in from `offset` during its step. t runs 0 (exploded) .. steps.length (built).
  class Assembly {
    constructor(steps) { this.steps = steps; this.items = []; this.t = steps.length; }
    add(obj, step, offset, delay) {
      this.items.push({ obj, step, offset, delay: delay || 0, home: obj.position.clone() });
    }
    set(t) {
      this.t = t;
      for (const it of this.items) {
        const k = ease(clamp((t - it.step - it.delay) / Math.max(0.35, 1 - it.delay - 0.1), 0, 1));
        it.obj.position.copy(it.home).addScaledVector(it.offset, 1 - k);
      }
    }
    get built() { return this.t >= this.steps.length - 0.001; }
  }

  function setXray(meshes, on) {
    for (const m of meshes) {
      const p = m.userData.part, inside = p.ref;
      if (on && !inside) {
        m.material.transparent = true; m.material.opacity = 0.16; m.material.depthWrite = false;
      } else {
        m.material.transparent = false; m.material.opacity = 1; m.material.depthWrite = true;
      }
      m.material.needsUpdate = true;
      m.renderOrder = on && !inside ? 2 : 0;
      if (m.userData.edges) m.userData.edges.visible = !(on && !inside);
    }
  }

  // ---------------------------------------------------------------- humanoid
  const HUMANOID_STEPS = [
    { title: 'The brain goes in', text: 'The ESP32, PCA9685 servo driver, L298N motor driver, 6 V regulator and the 2 × 18650 battery pack press onto two trays. No screws, just pegs.' },
    { title: 'Close the torso', text: 'The shell and back cover snap over the trays. All wires stay inside, and a window lets students plug in USB without opening anything.' },
    { title: 'Clip on the legs', text: 'The pelvis slides into its socket. Each leg locks on with a square stub and a pull-out fork clip. Walking legs carry hip, knee and ankle servos; wheeled legs end in a TT motor and wheel.' },
    { title: 'Drop in the arms', text: 'Each arm drops into a shoulder socket. Shoulder and elbow servos hide inside the upper arm, and the hands swap: a punching fist and a blocking guard.' },
    { title: 'Head on top', text: 'The neck slides into a dovetail and latches. An SG90 turns the head, and the HC-SR04 ultrasonic sensor makes the eyes.' },
  ];
  const HEAD_TURNS = ['HeadFloor', 'HornKeeper', 'HeadShell', 'FacePlate', 'REF_HCSR04', 'REF_Horn'];

  function rankOf(n) {
    if (n.includes('REF_')) return 0;
    if (/Hub|Fork|Clip|Keeper|Mount|Neck|Tray/.test(n) && !/Thigh|Shin|UpperArm/.test(n)) return 1;
    if (/Lid|Cover|Face/.test(n)) return 3;
    return 2;
  }

  function buildHumanoid(parent, opts) {
    opts = opts || {};
    const group = new THREE.Group(); parent.add(group);
    const meshes = [], byName = {}, steps = new Assembly(HUMANOID_STEPS);
    const horn = M.humanoid.find((p) => p.n === 'Head_REF_Horn');
    const headPivot = new THREE.Group(); headPivot.position.set(horn.o[0], 0, horn.o[2]); group.add(headPivot);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const wheels = [];
    for (const p of M.humanoid) {
      if (opts.variant && p.k !== 'both' && p.k !== opts.variant) continue;
      const m = partMesh(p);
      meshes.push(m); byName[p.k + ':' + p.n] = m;
      const n = p.n, side = n.startsWith('L_') ? 1 : n.startsWith('R_') ? -1 : 0, r = rankOf(n);
      const head = n.startsWith('Head_') && HEAD_TURNS.includes(n.slice(5));
      if (head) { m.position.sub(headPivot.position); m.userData.home = m.position.clone(); headPivot.add(m); } else group.add(m);
      m.userData.variant = p.k;
      if (/L_Wheel|R_Wheel/.test(n)) wheels.push(m);
      if (n.startsWith('Torso_')) {
        if (/BrainTray|ServoTray|REF_/.test(n)) steps.add(m, 0, V(0, n.includes('REF_') ? 70 : 0, -190), n.includes('REF_') ? 0.25 : 0.05 * (n.includes('Servo') ? 1 : 0));
        else steps.add(m, 1, n.includes('BackCover') ? V(0, 0, -210) : V(0, 0, 210), n.includes('BackCover') ? 0.3 : 0);
      } else if (n.startsWith('Head_')) {
        steps.add(m, 4, n.includes('FacePlate') ? V(0, 110, 120) : V(0, 140, -50 * (r === 0 ? 0 : 1)), r * 0.12);
      } else if (p.m === 'arms') {
        steps.add(m, 3, V(side * 150, 90, 0), r * 0.12);
      } else if (n === 'Pelvis') {
        steps.add(m, 2, V(220, 0, 0), 0);
      } else {
        steps.add(m, 2, V(side * 60, -130, 0), 0.25 + r * 0.1);
      }
    }
    return {
      group, meshes, steps, headPivot, wheels,
      setVariant(v) { for (const m of meshes) m.visible = m.userData.variant === 'both' || m.userData.variant === v; },
      idle(time, dt, amount) {
        headPivot.rotation.y = amount * Math.sin(time * 0.7) * 35 * DEG;
        for (const w of wheels) w.rotation.x -= dt * 3 * amount;
      },
    };
  }

  // ---------------------------------------------------------------- bionic arm
  const BIONIC_STEPS = [
    { title: 'Strap on the cuff', text: 'A curved shell sits on the forearm, held with two soft straps.' },
    { title: 'Slide on the servo box', text: 'The box slides along a dovetail rail on the cuff and clicks over a little bump, so it cannot slip off.' },
    { title: 'Servos, spools and brain', text: 'Three SG90 servos sit on pegs, each with a spool that winds a fishing-line tendon. The ESP32 sits in a cradle by a USB window.' },
    { title: 'Snap on the lid', text: 'The lid closes the box and hides the wiring.' },
    { title: 'Fit the palm', text: 'The palm slides down into a dovetail in the front wall. The lid key locks it in place.' },
    { title: 'Add the fingers', text: 'Two fingers and a thumb hinge on 1.75 mm filament pins. An elastic cord opens them, and FSR pads in the fingertips feel the grip.' },
  ];
  // finger hinges (three.js coords, from the FreeCAD placements): [proximal axis, distal axis, curl sign]
  const FINGERS = {
    finger_left: [[50.1, 22.74, -12], [86.352, 39.645, -12], -1],
    finger_right: [[50.1, 22.74, 12], [86.352, 39.645, 12], -1],
    thumb: [[50.1, -16.1, 0], [86.352, -33.005, 0], 1],
  };

  function buildBionic(parent) {
    const group = new THREE.Group(); parent.add(group);
    const meshes = [], steps = new Assembly(BIONIC_STEPS), fingers = [], spools = [];
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const parts = {}; M.bionic.forEach((p) => (parts[p.n] = p));
    for (const p of M.bionic) {
      if (/proximal|distal/.test(p.n)) continue;
      const m = partMesh(p); meshes.push(m); group.add(m);
      const n = p.n;
      if (n === 'cuff') steps.add(m, 0, V(0, -110, 0));
      else if (n === 'servo_box') steps.add(m, 1, V(-230, 0, 0));
      else if (n === 'box_lid') steps.add(m, 3, V(0, 140, 0));
      else if (n === 'palm') steps.add(m, 4, V(0, 150, 0));
      else {
        const order = n.includes('esp32') ? 0 : n.includes('thumb') ? 1 : 2;
        steps.add(m, 2, V(0, n.startsWith('spool') ? 170 : 120, 0), order * 0.12 + (n.startsWith('spool') ? 0.3 : 0));
        if (n.startsWith('spool')) spools.push(m);
      }
    }
    Object.keys(FINGERS).forEach((name, i) => {
      const [a, b, sign] = FINGERS[name];
      const prox = new THREE.Group(), dist = new THREE.Group();
      prox.position.set(a[0], a[1], a[2]); group.add(prox);
      dist.position.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); prox.add(dist);
      const mp = partMesh(parts[name + '_proximal']), md = partMesh(parts[name + '_distal']);
      mp.position.sub(prox.position); md.position.set(md.position.x - b[0], md.position.y - b[1], md.position.z - b[2]);
      prox.add(mp); dist.add(md); meshes.push(mp, md);
      steps.add(prox, 5, V(110, 0, 0), i * 0.12);
      steps.add(dist, 5, V(60, 0, 0), i * 0.12 + 0.15);
      fingers.push({ prox, dist, sign });
    });
    return {
      group, meshes, steps,
      grip(g) {
        for (const f of fingers) { f.prox.rotation.z = f.sign * g * 22 * DEG; f.dist.rotation.z = f.sign * g * 24 * DEG; }
        for (const s of spools) s.rotation.y = g * 1.6 * Math.PI;
      },
    };
  }

  // ---------------------------------------------------------------- assembly UI
  function wireAssembly(section, viewer, model, extra, radii) {
    const steps = model.steps, n = steps.steps.length, total = n;
    const list = section.querySelector('[data-steps]'), scrub = section.querySelector('[data-scrub]'), play = section.querySelector('[data-play]');
    const items = steps.steps.map((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<h3></h3><p></p><span class="bar"></span>';
      li.querySelector('h3').textContent = s.title; li.querySelector('p').textContent = s.text;
      li.addEventListener('click', () => { playing = false; target = i + 1; animTo = true; sync(); });
      list.appendChild(li); return li;
    });
    let t = 0, playing = false, target = null, animTo = false, started = false;
    const speed = 0.55;   // steps per second
    function render() {
      steps.set(t);
      if (radii) viewer.zoomTo(radii[0] + (radii[1] - radii[0]) * easeInOut(clamp(t / n, 0, 1)));
      scrub.value = Math.round((t / total) * 1000);
      const cur = Math.min(Math.floor(t), n - 1);
      items.forEach((li, i) => {
        li.classList.toggle('is-done', t >= i + 1);
        li.classList.toggle('is-active', i === cur && t < n) ;
        li.querySelector('.bar').style.width = (clamp(t - i, 0, 1) * 100) + '%';
      });
      if (t >= n) items[n - 1].classList.add('is-active');
    }
    function sync() { play.classList.toggle('is-playing', playing); play.setAttribute('aria-label', playing ? 'Pause assembly' : 'Play assembly'); }
    play.addEventListener('click', () => {
      if (!playing && t >= n - 0.001) t = 0;
      playing = !playing; target = null; animTo = false; sync();
    });
    scrub.addEventListener('input', () => { playing = false; animTo = false; t = (scrub.value / 1000) * total; sync(); render(); });
    // start the build when the viewer first scrolls into view
    new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !started) { started = true; if (!reduceMotion) { playing = true; t = 0; sync(); } else { t = n; } render(); }
    }, { threshold: 0.35 }).observe(viewer.el);
    render();
    let time = 0;
    viewer.update = (dt) => {
      time += dt;
      if (playing) { t = Math.min(n, t + dt * speed); if (t >= n) { playing = false; sync(); } render(); }
      else if (animTo && target != null) {
        const d = target - t, stepv = Math.sign(d) * Math.min(Math.abs(d), dt * speed * 2.2);
        t += stepv; if (Math.abs(target - t) < 1e-3) { t = target; animTo = false; } render();
      }
      if (extra) extra(time, dt, steps.built);
    };
    return { render };
  }

  // ---------------------------------------------------------------- pages
  function initHero() {
    const el = document.getElementById('hero-viewer');
    const v = new Viewer(el, { autoRotateSpeed: 0.7, zoom: false });
    const h = buildHumanoid(v.root, { variant: 'walk' });
    h.group.position.x = -70;
    const b = buildBionic(v.root);
    b.group.position.set(130, 42, 110);
    b.group.rotation.set(0, -0.85, 0);
    b.group.scale.setScalar(0.95);
    v.setFloor(0, 560);
    v.frame(new THREE.Vector3(10, 175, 0), 255, new THREE.Vector3(0.25, 0.18, 1), 1.0);
    v.update = (dt) => {
      const time = (v._time = (v._time || 0) + dt);
      if (!reduceMotion) {
        h.idle(time, dt, 1);
        const c = (time % 4.2) / 4.2; // close, hold, open, rest
        b.grip(c < 0.3 ? easeInOut(c / 0.3) : c < 0.55 ? 1 : c < 0.85 ? 1 - easeInOut((c - 0.55) / 0.3) : 0);
      }
    };
  }

  function initHumanoid() {
    const section = document.getElementById('humanoid');
    const v = new Viewer(document.getElementById('humanoid-viewer'), { autoRotateSpeed: 0.6 });
    const h = buildHumanoid(v.root);
    h.setVariant('walk');
    v.setFloor(0, 640);
    v.frame(new THREE.Vector3(0, 180, 0), 370, new THREE.Vector3(0.7, 0.3, 1), 0.95);
    wireAssembly(section, v, h, (time, dt, built) => {
      const amt = built && !reduceMotion ? 1 : 0;
      h.idle(time, dt, amt);
      if (!amt) h.headPivot.rotation.y *= 0.9;
    }, [370, 295]);
    section.querySelectorAll('[data-variant]').forEach((btn) => btn.addEventListener('click', () => {
      section.querySelectorAll('[data-variant]').forEach((b) => b.classList.toggle('is-on', b === btn));
      h.setVariant(btn.dataset.variant);
    }));
    const xr = section.querySelector('[data-xray]');
    xr.addEventListener('click', () => { const on = xr.getAttribute('aria-pressed') !== 'true'; xr.setAttribute('aria-pressed', on); setXray(h.meshes, on); });
  }

  function initBionic() {
    const section = document.getElementById('bionic');
    const v = new Viewer(document.getElementById('bionic-viewer'), { autoRotateSpeed: 0.6, maxPolar: Math.PI * 0.75 });
    const b = buildBionic(v.root);
    b.group.position.y = 60;
    v.setFloor(0, 420);
    v.frame(new THREE.Vector3(0, 60, 0), 210, new THREE.Vector3(0.6, 0.55, 1), 1.0);
    let g = 0, gripOn = false;
    const gb = section.querySelector('[data-grip]');
    gb.addEventListener('click', () => { gripOn = !gripOn; gb.setAttribute('aria-pressed', gripOn); });
    wireAssembly(section, v, b, (time, dt, built) => {
      const want = built && (gripOn || (!reduceMotion && Math.sin(time * 1.4) > 0.2)) ? 1 : 0;
      g += (want - g) * Math.min(1, dt * 4);
      b.grip(g);
    }, [215, 150]);
    const xr = section.querySelector('[data-xray]');
    xr.addEventListener('click', () => { const on = xr.getAttribute('aria-pressed') !== 'true'; xr.setAttribute('aria-pressed', on); setXray(b.meshes, on); });
  }

  // ---------------------------------------------------------------- components
  const COMPONENTS = [
    { id: 'esp32-devkitc-v4', name: 'ESP32 DevKitC', tag: 'Brain', short: 'microcontroller',
      text: 'The brain of every kit. A dual-core microcontroller with Wi-Fi and Bluetooth built in. Students program it with Consica\'s drag-and-drop blocks over USB.',
      specs: [['Board', '54.4 × 27.9 mm'], ['Pins', '38 (2 × 19)'], ['Radio', 'Wi-Fi + Bluetooth'], ['Programmed with', 'Consica block editor']], uses: ['Humanoid torso', 'Bionic arm box'] },
    { id: 'servo-sg90', name: 'SG90 micro servo', tag: 'Muscle', short: '11 + 3 per kit',
      text: 'A small motor that turns to an exact angle and holds it. Servos are the joints of the humanoid and pull the tendons of the bionic hand. Metal-gear MG90S servos are a drop-in upgrade for the hips and knees.',
      specs: [['Body', '22.6 × 12.4 × 31 mm'], ['Weight', '9 g'], ['Torque', '1.8 kg·cm'], ['Voltage', '4.8–6 V']], uses: ['Head', 'Arms', 'Walking legs', 'Bionic fingers'] },
    { id: 'pca9685-servo-driver', name: 'PCA9685 servo driver', tag: 'Driver', short: '16 channels',
      text: 'Lets one ESP32 control up to 16 servos using only two wires (I²C). It sits on the servo tray inside the humanoid torso.',
      specs: [['Board', '62.5 × 25.4 mm'], ['Channels', '16 PWM'], ['Bus', 'I²C']], uses: ['Humanoid torso'] },
    { id: 'l298n-module', name: 'L298N motor driver', tag: 'Driver', short: 'dual H-bridge',
      text: 'Drives the two wheel motors forward and backward at any speed. It lives on the brain tray, ready for the wheeled legs.',
      specs: [['Board', '43 × 43 mm'], ['Height', '27 mm (heatsink)'], ['Motors', '2 DC motors']], uses: ['Humanoid torso', 'Wheeled legs'] },
    { id: 'lm2596-buck', name: 'LM2596 regulator', tag: 'Power', short: '6 V servo rail',
      text: 'Turns battery voltage into a steady 6 V supply for the servos, so they do not brown out the ESP32 when they all move at once.',
      specs: [['Board', '43 × 21 mm'], ['Output', 'Adjustable, set to 6 V']], uses: ['Humanoid torso'] },
    { id: 'battery-18650', name: '18650 Li-ion cells', tag: 'Power', short: '2 per robot',
      text: 'Two rechargeable cells in a holder under the brain tray power the whole humanoid.',
      specs: [['Cell', 'Ø18.3 × 65 mm'], ['Pack', '2 cells in series']], uses: ['Humanoid torso'] },
    { id: 'hc-sr04', name: 'HC-SR04 ultrasonic', tag: 'Sensor', short: 'the eyes',
      text: 'Sends out a sound pulse too high to hear and times the echo to measure distance. Its two round transducers are the humanoid\'s eyes.',
      specs: [['Board', '45 × 20 mm'], ['Transducers', '2 × Ø16 mm'], ['Range', 'about 2 cm to 4 m']], uses: ['Humanoid head'] },
    { id: 'tt-gear-motor', name: 'TT gear motor', tag: 'Motor', short: '+ 66 mm wheel',
      text: 'The classic yellow gear motor. In the wheeled legs it drives a 66 mm wheel, turning the humanoid into a rover.',
      specs: [['Body', '70 × 22 × 18 mm'], ['Weight', '31 g'], ['Wheel', '66 mm']], uses: ['Wheeled legs'] },
    { id: 'fsr-402', name: 'FSR 402 force sensor', tag: 'Sensor', short: 'fingertip touch',
      text: 'A thin pad whose resistance drops when it is pressed. One sits in each fingertip of the bionic hand, so the grip knows when to stop squeezing.',
      specs: [['Disc', 'Ø18.3 mm'], ['Active area', 'Ø14.7 mm'], ['Thickness', '0.45 mm']], uses: ['Bionic fingertips'] },
    { id: 'emg', name: 'EMG muscle sensor', tag: 'Sensor', short: 'reads muscles',
      text: 'Electrode pads on the skin pick up the small electrical signal your muscles make when they tighten. The ESP32 turns that signal into "close the hand".',
      specs: [['Input', '3 skin electrodes'], ['Output', 'Analog signal to ESP32']], uses: ['Bionic arm'] },
  ];

  function initComponents() {
    const list = document.querySelector('[data-comp-list]'), info = document.querySelector('[data-comp-info]');
    const el = document.getElementById('comp-viewer');
    const v = new Viewer(el, { autoRotateSpeed: 1.6, maxPolar: Math.PI * 0.8 });
    const empty = document.createElement('div'); empty.className = 'no-model';
    empty.innerHTML = '<div><svg viewBox="0 0 160 160" aria-hidden="true"><path d="M8 80h28l10-30 14 62 14-84 14 70 10-18h54" fill="none" stroke="#0959c8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>3D model coming soon</div>';
    let spin = new THREE.Group(); v.root.add(spin);
    function select(c, btn) {
      list.querySelectorAll('.comp-item').forEach((b) => { b.classList.toggle('is-on', b === btn); b.setAttribute('aria-selected', b === btn); });
      v.root.remove(spin); spin = new THREE.Group(); v.root.add(spin);
      const parts = C[c.id];
      if (empty.parentNode) empty.remove();
      if (parts) {
        parts.forEach((p) => { const m = partMesh(p); spin.add(m); });
        const box = new THREE.Box3().setFromObject(spin), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
        spin.position.sub(ctr); spin.position.y += size.y / 2;
        const r = size.length() / 2;
        v.setFloor(0, r * 3);
        v.frame(new THREE.Vector3(0, size.y / 2, 0), r, new THREE.Vector3(0.9, 0.75, 1), 1.0);
      } else {
        el.appendChild(empty);
      }
      v.shadow.visible = !!parts;
      info.innerHTML = '<span class="tag"></span><h3></h3><p></p><dl></dl><div class="uses"></div>';
      info.querySelector('.tag').textContent = c.tag;
      info.querySelector('h3').textContent = c.name;
      info.querySelector('p').textContent = c.text;
      const dl = info.querySelector('dl');
      c.specs.forEach(([k, val]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = val; dl.append(dt, dd); });
      const uses = info.querySelector('.uses');
      c.uses.forEach((u) => { const s = document.createElement('span'); s.textContent = u; uses.appendChild(s); });
    }
    COMPONENTS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'comp-item'; b.setAttribute('role', 'option');
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = c.name; b.querySelector('small').textContent = c.short;
      b.addEventListener('click', () => select(c, b));
      list.appendChild(b);
      if (i === 0) select(c, b);
    });
  }

  function start() {
    if (!window.THREE || !M || !C) return;
    initHero(); initHumanoid(); initBionic(); initComponents();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
