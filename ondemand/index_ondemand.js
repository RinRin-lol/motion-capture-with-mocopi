// ===== グローバル =====
let scene, camera, renderer, controls;
let skeletonHelper; 
let jsonData = [], currentFrame = 0, maxFrame = 0;
let frameRate = 30, frameDuration = 1000 / frameRate, lastFrameTime = 0;
let isPlaying = false;
let initialCameraPos = null;
let initialCameraTarget = null;

// ファイル名表示
const fileNameLabel = document.getElementById('fileNameLabel');

// 角度UI
const angleNowTotalEl    = document.getElementById('angleNowTotal');
const angleNowTwistEl    = document.getElementById('angleNowTwist');
const angleNowRelativeEl = document.getElementById('angleNowRelative');

// ワールド座標表示 UI
const posXEl = document.getElementById('posX');
const posYEl = document.getElementById('posY');
const posZEl = document.getElementById('posZ');

// ボーンメッシュ ON/OFF UI
const boneMeshToggleEl   = document.getElementById('toggleBoneMesh');

// グラフ
const chartWrap    = document.getElementById('angleChartWrap');
const toggleField  = document.getElementById('toggleChartField');
const resetChartBtn= document.getElementById('resetChartBtn');
const stopChartBtn = document.getElementById('stopChartBtn');
const plotTotalEl  = document.getElementById('plotTotal');
const plotTwistEl  = document.getElementById('plotTwist');
const plotRelEl    = document.getElementById('plotRelative');
let angleChart = null, chartLogging = true, frameCounter = 0;

// 円弧矢印 UI
const arcModeSel = document.getElementById('arcMode');
const arcVisibleEl = document.getElementById('arcVisible');

// 選択ボーン
let selectedBoneName = 'root';

// 一時クォータニオン等
const _tmpQWorld = new THREE.Quaternion();

// ★ 追加：ワールド位置用
const _tmpPosWorld = new THREE.Vector3();

// ===== Three.js 初期化 =====
function initThree(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 1, 1000);
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

function resetCamera(){
  if (!camera || !controls || !initialCameraPos || !initialCameraTarget) return;
  camera.position.copy(initialCameraPos);
  controls.target.copy(initialCameraTarget);
  controls.update();
}

function createMocopiSkeleton() {
  const root = buildMocopiBones();

  const group = new THREE.Group();
  group.add(root);
  scene.add(group);

  skeletonHelper = new THREE.SkeletonHelper(group);
  scene.add(skeletonHelper);

  // ボーン選択 UI
  const sel = document.getElementById('boneSelect');
  Object.keys(bonesByName).forEach(n => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = n;
    sel.appendChild(opt);
  });
  sel.value = 'root';
  selectedBoneName = sel.value;

  sel.addEventListener('change', e => {
    selectedBoneName = e.target.value;
    refreshArcVisibility();
  });

  // 円弧矢印のベースを全ボーンに作成
  createAllArcIndicators();
  refreshArcVisibility();
}


// ===== Chart.js 初期化 =====
function initChart(){
  const ctx = document.getElementById('angleChart').getContext('2d');
  angleChart = new Chart(ctx, {
    type:'line',
    data:{ labels:[], datasets:[
      { label:'Total',    data:[], tension:0.08 },
      { label:'Twist',    data:[], tension:0.08 },
      { label:'Relative', data:[], tension:0.08 },
    ]},
    options:{
      responsive:false,
      animation:false,
      scales:{ x:{ title:{ display:true, text:'フレーム' } }, y:{ title:{ display:true, text:'角度(°)' }, min:0, max:360 } },
      plugins:{ legend:{ display:true } }
    }
  });

  toggleField.addEventListener('change', () => {
    chartWrap.style.display = toggleField.checked ? 'block' : 'none';
  });
  resetChartBtn.addEventListener('click', () => {
    angleChart.data.labels.length = 0;
    angleChart.data.datasets.forEach(d => d.data.length = 0);
    frameCounter = 0; chartLogging = true; angleChart.update();
  });
  stopChartBtn.addEventListener('click', () => { chartLogging = false; });
}

// ===== JSON 読み込み & 再生 =====
const progressBar   = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl   = document.getElementById('totalTime');

function onJsonUpload(e){
  const file = e.target.files[0]; if (!file) return;
  if (fileNameLabel){
    fileNameLabel.textContent = `選択されたファイル：${file.name}`;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    jsonData = JSON.parse(ev.target.result);
    maxFrame = jsonData.length; currentFrame = 0;
    progressBar.max = Math.max(0, maxFrame-1);
    totalTimeEl.textContent = formatTime(maxFrame / frameRate);
    // グラフ初期化
    angleChart.data.labels.length = 0; angleChart.data.datasets.forEach(d=>d.data.length=0); angleChart.update();
    chartLogging = true; frameCounter = 0;
  };
  reader.readAsText(file);
}

