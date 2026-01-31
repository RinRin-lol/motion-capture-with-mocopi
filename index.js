// 今年を自動表示
document.getElementById('y').textContent = new Date().getFullYear();

// リアルタイム再生用ページへ
document.querySelector('[aria-label="リアルタイムでモーションキャプチャをする／保存する"]').href = "realtime/index_realtime.html";

// オンデマンド再生用ページへ
document.querySelector('[aria-label="保存したデータをみる"]').href = "ondemand/index_ondemand.html";

// データ編集用ページへ
document.querySelector('[aria-label="保存したデータを編集する"]').href = "editer/index_editer.html";

// 設定ページへ
document.querySelector('[aria-label="キャラクターを被せる"]').href = "ondemand/vrm/index_vrm.html";

// 使い方ページへ
document.querySelector('[aria-label="使い方"]').href = "howtouse/index_howto.html";