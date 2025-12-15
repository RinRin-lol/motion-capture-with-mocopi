// ===== mocopi 共通モジュール =====
// three.js 読み込み後、各ページの JS より先に読み込んでください。
let bonesByName = {};
let jointPoints = [];
let restOffsetByName = {};
let boneMeshes = [];
let boneMaterial = null;

// ダイヤ更新用一時ベクトル
const _tmpParentPos = new THREE.Vector3();
const _tmpChildPos  = new THREE.Vector3();
const _tmpDir       = new THREE.Vector3();
const _upY          = new THREE.Vector3(0, 1, 0);

// ===== ボーン生成（赤点付き＋ダイヤ型ボーン） =====
function createBone(name, parent, pos) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(pos.x, pos.y, pos.z);
  if (parent) parent.add(bone);
  bonesByName[name] = bone;

  if (parent) {
    restOffsetByName[name] = new THREE.Vector3(pos.x, pos.y, pos.z);

    // -------- ダイヤ型ボーン可視化 --------
    const dir = new THREE.Vector3(pos.x, pos.y, pos.z);
    const length = dir.length();

    if (length > 0.0001) {
      if (!boneMaterial) {
        boneMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.7,
          wireframe: false
        });
      }

      const baseRadius = 3;
      const geo = new THREE.OctahedronGeometry(baseRadius);
      const mesh = new THREE.Mesh(geo, boneMaterial);

      // どのボーン区間を表すか保存
      mesh.userData.parentBone = parent;
      mesh.userData.childBone  = bone;
      mesh.userData.baseLen    = baseRadius * 2; // 単位長さ（直径）

      // メッシュはシーン直下に置く（毎フレームワールド座標で動かす）
      scene.add(mesh);

      bone.visualMesh = mesh;
      boneMeshes.push(mesh);
    }
  }

  // 関節に追従する赤い点
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  scene.add(sphere);
  jointPoints.push({ sphere, bone });

  return bone;
}

// mocopi 用ボーン構造を一括生成して root を返す
function buildMocopiBones() {
  const root = createBone('root', null, { x: 0, y: 50, z: 0 });

  let p = root;
  for (let i = 1; i <= 7; i++) {
    p = createBone(`torso_${i}`, p, { x: 0, y: 10, z: 0 });
  }

  const neck_1 = createBone('neck_1', p, { x: 0, y: 5, z: 0 });
  const neck_2 = createBone('neck_2', neck_1, { x: 0, y: 5, z: 0 });
  createBone('head', neck_2, { x: 0, y: 10, z: 0 });

  const l_shoulder = createBone('l_shoulder', p, { x: -5, y: 0, z: 0 });
  const l_up_arm   = createBone('l_up_arm', l_shoulder, { x: -15, y: 0, z: 0 });
  const l_low_arm  = createBone('l_low_arm', l_up_arm, { x: -15, y: 0, z: 0 });
  createBone('l_hand', l_low_arm, { x: -5, y: 0, z: 0 });

  const r_shoulder = createBone('r_shoulder', p, { x: 5,  y: 0, z: 0 });
  const r_up_arm   = createBone('r_up_arm', r_shoulder, { x: 15, y: 0, z: 0 });
  const r_low_arm  = createBone('r_low_arm', r_up_arm, { x: 15, y: 0, z: 0 });
  createBone('r_hand', r_low_arm, { x: 5, y: 0, z: 0 });

  const l_up_leg  = createBone('l_up_leg', root, { x: -5, y: -10, z: 0 });
  const l_low_leg = createBone('l_low_leg', l_up_leg, { x: 0, y: -25, z: 0 });
  const l_foot    = createBone('l_foot', l_low_leg, { x: 0, y: -15, z: 5 });
  createBone('l_toes', l_foot, { x: 0, y: 0, z: 5 });

  const r_up_leg  = createBone('r_up_leg', root, { x: 5, y: -10, z: 0 });
  const r_low_leg = createBone('r_low_leg', r_up_leg, { x: 0, y: -25, z: 0 });
  const r_foot    = createBone('r_foot', r_low_leg, { x: 0, y: -15, z: 5 });
  createBone('r_toes', r_foot, { x: 0, y: 0, z: 5 });

  return root;
}