function updateFrame(index){
  if (!jsonData.length) return;
  const f = jsonData[index];
  for (const key in f){
    if (key === 'frame') continue;
    const d = f[key], b = bonesByName[key];
    if (!b) continue;
    b.quaternion.set(d.qx, d.qy, d.qz, d.qw).normalize();
    if (key === 'root' && document.getElementById('fixRoot').checked) b.position.set(0,90,0);
    else b.position.set(d.px * 100, d.py * 100, d.pz * 100); // 既存仕様踏襲
  }

  // 角度算出 & 表示
  scene.updateMatrixWorld(true);
  const sel = bonesByName[selectedBoneName];
  if (sel){
    sel.getWorldQuaternion(_tmpQWorld);
    sel.getWorldPosition(_tmpPosWorld);
    posXEl.textContent = _tmpPosWorld.x.toFixed(1);
    posYEl.textContent = _tmpPosWorld.y.toFixed(1);
    posZEl.textContent = _tmpPosWorld.z.toFixed(1);
    const degTotal    = totalAngleDegFromWorldQuat(_tmpQWorld);
    const degTwist    = twistAngleDegStrict(sel);
    const degRelative = relativeAngleDeg(sel);

    angleNowTotalEl.textContent    = `${degTotal.toFixed(2)}°`;
    angleNowTwistEl.textContent    = `${degTwist.toFixed(2)}°`;
    angleNowRelativeEl.textContent = `${degRelative.toFixed(2)}°`;

    if (toggleField.checked && chartLogging){
      angleChart.data.labels.push(frameCounter++);
      angleChart.data.datasets[0].data.push(plotTotalEl.checked  ? degTotal    : null);
      angleChart.data.datasets[1].data.push(plotTwistEl.checked  ? degTwist    : null);
      angleChart.data.datasets[2].data.push(plotRelEl.checked    ? degRelative : null);
      angleChart.update();
    }

    // ===== 円弧矢印の更新（選択ボーンのみ） =====
    if (arcVisibleEl.checked){
      const mode = arcModeSel.value;
      const deg = (mode === 'twist') ? degTwist : (mode === 'relative' ? degRelative : degTotal);
      updateArcIndicator(selectedBoneName, THREE.MathUtils.degToRad(deg));
    }
    } else {
      angleNowTotalEl.textContent = angleNowTwistEl.textContent = angleNowRelativeEl.textContent = '-°';
      // ★ 選択ボーンが無いときは座標もリセット
      posXEl.textContent = posYEl.textContent = posZEl.textContent = '-';
    }

    // 赤点追従
    updateJointPoints();

    // ★ 追加：ダイヤ型ボーンの追従
    updateBoneMeshes();

    // シーク/時間
    currentFrame = index; progressBar.value = index; currentTimeEl.textContent = formatTime(index / frameRate);
    }

    function animate(time){
      requestAnimationFrame(animate);
      if (jsonData.length && isPlaying && time - lastFrameTime > frameDuration){
        updateFrame(currentFrame);
        currentFrame = (currentFrame + 1) % maxFrame;
        lastFrameTime = time;
      }
      renderer.render(scene, camera);
    }

    // ===== 円弧矢印（LineLoop + ArrowHelper） =====
    const arcIndicators = {}; // name -> {group, circle, arc, arrow, radius, qAlign, axisLocal}

    function createAllArcIndicators(){
      Object.keys(bonesByName).forEach(name => {
        const bone = bonesByName[name];
        const axisLocal = (TWIST_AXIS_LOCAL[name] || new THREE.Vector3(0,1,0)).clone().normalize();
        arcIndicators[name] = createArcIndicatorForBone(bone, axisLocal);
        arcIndicators[name].group.visible = false; // 初期は隠す
      });
    }

    function createArcIndicatorForBone(bone, axisLocal){
      const grp = new THREE.Group();
      grp.name = bone.name + '_arcViz';
      grp.position.set(0,0,0); // ボーン原点

      // Z軸(0,0,1) を axisLocal に合わせる回転
      const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), axisLocal.clone().normalize());
      grp.quaternion.copy(qAlign);

      // ベース円（さらに控えめに）
      const radius = 8;
      const segs = 64;
      const circleGeom = new THREE.BufferGeometry();
      const circlePts = [];
      for (let i=0;i<segs;i++){
        const t = (i/segs)*Math.PI*2;
        circlePts.push(new THREE.Vector3(Math.cos(t)*radius, Math.sin(t)*radius, 0));
      }
      circleGeom.setFromPoints(circlePts);
      const circle = new THREE.LineLoop(circleGeom, new THREE.LineBasicMaterial({ color:0x555555 }));
      grp.add(circle);

      // 動的な弧（ハイライトを太め＆明るめに）
      const arcGeom = new THREE.BufferGeometry();
      arcGeom.setFromPoints([new THREE.Vector3(radius,0,0)]);
      const arcLine = new THREE.Line(arcGeom, new THREE.LineBasicMaterial({ color:0xffcc66 }));
      grp.add(arcLine);

      // 円周上を動く矢印（強調表示：長め＆大きめのヘッド）
      const arrowLen = 12, headLen = 6, headWidth = 4;
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(radius,0,0), arrowLen, 0xffcc66, headLen, headWidth);
      grp.add(arrow);

      // グループをボーンの子として配置（ローカル軸に追従）
      bone.add(grp);

      return { group:grp, circle:circle, arc:arcLine, arrow:arrow, radius, qAlign, axisLocal };
    }

    function updateArcIndicator(name, rad){
      const info = arcIndicators[name];
      if (!info) return;

      // 可視対象を選択ボーンのみに限定
      refreshArcVisibility();

      // 弧（0→rad）を再生成
      const steps = Math.max(2, Math.floor(32 * Math.min(1, Math.abs(rad)/(Math.PI*2))));
      const pts = [];
      const r = info.radius;
      const dir = (rad>=0) ? 1 : -1;
      const end = rad; // 正負対応
      const step = end/steps;
      for (let i=0;i<=steps;i++){
        const t = i*step;
        pts.push(new THREE.Vector3(Math.cos(t)*r, Math.sin(t)*r, 0));
      }
      info.arc.geometry.dispose();
      info.arc.geometry = new THREE.BufferGeometry().setFromPoints(pts);

      // 円周上の点と接線方向
      const tx = Math.cos(end)*r, ty = Math.sin(end)*r;
      const tangent = new THREE.Vector3(-Math.sin(end), Math.cos(end), 0).normalize();
      info.arrow.position.set(tx, ty, 0);
      info.arrow.setDirection(tangent.multiplyScalar(dir));

      // 表示切替（選択＋チェックONのときだけ）
      info.group.visible = arcVisibleEl.checked && (name === selectedBoneName);
    }

    function refreshArcVisibility(){
      Object.keys(arcIndicators).forEach(n => { arcIndicators[n].group.visible = false; });
      if (arcIndicators[selectedBoneName]){
        arcIndicators[selectedBoneName].group.visible = arcVisibleEl.checked;
      }
    }

    // ===== ユーティリティ =====
    function formatTime(sec){ const m = Math.floor(sec/60), s = Math.floor(sec%60); return `${m}:${s.toString().padStart(2,'0')}`; }

    // ===== 起動 =====
    (function bootstrap(){
      initThree();
      createMocopiSkeleton();
      angleChart = null; // ensure fresh
      initChart();

      // 既存操作系踏襲
      document.getElementById('jsonUpload').addEventListener('change', onJsonUpload);
      document.getElementById('playButton').onclick  = () => { isPlaying = true; chartLogging = true; };
      document.getElementById('pauseButton').onclick = () => { isPlaying = false; };
      document.getElementById('fpsSelect').addEventListener('change', e => {
        frameRate = parseInt(e.target.value, 10); frameDuration = 1000 / frameRate; totalTimeEl.textContent = formatTime(maxFrame / frameRate);
      });
      progressBar.addEventListener('input', e => { currentFrame = parseInt(e.target.value,10); updateFrame(currentFrame); isPlaying = false; });
      document.addEventListener('keydown', e => {
        if (!isPlaying){ if (e.key === '.') currentFrame = Math.min(maxFrame-1, currentFrame+1); if (e.key === ',') currentFrame = Math.max(0, currentFrame-1); updateFrame(currentFrame); }
      });

      // カメラリセットボタン
      const resetCamBtn = document.getElementById('resetCameraButton');
      if (resetCamBtn){
        resetCamBtn.addEventListener('click', resetCamera);
      }
      
      // メニュー開閉
      document.getElementById('menuBtn').addEventListener('click', () => {
        document.getElementById('menuContent').classList.toggle('show');
      });

      // メニュー操作での表示反映
      arcVisibleEl.addEventListener('change', refreshArcVisibility);
      arcModeSel.addEventListener('change', () => { /* 角度種別のみ変更時は次フレームで更新 */ });
      if (boneMeshToggleEl && typeof setBoneMeshVisible === 'function') {
        setBoneMeshVisible(boneMeshToggleEl.checked);
        boneMeshToggleEl.addEventListener('change', () => {
          setBoneMeshVisible(boneMeshToggleEl.checked);
        });
      }

      // 最初はグラフを見せる
      chartWrap.style.display = 'block';

      animate();
    })();