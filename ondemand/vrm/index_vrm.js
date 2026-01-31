import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
let scene, camera, renderer, clock, controls;
let currentVrm = null;
let jsonData = [];
let frameIndex = 0, isPlaying = false, frameRate = 50;
let frameDuration = 1000 / frameRate;
let lastFrameTime = 0;
let vrmLoader = null;
const boneNameMap = {
  root: "hips",
  torso_2: "spine",
  torso_5: "chest",
  neck_1: "neck",
  head: "head",
  l_shoulder: "leftShoulder",
  l_up_arm: "leftUpperArm",
  l_low_arm: "leftLowerArm",
  l_hand: "leftHand",
  r_shoulder: "rightShoulder",
  r_up_arm: "rightUpperArm",
  r_low_arm: "rightLowerArm",
  r_hand: "rightHand",
  l_up_leg: "leftUpperLeg",
  l_low_leg: "leftLowerLeg",
  l_foot: "leftFoot",
  l_toes: "leftToes",
  r_up_leg: "rightUpperLeg",
  r_low_leg: "rightLowerLeg",
  r_foot: "rightFoot",
  r_toes: "rightToes"
};

// 初期化
initThree();
initLoader();
loadDefaultVrm();
setupUI();
animate();
function initThree() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  // 座標系修正チェックに応じてカメラ位置を変える（初期表示用）
  if (document.getElementById("fixcoordinate_system").checked) {
    camera.position.set(0, 2, -10);
  } else {
    camera.position.set(0, 2, 10);
  }
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.update();
  // グリッド＆ライト
  scene.add(new THREE.GridHelper(10, 10));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(1, 1, 1).normalize();
  scene.add(dirLight);
  clock = new THREE.Clock();
}
// GLTFLoader + VRMLoaderPlugin 初期化
function initLoader() {
  vrmLoader = new GLTFLoader();
  vrmLoader.register(parser => new VRMLoaderPlugin(parser));
  vrmLoader.crossOrigin = 'anonymous';
}

// VRM読み込み共通処理
// 既存VRMの破棄
function disposeCurrentVrm() {
  if (currentVrm) {
    scene.remove(currentVrm.scene);
    // メモリ解放（必要であれば）
    if (currentVrm.scene) {
      VRMUtils.deepDispose(currentVrm.scene);
    }
    currentVrm = null;
  }
}
// GLTF → VRMへの変換共通
function setupVrmFromGltf(gltf) {
  const vrm = gltf.userData.vrm;
  // パフォーマンス改善（サンプルコード由来）
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);
  // フラスタムカリング無効化
  vrm.scene.traverse(obj => {
    obj.frustumCulled = false;
  });
  currentVrm = vrm;
  scene.add(vrm.scene);
  console.log('VRM loaded:', vrm);
  // すでにJSONが読み込まれていたら、最初の姿勢を適用
  applyInitialPose();
}
// URL から VRM を読み込む
function loadVrmFromUrl(url) {
  if (!vrmLoader) return;
  console.log('Loading VRM from URL:', url);
  vrmLoader.load(
    url,
    gltf => {
      disposeCurrentVrm();
      setupVrmFromGltf(gltf);
    },
    progress => {
      const ratio = (progress.loaded / (progress.total || 1)) * 100;
      console.log(`Loading model... ${ratio.toFixed(1)}%`);
    },
    error => {
      console.error('Failed to load VRM from URL:', error);
    }
  );
}
// ArrayBuffer（ファイル入力）から VRM を読み込む
function loadVrmFromArrayBuffer(arrayBuffer) {
  if (!vrmLoader) return;
  console.log('Loading VRM from ArrayBuffer');
  vrmLoader.parse(
    arrayBuffer,
    '',
    gltf => {
      disposeCurrentVrm();
      setupVrmFromGltf(gltf);
    },
    error => {
      console.error('Failed to load VRM from ArrayBuffer:', error);
    }
  );
}
function loadDefaultVrm() {
  loadVrmFromUrl('../../assets/test_man.vrm');
}
// UIイベントの設定
function setupUI() {
  // VRMファイル入力
  document.getElementById('vrmInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      loadVrmFromArrayBuffer(arrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  });
  // JSONモーション入力
  document.getElementById('jsonUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      jsonData = JSON.parse(ev.target.result);
      frameIndex = 0;
      document.getElementById('progressBar').max = jsonData.length - 1;
      applyInitialPose(); // VRMが既にあれば最初のフレームを適用
    };
    reader.readAsText(file);
  });
  document.getElementById('playButton').onclick = () => {
    if (jsonData.length > 0 && currentVrm) {
      isPlaying = true;
    }
  };
  document.getElementById('pauseButton').onclick = () => {
    isPlaying = false;
  };
  document.getElementById('progressBar').oninput = e => {
    frameIndex = parseInt(e.target.value);
    updateFrame(frameIndex);
    isPlaying = false;
  };
}
// JSONモーション適用

// 最初のフレーム姿勢を適用
function applyInitialPose() {
  if (!currentVrm || jsonData.length === 0) return;
  const frame = jsonData[0];
  for (const name in frame) {
    const vrmBoneName = boneNameMap[name];
    if (!vrmBoneName) continue;
    const node = currentVrm.humanoid?.getRawBoneNode(vrmBoneName);
    const data = frame[name];
    if (!node || !data) continue;
    // 座標系修正
    if (document.getElementById("fixcoordinate_system").checked) {
      node.quaternion.set(-data.qx, data.qy, -data.qz, data.qw);
    } else {
      node.quaternion.set(data.qx, data.qy, data.qz, data.qw);
    }
    // hips の位置
    if (vrmBoneName === "hips") {
      node.position.set(-data.px * 0.001, data.py * 0.001, -data.pz * 0.001);
    }
  }
}
// 指定フレームを適用
function updateFrame(index) {
  if (!currentVrm || jsonData.length === 0) return;
  const frame = jsonData[index];
  for (const name in frame) {
    const vrmBoneName = boneNameMap[name];
    if (!vrmBoneName) continue;
    const node = currentVrm.humanoid?.getRawBoneNode(vrmBoneName);
    const data = frame[name];
    if (!node || !data) continue;
    // 座標系修正
    if (document.getElementById("fixcoordinate_system").checked) {
      node.quaternion.set(-data.qx, data.qy, -data.qz, data.qw);
    } else {
      node.quaternion.set(data.qx, data.qy, data.qz, data.qw);
    }
    // hips の位置
    if (vrmBoneName === "hips") {
      if (document.getElementById("fixRoot").checked) {
        node.position.set(0, 1.0, 0);
      } else {
        node.position.set(-data.px * 0.001, data.py * 0.001, -data.pz * 0.001);
      }
    }
  }
  document.getElementById("progressBar").value = index;
}

// アニメーションループ

function animate(time) {
  requestAnimationFrame(animate);
  if (isPlaying && jsonData.length > 0 && currentVrm && time - lastFrameTime > frameDuration) {
    updateFrame(frameIndex);
    frameIndex = (frameIndex + 1) % jsonData.length;
    lastFrameTime = time;
  }
  renderer.render(scene, camera);
}
// ウィンドウサイズ変更時
window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});