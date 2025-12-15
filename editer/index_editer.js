let scene, camera, renderer, controls, skeletonHelper, clock;
let bones = {}, jointPoints = [], jsonData = [], currentFrame = 0, maxFrame = 0, isPlaying = false;
const frameRate = 30;
let frameAccumulator = 0;
let startRatio = 0, endRatio = 1;
let lastFrameTime = 0;

init();
animate();

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 150, 300);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('threeCanvas') });
  renderer.setSize(window.innerWidth, window.innerHeight);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.update();

  clock = new THREE.Clock();
  const grid = new THREE.GridHelper(500, 50);
  scene.add(grid);
  createMocopiSkeleton();

  const startThumb = document.getElementById('startThumb');
  const endThumb = document.getElementById('endThumb');
  const progressDot = document.getElementById('progressDot');
  const rangeBar = document.getElementById('rangeBar');
  const timeDisplay = document.getElementById('timeDisplay');

  const dragElement = (element, updateRatio) => {
    let isDragging = false;
    element.addEventListener('mousedown', e => {
      isDragging = true;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const rect = rangeBar.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      updateRatio(Math.max(0, Math.min(1, ratio)));
      updateThumbPositions();
    });
    window.addEventListener('mouseup', () => isDragging = false);
  };

  dragElement(startThumb, r => startRatio = Math.min(r, endRatio - 0.01));
  dragElement(endThumb, r => endRatio = Math.max(r, startRatio + 0.01));
  dragElement(progressDot, r => {
    currentFrame = Math.floor(r * maxFrame);
    isPlaying = false;
    updateFrame(currentFrame);
  });

  function updateThumbPositions() {
    startThumb.style.left = `${startRatio * 100}%`;
    endThumb.style.left = `${endRatio * 100}%`;
    progressDot.style.left = `${(currentFrame / maxFrame) * 100}%`;
    timeDisplay.textContent = `${formatTime(currentFrame / frameRate)} / ${formatTime(maxFrame / frameRate)}`;
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.getElementById('jsonUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      jsonData = JSON.parse(ev.target.result);
      maxFrame = jsonData.length;
      currentFrame = 0;
      updateFrame(currentFrame);
    };
    reader.readAsText(file);
  });

  document.getElementById('playBtn').onclick = () => isPlaying = true;
  document.getElementById('pauseBtn').onclick = () => isPlaying = false;
  document.getElementById('backBtn').onclick = () => { currentFrame = Math.max(0, currentFrame - 1); updateFrame(currentFrame); };
  document.getElementById('forwardBtn').onclick = () => { currentFrame = Math.min(maxFrame - 1, currentFrame + 1); updateFrame(currentFrame); };

  document.getElementById('downloadBtn').onclick = () => {
    const startIdx = Math.floor(startRatio * maxFrame);
    const endIdx = Math.ceil(endRatio * maxFrame);
    const cut = jsonData.slice(startIdx, endIdx);
    const filename = document.getElementById('filenameInput').value.trim() || 'edited_motion';
    const blob = new Blob([JSON.stringify(cut, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.json`;
    link.click();
  };

  updateThumbPositions();
}
function createBone(name, parent, pos) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(pos.x, pos.y, pos.z);
  if (parent) parent.add(bone);
  bones[name] = bone;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  scene.add(sphere);
  jointPoints.push({ sphere, bone });

  return bone;
}
function createMocopiSkeleton() {
  const root = createBone('root', null, { x: 0, y: 50, z: 0 });
  let parent = root;
  for (let i = 1; i <= 7; i++) parent = createBone('torso_' + i, parent, { x: 0, y: 10, z: 0 });
  const neck = createBone('neck_1', parent, { x: 0, y: 5, z: 0 });
  createBone('head', createBone('neck_2', neck, { x: 0, y: 5, z: 0 }), { x: 0, y: 10, z: 0 });
  createBone('l_hand', createBone('l_low_arm', createBone('l_up_arm', createBone('l_shoulder', parent, { x: -5, y: 0, z: 0 }), { x: -15, y: 0, z: 0 }), { x: -15, y: 0, z: 0 }), { x: -5, y: 0, z: 0 });
  createBone('r_hand', createBone('r_low_arm', createBone('r_up_arm', createBone('r_shoulder', parent, { x: 5, y: 0, z: 0 }), { x: 15, y: 0, z: 0 }), { x: 15, y: 0, z: 0 }), { x: 5, y: 0, z: 0 });
  createBone('l_toes', createBone('l_foot', createBone('l_low_leg', createBone('l_up_leg', root, { x: -5, y: -10, z: 0 }), { x: 0, y: -25, z: 0 }), { x: 0, y: -15, z: 5 }), { x: 0, y: 0, z: 5 });
  createBone('r_toes', createBone('r_foot', createBone('r_low_leg', createBone('r_up_leg', root, { x: 5, y: -10, z: 0 }), { x: 0, y: -25, z: 0 }), { x: 0, y: -15, z: 5 }), { x: 0, y: 0, z: 5 });

  const group = new THREE.Group();
  group.add(root);
  scene.add(group);
  skeletonHelper = new THREE.SkeletonHelper(group);
  scene.add(skeletonHelper);
}
function updateFrame(frameIdx) {
  if (!jsonData.length) return;
  const frame = jsonData[frameIdx];
  for (let joint in frame) {
    if (joint === 'frame') continue;
    const data = frame[joint];
    const bone = bones[joint];
    if (bone) {
      bone.quaternion.set(data.qx, data.qy, data.qz, data.qw);
      bone.position.set(data.px * 100, data.py * 100, data.pz * 100);
    }
  }
  jointPoints.forEach(({ sphere, bone }) => sphere.position.copy(bone.getWorldPosition(new THREE.Vector3())));
  skeletonHelper.update();
}
function animate(time) {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  frameAccumulator += delta;

  if (isPlaying && jsonData.length > 0) {
    const interval = 1 / frameRate;
    if (frameAccumulator >= interval) {
      frameAccumulator = 0;
      updateFrame(currentFrame);
      const startIdx = Math.floor(startRatio * maxFrame);
      const endIdx = Math.ceil(endRatio * maxFrame);
      currentFrame = (currentFrame + 1);
      if (currentFrame >= endIdx) currentFrame = startIdx;
    }
  } else {
    updateFrame(currentFrame);
  }

  document.getElementById('progressDot').style.left = `${(currentFrame / maxFrame) * 100}%`;
  document.getElementById('timeDisplay').textContent = `${formatTime(currentFrame / frameRate)} / ${formatTime(maxFrame / frameRate)}`;

  controls.update();
  renderer.render(scene, camera);
}