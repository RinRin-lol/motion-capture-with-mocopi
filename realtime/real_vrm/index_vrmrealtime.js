// index_vrm_realtime.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// three.js 基本
let scene, camera, renderer, controls;

// VRM 関連
let currentVrm = null;
let vrmLoader = null;

// VRM全体の移動用（rootモーション）
let rootInitial = null;                 // mocopiの最初のroot位置
let vrmSceneInitialPos = new THREE.Vector3(); // VRMシーンの初期位置
let hasInitialOffset = false;           // 初期オフセットを設定済みかどうか

// VRM の Humanoid ボーンを名前で参照する辞書（hips, spine, chest, ...）
const vrmBoneNodes = {};
// hips の初期ローカル位置（移動の基準にする）
let hipsInitialPos = null;


// 選択中ボーン（VRMのボーン名）
let selectedVrmBoneName = null;

// Mocopi → VRM ボーン名対応
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

// Twist 軸（ローカル空間）
// キーは VRM の Humanoid ボーン名
const TWIST_AXIS_LOCAL = {
  head:           new THREE.Vector3(0, 1, 0),
  neck:           new THREE.Vector3(0, 1, 0),
  chest:          new THREE.Vector3(0, 1, 0),
  spine:          new THREE.Vector3(0, 1, 0),
  leftUpperArm:   new THREE.Vector3(1, 0, 0),
  leftLowerArm:   new THREE.Vector3(1, 0, 0),
  leftHand:       new THREE.Vector3(1, 0, 0),
  rightUpperArm:  new THREE.Vector3(1, 0, 0),
  rightLowerArm:  new THREE.Vector3(1, 0, 0),
  rightHand:      new THREE.Vector3(1, 0, 0),
  leftUpperLeg:   new THREE.Vector3(0, 1, 0),
  leftLowerLeg:   new THREE.Vector3(0, 1, 0),
  rightUpperLeg:  new THREE.Vector3(0, 1, 0),
  rightLowerLeg:  new THREE.Vector3(0, 1, 0),
};

// ローカル軸表示用
let localAxesHelper = null;
const LOCAL_AXES_SIZE = 12;

// 録画関連
let isRecording = false;
let recordedFrames = [];
let pendingFilename = null;

// WebSocket
let ws = null;

// Chart.js 関連
const chartWrap      = document.getElementById('angleChartWrap');
let angleChart       = null;
let chartLogging     = true;
let frameCounter     = 0;

// UI 要素
const angleNowTotalEl    = document.getElementById('angleNowTotal');
const angleNowTwistEl    = document.getElementById('angleNowTwist');
const angleNowRelativeEl = document.getElementById('angleNowRelative');

const showChartEl   = document.getElementById('showChart');
const resetChartBtn = document.getElementById('resetChartBtn');
const stopChartBtn  = document.getElementById('stopChartBtn');
const plotTotalEl   = document.getElementById('plotTotal');
const plotTwistEl   = document.getElementById('plotTwist');
const plotRelativeEl= document.getElementById('plotRelative');

const wsUrlInput    = document.getElementById('wsUrl');
const wsUrlLabel    = document.getElementById('wsUrlLabel');
const applyWsUrlBtn = document.getElementById('applyWsUrlBtn');
const reconnectBtn  = document.getElementById('reconnectBtn');

const lockRootPosEl = document.getElementById('lockRootPos');
const udpPortInput  = document.getElementById('udpPortInput');
const udpPortBtn    = document.getElementById('udpPortBtn');

const boneSelectEl  = document.getElementById('boneSelect');
const showLocalAxesEl = document.getElementById('showLocalAxes');
const menuBtn       = document.getElementById('menuBtn');
const menuContent   = document.getElementById('menuContent');

const vrmInput      = document.getElementById('vrmInput');
const toggleRecordBtn = document.getElementById('toggleRecordBtn');
const recordStatus    = document.getElementById('recordStatus');
const saveChoice      = document.getElementById('saveChoice');

// 一時的に使う Quaternion
const tmpQuat = new THREE.Quaternion();

function ensureLocalAxesHelper() {
  if (localAxesHelper) return localAxesHelper;
  localAxesHelper = new THREE.AxesHelper(LOCAL_AXES_SIZE);
  localAxesHelper.visible = false;
  scene.add(localAxesHelper);
  return localAxesHelper;
}

// three.js シーン初期化
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  hemi.position.set(0, 5, 0);
  scene.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(10, 10);
  scene.add(grid);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// VRM ローダー初期化
function initVrmLoader() {
  vrmLoader = new GLTFLoader();
  vrmLoader.register(parser => new VRMLoaderPlugin(parser));
  vrmLoader.crossOrigin = 'anonymous';
}

