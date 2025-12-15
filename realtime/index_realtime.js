// ======グローバル====== //
let scene, camera, renderer, controls;
let skeletonHelper;

// カメラ初期位置
let initialCameraPos = null;
let initialCameraTarget = null;

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

    const name = prompt('保存するJSONファイル名を入力してください（拡張子なしでもOK）', 'mocopi_record');
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

  const mode = btn.dataset.save;
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

function saveJsonClientSide(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.json') ? filename : filename + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

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

// ====== Chart.js ====== //
const chartWrap = document.getElementById('angleChartWrap');
let angleChart = null;
let chartLogging = true;
let frameCounter = 0;

// UI要素
const angleNowTotalEl    = document.getElementById('angleNowTotal');
const angleNowTwistEl    = document.getElementById('angleNowTwist');
const angleNowRelativeEl = document.getElementById('angleNowRelative');
// ★追加：位置表示用
const posNowXEl          = document.getElementById('posNowX');
const posNowYEl          = document.getElementById('posNowY');
const posNowZEl          = document.getElementById('posNowZ');

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

// ポート選択
const udpPortSelect      = document.getElementById('udpPortSelect');
let selectedUdpPort      = Number(udpPortSelect.value);

let ws = null;
let selectedBoneName = 'root';
const _tmpQuat = new THREE.Quaternion();

// ======Three.js 初期化====== //
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.set(0, 150, 300);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.update();

  initialCameraPos    = camera.position.clone();
  initialCameraTarget = controls.target.clone();

  scene.add(new THREE.GridHelper(500, 50));
  scene.add(new THREE.AxesHelper(300));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// カメラを初期状態に戻す
function resetCamera(){
  if (!camera || !controls || !initialCameraPos || !initialCameraTarget) return;
  camera.position.copy(initialCameraPos);
  controls.target.copy(initialCameraTarget);
  controls.update();
}

// ======スケルトン生成====== //
function createMocopiSkeleton() {
  const root = buildMocopiBones();
  const g = new THREE.Group();
  g.add(root);
  scene.add(g);

  // SkeletonHelper
  skeletonHelper = new THREE.SkeletonHelper(g);
  scene.add(skeletonHelper);

  // ボーン選択
  const sel = document.getElementById('boneSelect');
  Object.keys(bonesByName).forEach(n => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = n;
    sel.appendChild(opt);
  });
  sel.value = 'root';
  selectedBoneName = sel.value;
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

// ======UI バインド====== //
function bindUI() {
  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('menuContent').classList.toggle('show');
  });

  document.getElementById('boneSelect').addEventListener('change', (e) => {
    selectedBoneName = e.target.value;
  });

  document.getElementById('showRedDots').addEventListener('change', e => {
    jointPoints.forEach(j => j.sphere.visible = e.target.checked);
  });

  document.getElementById('showSkeletonLines').addEventListener('change', e => {
    if (skeletonHelper) skeletonHelper.visible = e.target.checked;
  });

  applyWsUrlBtn.addEventListener('click', () => {
    wsUrlLabel.textContent = wsUrlInput.value;
  });

  reconnectBtn.addEventListener('click', () => {
    connectWebSocket(wsUrlInput.value);
  });

  udpPortSelect.addEventListener('change', (e) => {
    selectedUdpPort = Number(e.target.value);
  });

  const showLocalAxesEl = document.getElementById('showLocalAxes');
  showLocalAxesEl.addEventListener('change', e => {
    ensureLocalAxesHelper();
    localAxesHelper.visible = e.target.checked;
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

    if (port !== selectedUdpPort) return;

    if (isRecording) {
      recordedFrames.push(frame);
    }

    for (const joint in frame) {
      const data = frame[joint];
      const bone = bonesByName[joint];
      if (!bone) continue;

      bone.quaternion.set(data.qx, data.qy, data.qz, data.qw).normalize();

      if (joint === 'root' && lockRootPosEl.checked) {
        bone.position.set(0, 90, 0);
      } else {
        bone.position.set(data.px * 100, data.py * 100, data.pz * 100);
      }
    }

    scene.updateMatrixWorld(true);
    const selBone = bonesByName[selectedBoneName];
    if (selBone) {
      // 角度
      selBone.getWorldQuaternion(_tmpQuat);
      const degTotal    = totalAngleDegFromWorldQuat(_tmpQuat);
      const degTwist    = twistAngleDegStrict(selBone);
      const degRelative = relativeAngleDeg(selBone);

      angleNowTotalEl.textContent    = `${degTotal.toFixed(2)}°`;
      angleNowTwistEl.textContent    = `${degTwist.toFixed(2)}°`;
      angleNowRelativeEl.textContent = `${degRelative.toFixed(2)}°`;

      // ★ 追加：ワールド座標
      const posWorld = new THREE.Vector3();
      selBone.getWorldPosition(posWorld);
      posNowXEl.textContent = posWorld.x.toFixed(2);
      posNowYEl.textContent = posWorld.y.toFixed(2);
      posNowZEl.textContent = posWorld.z.toFixed(2);

      if (showChartEl.checked && chartLogging) {
        angleChart.data.labels.push(frameCounter++);
        angleChart.data.datasets[0].data.push(plotTotalEl.checked    ? degTotal    : null);
        angleChart.data.datasets[1].data.push(plotTwistEl.checked    ? degTwist    : null);
        angleChart.data.datasets[2].data.push(plotRelativeEl.checked ? degRelative : null);
        angleChart.update();
      }
    } else {
      angleNowTotalEl.textContent =
        angleNowTwistEl.textContent =
        angleNowRelativeEl.textContent = '-°';
      posNowXEl.textContent =
        posNowYEl.textContent =
        posNowZEl.textContent = '-';
    }
  };
}

// ======レンダリング====== //
function animate() {
  requestAnimationFrame(animate);

  updateJointPoints();

  renderer.render(scene, camera);

  if (localAxesHelper && localAxesHelper.visible) {
    const sel = bonesByName[selectedBoneName];
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
  createMocopiSkeleton();
  bindUI();
  initChart();
  connectWebSocket(wsUrlInput.value);
  animate();
  const resetCamBtn = document.getElementById('resetCameraButton');
  if (resetCamBtn){
    resetCamBtn.addEventListener('click', resetCamera);
  }
})();
