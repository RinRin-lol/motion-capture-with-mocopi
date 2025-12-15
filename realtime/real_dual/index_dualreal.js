// ====== 2アバター対応用のグローバル ====== //
let scene, camera, renderer, controls;

// アバターごとの状態
const avatars = [
  { id: 1, bonesByName: {}, jointPoints: [], skeletonHelper: null },
  { id: 2, bonesByName: {}, jointPoints: [], skeletonHelper: null }
];

// すべての関節スフィアをまとめて更新するため
let allJointPoints = [];

// ローカル小軸（選択ボーン用）
let localAxesHelper = null;
const LOCAL_AXES_SIZE = 12;
function ensureLocalAxesHelper() {
  if (localAxesHelper) return localAxesHelper;
  localAxesHelper = new THREE.AxesHelper(LOCAL_AXES_SIZE);
  localAxesHelper.visible = false;
  scene.add(localAxesHelper);
  return localAxesHelper;
}

// ======録画用====== //
let isRecording = false;
let recordedFrames = [];
let pendingFilename = null;

const toggleRecordBtn = document.getElementById('toggleRecordBtn');
const recordStatus    = document.getElementById('recordStatus');

let saveChoice = document.getElementById('saveChoice');
if (!saveChoice) {
  saveChoice = document.createElement('div');
  saveChoice.id = 'saveChoice';
  saveChoice.style.display = 'none';
  saveChoice.style.position = 'absolute';
  saveChoice.style.top = '150px';
  saveChoice.style.left = '10px';
  saveChoice.style.background = '#111';
  saveChoice.style.padding = '8px';
  saveChoice.style.borderRadius = '6px';
  saveChoice.innerHTML = `
    <div style="color:#ccc; margin-bottom:4px;">どこに保存しますか？</div>
    <div style="display:flex; gap:6px;">
      <button class="pill" data-save="client">クライアント</button>
      <button class="pill" data-save="server">サーバ</button>
      <button class="pill" data-save="both">両方</button>
    </div>
  `;
  document.body.appendChild(saveChoice);
}

toggleRecordBtn.addEventListener('click', () => {
  if (!isRecording) {
    isRecording = true;
    recordedFrames = [];
    pendingFilename = null;
    recordStatus.textContent = '録画: 記録中🔴';
    toggleRecordBtn.textContent = '保存を終了する';
    saveChoice.style.display = 'none';
  } else {
    isRecording = false;
    recordStatus.textContent = '録画: 停止中';
    toggleRecordBtn.textContent = 'データを保存する';

    if (recordedFrames.length === 0) {
      alert('記録されたフレームがありません');
      return;
    }

    const name = prompt('保存するJSONファイル名を入力してください（拡張子なしでもOK）', 'mocopi_record_multi');
    if (!name) return;
    pendingFilename = name;
    saveChoice.style.display = 'flex';
    saveChoice.style.flexDirection = 'column';
    saveChoice.style.gap = '6px';
  }
});

saveChoice.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-save]');
  if (!btn) return;

  if (!pendingFilename) {
    alert('ファイル名が未設定です。もう一度録画しなおしてください。');
    saveChoice.style.display = 'none';
    return;
  }

  const mode = btn.dataset.save; // client / server / both
  const normalized = recordedFrames.map((f, i) => ({ frameIndex: i, ...f }));

  if (mode === 'client' || mode === 'both') {
    saveJsonClientSide(pendingFilename, normalized);
  }
  if (mode === 'server' || mode === 'both') {
    await saveJsonServerSide(pendingFilename, normalized);
  }

  saveChoice.style.display = 'none';
  pendingFilename = null;
});