// 既存VRMの破棄
function disposeCurrentVrm() {
  if (currentVrm) {
    scene.remove(currentVrm.scene);
    if (currentVrm.scene) {
      VRMUtils.deepDispose(currentVrm.scene);
    }
    currentVrm = null;
    for (const k in vrmBoneNodes) delete vrmBoneNodes[k];
    boneSelectEl.innerHTML = '';
    selectedVrmBoneName = null;
  }
  rootInitial = null;
  hasInitialOffset = false;
  hipsInitialPos = null;
}

// GLTF から VRM をセットアップ
function setupVrmFromGltf(gltf) {
  const vrm = gltf.userData.vrm;

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);

  vrm.scene.traverse(obj => { obj.frustumCulled = false; });

  currentVrm = vrm;
  scene.add(vrm.scene);

  setupVrmBoneNodes();
  console.log('VRM loaded (realtime):', vrm);
}

// Humanoid からボーン参照を作り、セレクトボックスを埋める
function setupVrmBoneNodes() {
  if (!currentVrm || !currentVrm.humanoid) return;

  boneSelectEl.innerHTML = '';

  // 角度を見たい主なボーン一覧
  const candidateBones = [
    'hips', 'spine', 'chest', 'neck', 'head',
    'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
  ];

  candidateBones.forEach(name => {
    const node = currentVrm.humanoid.getRawBoneNode(name);
    if (!node) return;
    vrmBoneNodes[name] = node;

    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    boneSelectEl.appendChild(opt);
  });

  if (!selectedVrmBoneName && boneSelectEl.options.length > 0) {
    selectedVrmBoneName = boneSelectEl.options[0].value;
    boneSelectEl.value = selectedVrmBoneName;
  }
}

// デフォルト VRM 読み込み（Alice_solid.vrm）
function loadDefaultVrm() {
  if (!vrmLoader) return;
  vrmLoader.load(
    '../../assets/test_man.vrm',
    gltf => {
      disposeCurrentVrm();
      setupVrmFromGltf(gltf);
    },
    progress => {
      const ratio = (progress.loaded / (progress.total || 1)) * 100;
      console.log(`VRM loading... ${ratio.toFixed(1)}%`);
    },
    error => {
      console.error('Failed to load default VRM:', error);
    }
  );
}

// VRMファイルから読み込み
function loadVrmFromArrayBuffer(arrayBuffer) {
  if (!vrmLoader) return;
  vrmLoader.parse(
    arrayBuffer,
    '',
    gltf => {
      disposeCurrentVrm();
      setupVrmFromGltf(gltf);
    },
    error => {
      console.error('Failed to load VRM from file:', error);
    }
  );
}

function applyFrameToVrm(frame) {
  if (!currentVrm || !currentVrm.humanoid) return;

  const rootData = frame.root;

  // ① 初回 root の初期位置を記録
  if (!rootInitial && rootData) {
    rootInitial = new THREE.Vector3(rootData.px, rootData.py, rootData.pz);
    vrmSceneInitialPos.copy(currentVrm.scene.position); // 初期位置（普通は0,0,0）
  }

  // ② VRM全体を root の差分で動かす（歩行）
  if (!lockRootPosEl.checked && rootInitial && rootData) {
    const scale = 0.001;  // 必要なら調整

    const dx = (rootData.px - rootInitial.x) * scale;
    const dz = (rootData.pz - rootInitial.z) * scale;

    currentVrm.scene.position.set(
      vrmSceneInitialPos.x - dx,
      vrmSceneInitialPos.y,
      vrmSceneInitialPos.z - dz
    );
  }

  // ③ hipsを含む各ボーンの回転を適用（位置は変更しない）
  for (const [mocopiName, vrmBoneName] of Object.entries(boneNameMap)) {
    const data = frame[mocopiName];
    if (!data) continue;

    const node =
      vrmBoneNodes[vrmBoneName] || currentVrm.humanoid.getRawBoneNode(vrmBoneName);
    if (!node) continue;

    vrmBoneNodes[vrmBoneName] = node;

    // 回転（座標系反転）
    node.quaternion.set(-data.qx, data.qy, -data.qz, data.qw).normalize();

    // hips の位置は絶対座標を入れてはダメ
    // node.position は触らない（VRM が壊れる）
  }

  // ④ root固定ONの場合はシーンを初期位置に戻す
  if (lockRootPosEl.checked) {
    currentVrm.scene.position.copy(vrmSceneInitialPos);
  }

  currentVrm.scene.updateMatrixWorld(true);
}


// 相対クォータニオン（親→子）
function getRelativeQuat(node) {
  if (!node || !node.parent) return null;
  const qParent = new THREE.Quaternion();
  const qChild  = new THREE.Quaternion();
  node.parent.getWorldQuaternion(qParent);
  node.getWorldQuaternion(qChild);
  return qParent.invert().multiply(qChild).normalize();
}

