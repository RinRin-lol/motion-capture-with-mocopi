// 今年を自動表示
document.getElementById('y').textContent = new Date().getFullYear();

// 基本操作の説明へ
document.querySelector('[aria-label="基本操作の確認"]').href = "instructions/instruction_bace.html";

// リアルタイム説明へ
document.querySelector('[aria-label="リアルタイムでモーションキャプチャをする／保存するとき"]').href = "instructions/instruction_realtime.html";

// オンデマンド説明へ
document.querySelector('[aria-label="保存したデータをみるとき"]').href = "instructions/instruction_ondemand.html";

// データ編集説明へ
document.querySelector('[aria-label="保存したデータを編集するとき"]').href = "instructions/instruction_editer.html"

// VRM説明へ
document.querySelector('[aria-label="キャラクターを被せたいとき"]').href = "instructions/instruction_vrm.html";