// ---- クライアント保存 ----
function saveJsonClientSide(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.json') ? filename : filename + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- サーバ保存 ----
async function saveJsonServerSide(filename, data) {
  try {
    const res = await fetch('http://192.168.11.16:8080/save-mocopi', {
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

// ====== Chart.js 関連 ====== //
const chartWrap = document.getElementById('angleChartWrap');
let angleChart = null;
let chartLogging = true;
let frameCounter = 0;

// UI要素
const angleNowTotalEl    = document.getElementById('angleNowTotal');
const angleNowTwistEl    = document.getElementById('angleNowTwist');
const angleNowRelativeEl = document.getElementById('angleNowRelative');
const showChartEl        = document.getElementById('showChart');
const resetChartBtn      = document.getElementById('resetChartBtn');
const stopChartBtn       = document.getElementById('stopChartBtn');
const plotTotalEl        = document.getElementById('plotTotal');
const plotTwistEl        = document.getElementById('plotTwist');
const plotRelativeEl     = document.getElementById('plotRelative');
const wsUrlInput         = document.getElementById('wsUrl');
const wsUrlLabel         = document.getElementById('wsUrlLabel');
const applyWsUrlBtn      = document.getElementById('applyWsUrlBtn');
const reconnectBtn       = document.getElementById('reconnectBtn');
const lockRootPosEl      = document.getElementById('lockRootPos');

const avatar1PortSelect  = document.getElementById('avatar1Port');
const avatar2PortSelect  = document.getElementById('avatar2Port');
const angleTargetAvatarSelect = document.getElementById('angleTargetAvatar');

let ws = null;
let selectedBoneName = 'root';
let angleTargetAvatarIndex = 0; // 0: アバターA, 1: アバターB

const _tmpQuat = new THREE.Quaternion();

// ======Three.js 初期化====== //
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.set(0, 150, 350);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.update();

  scene.add(new THREE.GridHelper(400, 10));
  scene.add(new THREE.AxesHelper(300));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ======スケルトン生成（2体分）====== //
function createBone(avatar, name, parent, pos) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(pos.x, pos.y, pos.z);
  if (parent) parent.add(bone);
  avatar.bonesByName[name] = bone;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  scene.add(sphere);
  avatar.jointPoints.push({ sphere, bone });
  allJointPoints.push({ sphere, bone });

  return bone;
}

function createMocopiSkeletonForAvatar(avatar, xOffset) {
  // root の位置だけ左右にずらしておく
  const root = createBone(avatar, 'root', null, { x:xOffset, y:50, z:0 });
  let p = root;
  for (let i = 1; i <= 7; i++) p = createBone(avatar, 'torso_' + i, p, { x:0, y:10, z:0 });

  const neck_1 = createBone(avatar, 'neck_1', p, { x:0, y:5, z:0 });
  const neck_2 = createBone(avatar, 'neck_2', neck_1, { x:0, y:5, z:0 });
  createBone(avatar, 'head', neck_2, { x:0, y:10, z:0 });

  const l_shoulder = createBone(avatar, 'l_shoulder', p, { x:-5, y:0, z:0 });
  const l_up_arm   = createBone(avatar, 'l_up_arm',   l_shoulder, { x:-15, y:0, z:0 });
  const l_low_arm  = createBone(avatar, 'l_low_arm',  l_up_arm,   { x:-15, y:0, z:0 });
  createBone(avatar, 'l_hand', l_low_arm, { x:-5, y:0, z:0 });

  const r_shoulder = createBone(avatar, 'r_shoulder', p, { x:5, y:0, z:0 });
  const r_up_arm   = createBone(avatar, 'r_up_arm',   r_shoulder, { x:15, y:0, z:0 });
  const r_low_arm  = createBone(avatar, 'r_low_arm',  r_up_arm,   { x:15, y:0, z:0 });
  createBone(avatar, 'r_hand', r_low_arm, { x:5, y:0, z:0 });

  const l_up_leg  = createBone(avatar, 'l_up_leg',  root, { x:-5, y:-10, z:0 });
  const l_low_leg = createBone(avatar, 'l_low_leg', l_up_leg, { x:0, y:-25, z:0 });
  const l_foot    = createBone(avatar, 'l_foot',    l_low_leg, { x:0, y:-15, z:5 });
  createBone(avatar, 'l_toes', l_foot, { x:0, y:0, z:5 });

  const r_up_leg  = createBone(avatar, 'r_up_leg',  root, { x:5, y:-10, z:0 });
  const r_low_leg = createBone(avatar, 'r_low_leg', r_up_leg, { x:0, y:-25, z:0 });
  const r_foot    = createBone(avatar, 'r_foot',    r_low_leg, { x:0, y:-15, z:5 });
  createBone(avatar, 'r_toes', r_foot, { x:0, y:0, z:5 });

  const g = new THREE.Group();
  g.add(root);
  scene.add(g);

  avatar.skeletonHelper = new THREE.SkeletonHelper(g);
  scene.add(avatar.skeletonHelper);
}

// 全ボーン名をセレクトボックスに投入
function fillBoneSelectFromAvatar(avatar) {
  const sel = document.getElementById('boneSelect');
  sel.innerHTML = '';
  Object.keys(avatar.bonesByName).forEach(n => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = n;
    sel.appendChild(opt);
  });
  sel.value = 'root';
  selectedBoneName = 'root';
}

// ======Chart 初期化====== //
function initChart() {
  const ctx = document.getElementById('angleChart').getContext('2d');
  angleChart = new Chart(ctx, {
    type:'line',
    data:{
      labels: [],
      datasets: [
        { label:'Total',    data:[], tension:0.08 },
        { label:'Twist',    data:[], tension:0.08 },
        { label:'Relative', data:[], tension:0.08 },
      ]
    },
    options:{
      responsive:false,
      animation:false,
      scales:{
        x:{ title:{ display:true, text:'フレーム(受信順)' } },
        y:{ title:{ display:true, text:'角度(°)' }, min:0, max:360 }
      },
      plugins:{ legend:{ display:true } }
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

  stopChartBtn.addEventListener('click', () => { chartLogging = false; });
}

// ======角度計算ユーティリティ====== //
const TWIST_AXIS_LOCAL = {
  head:      new THREE.Vector3(0, 1, 0),
  neck_1:    new THREE.Vector3(0, 1, 0),
  neck_2:    new THREE.Vector3(0, 1, 0),
  l_shoulder:new THREE.Vector3(1, 0, 0),
  l_up_arm:  new THREE.Vector3(1, 0, 0),
  l_low_arm: new THREE.Vector3(1, 0, 0),
  l_hand:    new THREE.Vector3(1, 0, 0),
  r_shoulder:new THREE.Vector3(1, 0, 0),
  r_up_arm:  new THREE.Vector3(1, 0, 0),
  r_low_arm: new THREE.Vector3(1, 0, 0),
  r_hand:    new THREE.Vector3(1, 0, 0),
  l_up_leg:  new THREE.Vector3(0, 1, 0),
  l_low_leg: new THREE.Vector3(0, 1, 0),
  r_up_leg:  new THREE.Vector3(0, 1, 0),
  r_low_leg: new THREE.Vector3(0, 1, 0),
};

function getRelativeQuat(selBone) {
  if (!selBone || !selBone.parent) return null;
  const qParent = new THREE.Quaternion();
  const qChild  = new THREE.Quaternion();
  selBone.parent.getWorldQuaternion(qParent);
  selBone.getWorldQuaternion(qChild);
  return qParent.invert().multiply(qChild).normalize();
}

function twistAngleDegStrict(selBone) {
  const qRel = getRelativeQuat(selBone);
  if (!qRel) return 0;

  const aLocal = (TWIST_AXIS_LOCAL[selBone.name] || new THREE.Vector3(0,1,0)).clone().normalize();
  const aRot = aLocal.clone().applyQuaternion(qRel);

  const dot = THREE.MathUtils.clamp(aLocal.dot(aRot), -1, 1);
  let axis = new THREE.Vector3().crossVectors(aLocal, aRot);
  let qSwing = new THREE.Quaternion();

  if (axis.lengthSq() < 1e-12 && dot > 0.999999) {
    qSwing.identity();
  } else if (axis.lengthSq() < 1e-12 && dot < -0.999999) {
    const any = new THREE.Vector3(1,0,0);
    if (Math.abs(aLocal.dot(any)) > 0.9) any.set(0,1,0);
    axis = new THREE.Vector3().crossVectors(aLocal, any).normalize();
    qSwing.setFromAxisAngle(axis, Math.PI);
  } else {
    qSwing.setFromAxisAngle(axis.normalize(), Math.acos(dot));
  }

  const qTwist = qSwing.clone().invert().multiply(qRel).normalize();
  const w = THREE.MathUtils.clamp(Math.abs(qTwist.w), -1, 1);
  const theta = 2 * Math.acos(w);
  return THREE.MathUtils.radToDeg(theta);
}

function totalAngleDegFromWorldQuat(qWorld) {
  if (!qWorld) return 0;
  const w = Math.max(-1, Math.min(1, Math.abs(qWorld.w)));
  const theta = 2 * Math.acos(w);
  return THREE.MathUtils.radToDeg(theta);
}

function relativeAngleDeg(selBone) {
  const qRel = getRelativeQuat(selBone);
  if (!qRel) return 0;
  return totalAngleDegFromWorldQuat(qRel);
}

// ======UI バインド====== //
function bindUI() {
  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('menuContent').classList.toggle('show');
  });

  document.getElementById('boneSelect').addEventListener('change', (e) => {
    selectedBoneName = e.target.value;
  });

  document.getElementById('showRedDots').addEventListener('change', e => {
    const visible = e.target.checked;
    allJointPoints.forEach(j => j.sphere.visible = visible);
  });

  document.getElementById('showSkeletonLines').addEventListener('change', e => {
    const visible = e.target.checked;
    avatars.forEach(a => {
      if (a.skeletonHelper) a.skeletonHelper.visible = visible;
    });
  });

  applyWsUrlBtn.addEventListener('click', () => {
    wsUrlLabel.textContent = wsUrlInput.value;
  });

  reconnectBtn.addEventListener('click', () => {
    connectWebSocket(wsUrlInput.value);
  });

  const showLocalAxesEl = document.getElementById('showLocalAxes');
  showLocalAxesEl.addEventListener('change', e => {
    ensureLocalAxesHelper();
    localAxesHelper.visible = e.target.checked;
  });

  angleTargetAvatarSelect.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    angleTargetAvatarIndex = (v === 2) ? 1 : 0;
  });
}

// ======WebSocket====== //
function connectWebSocket(url) {
  try { if (ws) ws.close(); } catch(e) {}
  ws = new WebSocket(url);

  ws.onopen = () => console.log('[WebSocket] connected:', url);
  ws.onclose = () => console.log('[WebSocket] closed');
  ws.onerror = (e) => console.error('[WebSocket] error', e);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);   // { port, frame }
    const port = msg.port;
    const frame = msg.frame;

    // 録画用（どのポートのフレームかも保存）
    if (isRecording) {
      recordedFrames.push({ port, frame });
    }

    // このフレームをどのアバターに適用するか決める
    const portA = Number(avatar1PortSelect.value);
    const portB = Number(avatar2PortSelect.value);

    let targetAvatar = null;
    let avatarIndex = -1;

    if (port === portA) {
      targetAvatar = avatars[0]; // A
      avatarIndex = 0;
    } else if (port === portB) {
      targetAvatar = avatars[1]; // B
      avatarIndex = 1;
    } else {
      // どちらのアバターにも割り当てられていないポート → 無視
      return;
    }

    // 1) ローカル回転・位置を反映
    for (const joint in frame) {
      const data = frame[joint];
      const bone = targetAvatar.bonesByName[joint];
      if (!bone) continue;

      bone.quaternion.set(data.qx, data.qy, data.qz, data.qw).normalize();

      if (joint === 'root' && lockRootPosEl.checked) {
        // A/B それぞれ root の x 位置だけは初期オフセットを保持したいので、
        // 現在の x を保持しつつ y,z を固定する
        const x = bone.position.x;
        bone.position.set(x, 90, 0);
      } else {
        bone.position.set(data.px * 100, data.py * 100, data.pz * 100);
      }
    }

    // 2) ワールド更新
    scene.updateMatrixWorld(true);

    // 3) 角度計測対象のアバターだけ角度を更新
    if (avatarIndex === angleTargetAvatarIndex) {
      const avatar = avatars[avatarIndex];
      const selBone = avatar.bonesByName[selectedBoneName];

      if (selBone) {
        selBone.getWorldQuaternion(_tmpQuat);
        const degTotal    = totalAngleDegFromWorldQuat(_tmpQuat);
        const degTwist    = twistAngleDegStrict(selBone);
        const degRelative = relativeAngleDeg(selBone);

        angleNowTotalEl.textContent    = `${degTotal.toFixed(2)}°`;
        angleNowTwistEl.textContent    = `${degTwist.toFixed(2)}°`;
        angleNowRelativeEl.textContent = `${degRelative.toFixed(2)}°`;

        if (showChartEl.checked && chartLogging) {
          angleChart.data.labels.push(frameCounter++);
          angleChart.data.datasets[0].data.push(plotTotalEl.checked    ? degTotal    : null);
          angleChart.data.datasets[1].data.push(plotTwistEl.checked    ? degTwist    : null);
          angleChart.data.datasets[2].data.push(plotRelativeEl.checked ? degRelative : null);
          angleChart.update();
        }
      } else {
        angleNowTotalEl.textContent = angleNowTwistEl.textContent = angleNowRelativeEl.textContent = '-°';
      }
    }
  };
}

// ======レンダリング====== //
function animate() {
  requestAnimationFrame(animate);

  const tmp = new THREE.Vector3();
  allJointPoints.forEach(j => {
    j.bone.getWorldPosition(tmp);
    j.sphere.position.copy(tmp);
  });

  renderer.render(scene, camera);

  if (localAxesHelper && localAxesHelper.visible) {
    const avatar = avatars[angleTargetAvatarIndex];
    const sel = avatar.bonesByName[selectedBoneName];
    if (sel) {
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      sel.getWorldPosition(wp);
      sel.getWorldQuaternion(wq);
      localAxesHelper.position.copy(wp);
      localAxesHelper.quaternion.copy(wq);
    } else {
      localAxesHelper.visible = false;
    }
  }
}

// ======起動====== //
(function bootstrap(){
  initThree();
  // 左右に少し離して2体生成
  createMocopiSkeletonForAvatar(avatars[0], -40); // A
  createMocopiSkeletonForAvatar(avatars[1],  40); // B

  // ボーン一覧はアバターAから取る（両者同じ構造なので）
  fillBoneSelectFromAvatar(avatars[0]);

  bindUI();
  initChart();
  connectWebSocket(wsUrlInput.value);
  animate();
})();