// Total 角（ワールドクォータニオンから）
function totalAngleDegFromWorldQuat(qWorld) {
  if (!qWorld) return 0;
  const w = THREE.MathUtils.clamp(Math.abs(qWorld.w), -1, 1);
  const theta = 2 * Math.acos(w);
  return THREE.MathUtils.radToDeg(theta);
}

// Relative 角（親相対）
function relativeAngleDeg(node) {
  const qRel = getRelativeQuat(node);
  if (!qRel) return 0;
  return totalAngleDegFromWorldQuat(qRel);
}

// 厳密スイング–ツイスト分解（円弧描画はしない）
function twistAngleDegStrict(node, vrmBoneName) {
  const qRel = getRelativeQuat(node);
  if (!qRel) return 0;

  const axisLocal =
    (TWIST_AXIS_LOCAL[vrmBoneName] || new THREE.Vector3(0, 1, 0)).clone().normalize();

  const aRot = axisLocal.clone().applyQuaternion(qRel);
  const dot = THREE.MathUtils.clamp(axisLocal.dot(aRot), -1, 1);

  let axis = new THREE.Vector3().crossVectors(axisLocal, aRot);
  let qSwing = new THREE.Quaternion();

  if (axis.lengthSq() < 1e-12 && dot > 0.999999) {
    qSwing.identity();
  } else if (axis.lengthSq() < 1e-12 && dot < -0.999999) {
    const any = new THREE.Vector3(1, 0, 0);
    if (Math.abs(axisLocal.dot(any)) > 0.9) any.set(0, 1, 0);
    axis = new THREE.Vector3().crossVectors(axisLocal, any).normalize();
    qSwing.setFromAxisAngle(axis, Math.PI);
  } else {
    qSwing.setFromAxisAngle(axis.normalize(), Math.acos(dot));
  }

  const qTwist = qSwing.clone().invert().multiply(qRel).normalize();
  const w = THREE.MathUtils.clamp(Math.abs(qTwist.w), -1, 1);
  const theta = 2 * Math.acos(w);
  return THREE.MathUtils.radToDeg(theta);
}

// 角度表示とグラフ更新
function updateAnglesAndChart() {
  if (!selectedVrmBoneName) {
    angleNowTotalEl.textContent = '-°';
    angleNowTwistEl.textContent = '-°';
    angleNowRelativeEl.textContent = '-°';
    return;
  }

  const node = vrmBoneNodes[selectedVrmBoneName];
  if (!node) {
    angleNowTotalEl.textContent = '-°';
    angleNowTwistEl.textContent = '-°';
    angleNowRelativeEl.textContent = '-°';
    return;
  }

  const qWorld = new THREE.Quaternion();
  node.getWorldQuaternion(qWorld);

  const degTotal    = totalAngleDegFromWorldQuat(qWorld);
  const degTwist    = twistAngleDegStrict(node, selectedVrmBoneName);
  const degRelative = relativeAngleDeg(node);

  angleNowTotalEl.textContent    = `${degTotal.toFixed(2)}°`;
  angleNowTwistEl.textContent    = `${degTwist.toFixed(2)}°`;
  angleNowRelativeEl.textContent = `${degRelative.toFixed(2)}°`;

  if (showChartEl.checked && chartLogging && angleChart) {
    angleChart.data.labels.push(frameCounter++);
    angleChart.data.datasets[0].data.push(plotTotalEl.checked    ? degTotal    : null);
    angleChart.data.datasets[1].data.push(plotTwistEl.checked    ? degTwist    : null);
    angleChart.data.datasets[2].data.push(plotRelativeEl.checked ? degRelative : null);
    angleChart.update();
  }
}

// Chart.js 初期化
function initChart() {
  const ctx = document.getElementById('angleChart').getContext('2d');
  angleChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Total',    data: [], tension: 0.08 },
        { label: 'Twist',    data: [], tension: 0.08 },
        { label: 'Relative', data: [], tension: 0.08 }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      scales: {
        x: { title: { display: true, text: 'フレーム(受信順)' } },
        y: { title: { display: true, text: '角度(°)' }, min: 0, max: 360 }
      },
      plugins: { legend: { display: true } }
    }
  });

  showChartEl.addEventListener('change', () => {
    chartWrap.style.display = showChartEl.checked ? 'block' : 'none';
  });

  resetChartBtn.addEventListener('click', () => {
    angleChart.data.labels.length = 0;
    angleChart.data.datasets.forEach(d => d.data.length = 0);
    frameCounter = 0;
    chartLogging = true;
    angleChart.update();
  });

  stopChartBtn.addEventListener('click', () => {
    chartLogging = false;
  });
}