// ===== 角度計算 共通ユーティリティ =====
// 各ボーンのローカル twist 軸（例：腕はローカルX、足はローカルY）
const TWIST_AXIS_LOCAL = {
  head:       new THREE.Vector3(0, 1, 0),
  neck_1:     new THREE.Vector3(0, 1, 0),
  neck_2:     new THREE.Vector3(0, 1, 0),
  l_shoulder: new THREE.Vector3(1, 0, 0),
  l_up_arm:   new THREE.Vector3(1, 0, 0),
  l_low_arm:  new THREE.Vector3(1, 0, 0),
  l_hand:     new THREE.Vector3(1, 0, 0),
  r_shoulder: new THREE.Vector3(1, 0, 0),
  r_up_arm:   new THREE.Vector3(1, 0, 0),
  r_low_arm:  new THREE.Vector3(1, 0, 0),
  r_hand:     new THREE.Vector3(1, 0, 0),
  l_up_leg:   new THREE.Vector3(0, 1, 0),
  l_low_leg:  new THREE.Vector3(0, 1, 0),
  r_up_leg:   new THREE.Vector3(0, 1, 0),
  r_low_leg:  new THREE.Vector3(0, 1, 0),
};

// 親ボーンに対する相対クォータニオン
function getRelativeQuat(selBone) {
  if (!selBone || !selBone.parent) return null;
  const qParent = new THREE.Quaternion();
  const qChild  = new THREE.Quaternion();
  selBone.parent.getWorldQuaternion(qParent);
  selBone.getWorldQuaternion(qChild);
  return qParent.invert().multiply(qChild).normalize();
}

// strict swing-twist 分解で twist 角度だけを取り出す
function twistAngleDegStrict(selBone) {
  const qRel = getRelativeQuat(selBone);
  if (!qRel) return 0;

  const aLocal = (TWIST_AXIS_LOCAL[selBone.name] || new THREE.Vector3(0, 1, 0))
    .clone()
    .normalize();
  const aRot = aLocal.clone().applyQuaternion(qRel);

  const dot = THREE.MathUtils.clamp(aLocal.dot(aRot), -1, 1);
  let axis = new THREE.Vector3().crossVectors(aLocal, aRot);
  let qSwing = new THREE.Quaternion();

  if (axis.lengthSq() < 1e-12 && dot > 0.999999) {
    // 回転ほぼなし
    qSwing.identity();
  } else if (axis.lengthSq() < 1e-12 && dot < -0.999999) {
    // 180° 反転のときは任意の直交ベクトルを軸にする
    const any = new THREE.Vector3(1, 0, 0);
    if (Math.abs(aLocal.dot(any)) > 0.9) any.set(0, 1, 0);
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

// 「回転の大きさだけ」を取り出す（軸は問わない）
function totalAngleDegFromWorldQuat(qWorld) {
  if (!qWorld) return 0;
  const w = Math.max(-1, Math.min(1, Math.abs(qWorld.w)));
  const theta = 2 * Math.acos(w);
  return THREE.MathUtils.radToDeg(theta);
}

// 親に対する相対回転のトータル角度
function relativeAngleDeg(selBone) {
  const qRel = getRelativeQuat(selBone);
  if (!qRel) return 0;
  return totalAngleDegFromWorldQuat(qRel);
}

// ===== 赤点追従ユーティリティ =====
function updateJointPoints() {
  const tmp = new THREE.Vector3();
  jointPoints.forEach(j => {
    j.bone.getWorldPosition(tmp);
    j.sphere.position.copy(tmp);
  });
}

// ===== ボーンメッシュ表示 ON/OFF =====
function setBoneMeshVisible(flag){
  Object.keys(bonesByName).forEach(name => {
    const b = bonesByName[name];
    if (b && b.visualMesh) {
      b.visualMesh.visible = flag;
    }
  });
}

// ===== ダイヤ型ボーンの更新 =====
function updateBoneMeshes() {
  boneMeshes.forEach(mesh => {
    const parentBone = mesh.userData.parentBone;
    const childBone  = mesh.userData.childBone;
    if (!parentBone || !childBone) return;

    parentBone.getWorldPosition(_tmpParentPos);
    childBone.getWorldPosition(_tmpChildPos);

    _tmpDir.copy(_tmpChildPos).sub(_tmpParentPos);
    const len = _tmpDir.length();
    if (len < 1e-4) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // 中点
    mesh.position.copy(_tmpParentPos).add(_tmpDir.clone().multiplyScalar(0.5));

    // +Y を 親→子 方向に向ける
    mesh.quaternion.setFromUnitVectors(_upY, _tmpDir.clone().normalize());

    // 長さに応じて Y スケールを変更
    const baseLen = mesh.userData.baseLen || 1;
    const s = len / baseLen;
    mesh.scale.set(1, s, 1);
  });
}
