let scene, camera, renderer, controls;
let currentFrame = 0, maxFrame = 0, frameRate = 30;
let isPlaying = false, lastFrameTime = 0;
const skeletons = [
  { jsonData: [], bonesByName: {}, jointPoints: [], group: null },
  { jsonData: [], bonesByName: {}, jointPoints: [], group: null }
];
init();
createSkeleton(0, 0xff4444, -50);
createSkeleton(1, 0x44ffff, 50);
animate();
function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.set(0, 150, 300);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.update();
  scene.add(new THREE.GridHelper(1000, 100));
  window.addEventListener('resize', onWindowResize);
  document.getElementById('playButton').onclick = () => isPlaying = true;
  document.getElementById('pauseButton').onclick = () => isPlaying = false;
  document.getElementById('progressBar').addEventListener('input', e => {
    currentFrame = parseInt(e.target.value);
    updateFrame(currentFrame);
    isPlaying = false;
  });
  document.getElementById('jsonUpload1').addEventListener('change', e => loadJson(e, 0));
  document.getElementById('jsonUpload2').addEventListener('change', e => loadJson(e, 1));
}
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
function loadJson(e, index) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    skeletons[index].jsonData = JSON.parse(evt.target.result);
    if (index === 0) {
      maxFrame = skeletons[0].jsonData.length;
      currentFrame = 0;
      document.getElementById('progressBar').max = maxFrame - 1;
      document.getElementById('totalTime').textContent = formatTime(maxFrame / frameRate);
    }
  };
  reader.readAsText(file);
}
function createSkeleton(index, color, offsetX) {
  const container = skeletons[index];
  const bonesByName = container.bonesByName;
  const jointPoints = container.jointPoints;
  function createBone(name, parent, pos) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(pos.x, pos.y, pos.z);
    if (parent) parent.add(bone);
    bonesByName[name] = bone;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    scene.add(sphere);
    jointPoints.push({ sphere, bone });
    return bone;
  }
  const root = createBone('root', null, { x: offsetX, y: 50, z: 0 });
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
  group.position.x = offsetX;
  container.group = group;
  scene.add(group);
  scene.add(new THREE.SkeletonHelper(group));
}
function updateFrame(index) {
  skeletons.forEach(skeleton => {
    const frame = skeleton.jsonData[index];
    if (!frame) return;
    for (const joint in frame) {
      if (joint === 'frame') continue;
      const data = frame[joint];
      const bone = skeleton.bonesByName[joint];
      if (bone) {
        bone.quaternion.set(data.qx, data.qy, data.qz, data.qw);
        bone.position.set(data.px * 100, data.py * 100, data.pz * 100);
      }
    }
  });
  document.getElementById('progressBar').value = index;
  document.getElementById('currentTime').textContent = formatTime(index / frameRate);
}
function animate(time) {
  requestAnimationFrame(animate);
  if (skeletons[0].jsonData.length > 0 && isPlaying && time - lastFrameTime > 1000 / frameRate) {
    updateFrame(currentFrame);
    currentFrame = (currentFrame + 1) % maxFrame;
    lastFrameTime = time;
  }
  skeletons.forEach(s => s.jointPoints.forEach(j => j.sphere.position.copy(j.bone.getWorldPosition(new THREE.Vector3()))));
  renderer.render(scene, camera);
}
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}