// UI イベント登録
function bindUI() {
  menuBtn.addEventListener('click', () => {
    menuContent.classList.toggle('show');
  });

  boneSelectEl.addEventListener('change', (e) => {
    selectedVrmBoneName = e.target.value;
  });

  applyWsUrlBtn.addEventListener('click', () => {
    wsUrlLabel.textContent = wsUrlInput.value;
  });

  reconnectBtn.addEventListener('click', () => {
    connectWebSocket(wsUrlInput.value);
  });

  udpPortBtn.addEventListener('click', async () => {
    const port = udpPortInput.value.trim();
    if (!port) return;
    try {
      const res = await fetch('/set-udp-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: Number(port) })
      });
      const json = await res.json();
      if (json.ok) {
        alert('UDPポートを ' + json.port + ' に変更しました');
      } else {
        alert('変更に失敗しました: ' + json.msg);
      }
    } catch (e) {
      console.error(e);
      alert('サーバに接続できませんでした');
    }
  });

  showLocalAxesEl.addEventListener('change', (e) => {
    ensureLocalAxesHelper();
    localAxesHelper.visible = e.target.checked;
  });

  vrmInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      loadVrmFromArrayBuffer(arrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  });

  // 録画ボタン
  toggleRecordBtn.addEventListener('click', () => {
    if (!isRecording) {
      // 録画開始
      isRecording = true;
      recordedFrames = [];
      pendingFilename = null;
      recordStatus.textContent = '録画: 記録中🔴';
      toggleRecordBtn.textContent = '保存を終了する';
      saveChoice.style.display = 'none';
    } else {
      // 録画停止 → ファイル名入力 → 保存先選択
      isRecording = false;
      recordStatus.textContent = '録画: 停止中';
      toggleRecordBtn.textContent = 'データを保存する';

      if (recordedFrames.length === 0) {
        alert('記録されたフレームがありません');
        return;
      }

      const name = prompt('保存するJSONファイル名を入力してください（拡張子なしでもOK）', 'mocopi_record');
      if (!name) return;
      pendingFilename = name;
      saveChoice.style.display = 'flex';
    }
  });

  // 保存先選択
  saveChoice.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-save]');
    if (!btn) return;

    if (!pendingFilename) {
      alert('ファイル名が未設定です。もう一度録画しなおしてください。');
      saveChoice.style.display = 'none';
      return;
    }

    const mode = btn.dataset.save; // client / server / both
    const normalized = recordedFrames.map((f, i) => ({ frame: i, ...f }));

    if (mode === 'client' || mode === 'both') {
      saveJsonClientSide(pendingFilename, normalized);
    }
    if (mode === 'server' || mode === 'both') {
      await saveJsonServerSide(pendingFilename, normalized);
    }

    saveChoice.style.display = 'none';
    pendingFilename = null;
  });
}

// クライアント側にJSONを保存
function saveJsonClientSide(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.json') ? filename : filename + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// サーバ側にJSONを保存（server.js の /save-mocopi）
async function saveJsonServerSide(filename, data) {
  try {
    const res = await fetch('/save-mocopi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data })
    });
    const json = await res.json();
    if (!json.ok) {
      alert('サーバ保存に失敗しました: ' + json.msg);
    } else {
      alert('サーバに保存しました: ' + json.path);
    }
  } catch (e) {
    console.error(e);
    alert('サーバに保存できませんでした（ネットワークエラー）');
  }
}

// WebSocket 接続
function connectWebSocket(url) {
  try {
    if (ws) ws.close();
  } catch (e) {}

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WebSocket] connected:', url);
    wsUrlLabel.textContent = url;
  };

  ws.onclose = () => {
    console.log('[WebSocket] closed');
  };

  ws.onerror = (e) => {
    console.error('[WebSocket] error', e);
  };

  ws.onmessage = (event) => {
    try {
      const frameForView   = JSON.parse(event.data);
      const frameForRecord = JSON.parse(event.data);

      if (isRecording) {
        recordedFrames.push(frameForRecord);
      }

      applyFrameToVrm(frameForView);
      updateAnglesAndChart();
    } catch (e) {
      console.error('Failed to parse frame:', e);
    }
  };
}

// ローカル軸表示更新
function updateLocalAxes() {
  if (!localAxesHelper || !localAxesHelper.visible) return;
  if (!selectedVrmBoneName) { localAxesHelper.visible = false; return; }

  const node = vrmBoneNodes[selectedVrmBoneName];
  if (!node) { localAxesHelper.visible = false; return; }

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  node.getWorldPosition(pos);
  node.getWorldQuaternion(quat);
  localAxesHelper.position.copy(pos);
  localAxesHelper.quaternion.copy(quat);
}

// アニメーションループ
function animate() {
  requestAnimationFrame(animate);

  updateLocalAxes();
  renderer.render(scene, camera);
}

// 初期化と起動
(function start() {
  initThree();
  initVrmLoader();
  initChart();
  bindUI();
  loadDefaultVrm();
  connectWebSocket(wsUrlInput.value);
  animate();
})();
