/* 夫婦ポイントトラッカー（Firebase版・相互承認 完成版）
 * - 夫/妻のロール＋ペアコード：初回モーダル（設定から再表示可能）
 * - 起動直後から「記録」タブに行動一覧を表示（保存不要）
 * - 「申請」でクラウドに仮ポイント（request）を作成
 * - 相手の端末の「ポイント」タブに承認待ち（日付・行動・回数・ポイント）を表示、承認可能
 * - 承認すると相手の正式ポイントが増え、仮ポイントが減る（リアルタイム反映）
 */

/* ===== Firebase SDK（v10） ===== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc,
  onSnapshot, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

/* === 必ず差し替えてください（Firebaseコンソールのスニペット） === */
const firebaseConfig = {
  apiKey: "AIzaSyAEW9HMqmXe2dnCxhmidfASa1dy3VRQoYA",
  authDomain: "couple-points-d56e8.firebaseapp.com",
  projectId: "couple-points-d56e8",
  storageBucket: "couple-points-d56e8.firebasestorage.app",
  messagingSenderId: "866122557299",
  appId: "1:866122557299:web:7d917ffc507fbee1fd4706"
};
/* =============================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ===== 小ユーティリティ ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const rid = () => Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,8);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const formatDateJP = d => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
const esc = s => (s==null? "": String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])));

/* ===== ローカル状態 ===== */
const STORAGE_KEY = "habit_pair_v2";
let state = loadLocal() || createInitial();

function loadLocal(){ try{ const raw=localStorage.getItem(STORAGE_KEY); return raw? JSON.parse(raw):null }catch{return null} }
function saveLocal(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function createInitial(){
  const t = todayStr();
  return {
    ui: { pairCode:"", role:"", uid:"" },
    actions: defaultActions(),
    today: { date: t, counts:{}, points:0 },
    bonus: { enabled:false, days:7, amount:50, perAction:true },
    memo: "",
    history: []
  };
}
function defaultActions(){
  // 初回から記録タブに表示される
  return [
    { id: rid(), name:"漢方を飲む", category:"心身ケア", point:5 },
    { id: rid(), name:"ストレッチ", category:"心身ケア", point:10 },
    { id: rid(), name:"筋トレ", category:"心身ケア", point:10 },
    { id: rid(), name:"瞑想（3分以上）", category:"心身ケア", point:10 },
    { id: rid(), name:"散歩", category:"心身ケア", point:10, note:"10〜30ptに調整可" },
    { id: rid(), name:"早寝", category:"心身ケア", point:20 },
    { id: rid(), name:"早起き", category:"心身ケア", point:30 },
    { id: rid(), name:"朝ご飯作り", category:"生活", point:10 },
    { id: rid(), name:"昼ご飯作り", category:"生活", point:10 },
    { id: rid(), name:"夜ご飯作り", category:"生活", point:30 },
    { id: rid(), name:"掃除", category:"生活", point:10 },
    { id: rid(), name:"ギター練習", category:"自己研鑽", point:50 },
    { id: rid(), name:"ブログを書く", category:"自己研鑽", point:50 },
    { id: rid(), name:"アプリ開発作業", category:"自己研鑽", point:10 },
    { id: rid(), name:"日記を書く", category:"自己研鑽", point:10 },
    { id: rid(), name:"電車に乗る（苦手）", category:"チャレンジ", point:100, hard:true },
    { id: rid(), name:"3時間以上の外出", category:"チャレンジ", point:50 }
  ];
}

/* ===== 画面基本 ===== */
$("#todayStr").textContent = formatDateJP(new Date());

function wireTabs(){
  $$(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const target = btn.dataset.target;
      $$(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      $$(".view").forEach(v=>v.classList.remove("active"));
      $("#"+target).classList.add("active");

      renderHeader();
      if(target==="view-settings"){ renderSettingsTable(); }
      function refreshCloudStatsUI() {
     // Firestoreの購読で自動更新されるので特に処理なし
     console.log("🔄 Cloud stats UI refreshed");
}
      if(target==="view-history"){ renderCalendar(); }
    });
  });
}
wireTabs();

/* ===== ロールモーダル ===== */
/* ===== ロールモーダル ===== */
function needRoleSetup() {
  return !(state.ui.pairCode && state.ui.role && state.ui.uid);
}
function showRoleModal() {
  $("#roleModal").classList.add("show");
}
function hideRoleModal() {
  $("#roleModal").classList.remove("show");
}

$("#switchAccountBtn").addEventListener("click", () => {
  showRoleModal();
});

$("#saveRoleBtn").addEventListener("click", async () => {
  const pairCode = $("#pairCode").value.trim();
  const role = document.querySelector('input[name="role"]:checked')?.value;
  if (!pairCode || !role) {
    alert("ペアコードと役割を設定してください。");
    return;
  }

  try {
    // 匿名ログイン（安全な完了待ち）
    let user = auth.currentUser;
    if (!user) {
      const cred = await signInAnonymously(auth);
      user = cred.user;
    }

    // UIDが取得できないと次の処理が止まるため安全チェック
    if (!user || !user.uid) {
      alert("ログインに失敗しました。再試行してください。");
      return;
    }

    state.ui = { pairCode, role, uid: user.uid };
    saveLocal();

    await ensureUserDoc(); // 自分のFirestoreドキュメント作成
    subscribeCloud(); // 相手・自分の購読開始

    hideRoleModal();
    renderAll();

    alert(`設定を保存しました。\nペアコード: ${pairCode}\n役割: ${role === "husband" ? "夫" : "妻"}`);
  } catch (err) {
    console.error("ログインまたは設定エラー:", err);
    alert("エラーが発生しました。通信状況を確認してください。");
  }
});


/* ===== Firestore 参照 ===== */
// ✅ 修正版：pairsを廃止し、ペアコードをルートにする
function pairDocRef() {
  return doc(db, "pairs", state.ui.pairCode);
}
function userDocRef() {
  return doc(db, "pairs", state.ui.pairCode, "users", state.ui.role);
}
function partnerRole() {
  return state.ui.role === "husband" ? "wife" : "husband";
}
function partnerDocRef() {
  return doc(db, "pairs", state.ui.pairCode, "users", partnerRole());
}
function requestsCol() {
  return collection(db, "pairs", state.ui.pairCode, "requests");
}


/* ===== 初期化（ユーザー文書作成） ===== */
async function ensureUserDoc(){
  const ref = userDocRef();
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      role: state.ui.role,
      approvedPoints: 0,
      pendingPoints: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

/* ===== クラウド購読（リアルタイム） ===== */
let unsubUser = null, unsubPartnerReq = null, unsubMyPending = null;

function subscribeCloud() {
  if (!state.ui.pairCode || !state.ui.role) return;

  unsubUser?.(); unsubPartnerReq?.(); unsubMyPending?.();

  console.log("📡購読開始:", state.ui.pairCode, "自分:", state.ui.role, "相手:", partnerRole());

  // ✅ 自分のポイント（正式/仮）
  unsubUser = onSnapshot(
    doc(db, "pairs", state.ui.pairCode, "users", state.ui.role),
    snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      $("#approvedPoints").textContent = d.approvedPoints ?? 0;
      $("#pendingPoints").textContent = d.pendingPoints ?? 0;
      $("#pointsApprovedBig").textContent = d.approvedPoints ?? 0;
      $("#pointsPendingBig").textContent = d.pendingPoints ?? 0;
    }
  );

  // ✅ 相手の承認待ち（相手が申請した pending のみ表示）
  unsubPartnerReq = onSnapshot(
    query(
      collection(db, "pairs", state.ui.pairCode, "requests"),
      where("role", "==", partnerRole()),
      where("approved", "==", false),
      orderBy("createdAt", "desc")
    ),
    qs => {
      const list = $("#partnerRequests");
      list.innerHTML = "";
      if (qs.empty) {
        list.innerHTML = `<div class="item"><span>承認待ちはありません</span><span>-</span></div>`;
        return;
      }
      qs.forEach(s => {
        const r = s.data();
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <span>${esc(r.date)}｜${esc(r.actionName)} × ${r.count}回｜${r.amount}pt</span>
          <span><button class="btn small primary" data-approve="${s.id}">承認</button></span>`;
        list.appendChild(el);
      });
      $$("#partnerRequests [data-approve]").forEach(b => {
        b.onclick = () => approveRequest(b.dataset.approve);
      });
    }
  );

  // ✅ 自分の未承認（自分が送ったリクエスト）
 // ✅ 自分の未承認（自分が送ったリクエスト）
unsubMyPending = onSnapshot(
  query(
    collection(db, "pairs", state.ui.pairCode, "requests"),
    where("role", "==", state.ui.role),
    where("approved", "==", false),
    where("cancelled", "==", false),
    orderBy("createdAt", "desc")
  ),
  qs => {
    const list = $("#myPendingList");
    list.innerHTML = "";
    if (qs.empty) {
      list.innerHTML = `<div class="item"><span>未承認の申請はありません</span><span>-</span></div>`;
      return;
    }
    qs.forEach(s => {
      const r = s.data();
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <span>${esc(r.date)}｜${esc(r.actionName)} × ${r.count}回｜${r.amount}pt</span>
        <span>
          <button class="btn small danger" data-cancel="${s.id}">取消</button>
        </span>`;
      list.appendChild(el);
    });
    $$("#myPendingList [data-cancel]").forEach(b => {
      b.onclick = () => cancelRequest(b.dataset.cancel);
    });
  }
);
// ✅ 申請取消処理
async function cancelRequest(requestId) {
  if (!confirm("この申請を取り消しますか？")) return;

  const rref = doc(db, "pairs", state.ui.pairCode, "requests", requestId);
  const snap = await getDoc(rref);
  if (!snap.exists()) {
    alert("申請が見つかりません");
    return;
  }
  const r = snap.data();
  if (r.approved) {
    alert("すでに承認された申請は取り消せません");
    return;
  }

  // 🔸 自分のpendingPointsを減算
  const uref = userDocRef();
  const usnap = await getDoc(uref);
  if (usnap.exists()) {
    const ud = usnap.data();
    const newPending = Math.max(0, (ud.pendingPoints || 0) - (r.amount || 0));
    await updateDoc(uref, { pendingPoints: newPending, updatedAt: serverTimestamp() });
  }

  // 🔸 リクエストをキャンセル扱いに変更
  await updateDoc(rref, {
    cancelled: true,
    cancelledAt: serverTimestamp(),
    cancelledBy: state.ui.role
  });

  alert("申請を取り消しました。");
}

}

function updateRoleLabel() {
  const label = $("#roleLabel");
  if (!label) return;
  if (!state.ui.role) {
    label.textContent = "";
  } else {
    label.textContent = state.ui.role === "husband" ? "夫" : "妻";
  }
}



async function approveRequest(requestId) {
  // ✅ 修正ポイント：pairs を追加
  const rref = doc(db, "pairs", state.ui.pairCode, "requests", requestId);
  const snap = await getDoc(rref);
  if (!snap.exists()) {
    alert("申請が見つかりません");
    return;
  }

  const r = snap.data();
  if (r.approved) return;
  if (r.role === state.ui.role) {
    alert("自分の申請は承認できません");
    return;
  }

  // ✅ ここも修正ポイント
  const targetRef = doc(db, "pairs", state.ui.pairCode, "users", r.role);
  const uSnap = await getDoc(targetRef);
  if (!uSnap.exists()) {
    alert("相手のデータが見つかりません");
    return;
  }

  const ud = uSnap.data();
  const newApproved = (ud.approvedPoints || 0) + (r.amount || 0);
  const newPending = Math.max(0, (ud.pendingPoints || 0) - (r.amount || 0));

  await updateDoc(targetRef, {
    approvedPoints: newApproved,
    pendingPoints: newPending,
    updatedAt: serverTimestamp(),
  });

  await updateDoc(rref, {
    approved: true,
    approvedBy: state.ui.role,
    approvedAt: serverTimestamp(),
  });
}
// ===== ポイント消費 =====
$("#spendBtn")?.addEventListener("click", async () => {
  const amount = parseInt($("#spendAmount").value || "0", 10);
  if (amount <= 0) return alert("正しいポイント数を入力してください。");

  const ref = userDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) return alert("ユーザーデータが見つかりません。");

  const d = snap.data();
  const current = d.approvedPoints || 0;

  if (amount > current) {
    alert("所持ポイントが不足しています。");
    return;
  }

  const newPoints = current - amount;
  await updateDoc(ref, {
    approvedPoints: newPoints,
    updatedAt: serverTimestamp(),
  });

  alert(`ポイントを${amount}pt消費しました。`);
  $("#spendAmount").value = "";
});



/* ===== ヘッダー/ローカル描画 ===== */
function renderHeader(){
  $("#todayStr").textContent = formatDateJP(new Date());
 // 今日のポイントを再計算
  const todaySum = calcTodayPoints();
  state.today.points = todaySum;

  $("#todayPoints").textContent = state.today.points;
  $("#pointsTodayBig").textContent = state.today.points;
}

/* ===== 記録（行動一覧） ===== */
function groupByCategory(list){
  const map={}; list.forEach(a=>{ (map[a.category] ||= []).push(a) }); return map;
}
function renderRecordAccordion(){
  const wrap = $("#recordAccordion"); wrap.innerHTML = "";
  const groups = groupByCategory(state.actions);
  Object.keys(groups).forEach(cat=>{
    const item = document.createElement("div");
    item.className = "acc-item open";
    item.innerHTML = `
      <div class="acc-head"><div class="acc-title">📂 ${esc(cat)}</div><div>開く/閉じる</div></div>
      <div class="acc-body"></div>
    `;
    const body = item.querySelector(".acc-body");
    item.querySelector(".acc-head").addEventListener("click",()=> item.classList.toggle("open"));

    groups[cat].forEach(act=> body.appendChild(renderActionRow(act)));
    wrap.appendChild(item);
  });
}
function renderActionRow(act){
  const counts = state.today.counts[act.id] || 0;
  const row = document.createElement("div");
  row.className = "action-row" + (counts>0?" done":"") + (act.hard?" hard":"");
  row.dataset.actionId = act.id;
  row.innerHTML = `
    <div>
      <div class="action-name">${esc(act.name)}</div>
      <div class="action-pt">${act.point} pt/回 ${act.note? "・"+esc(act.note):""}</div>
    </div>
    <div class="action-ops">
      <button class="btn icon" data-op="minus">−</button>
      <div class="counter" data-counter>${counts}</div>
      <button class="btn icon" data-op="plus">＋</button>
    </div>
    <div class="action-ops">
      <button class="btn ghost small" data-op="reset">リセット</button>
    </div>
    <div class="action-ops">
      <div class="chip">合計 <span data-gained>${act.point*counts}</span> pt</div>
    </div>
  `;
  row.addEventListener("click", e=>{
  const op = e.target.closest("[data-op]")?.dataset.op; if(!op) return;
  let current = state.today.counts[act.id] || 0;
  if(op==="plus") current++;
  else if(op==="minus") current = Math.max(0, current-1);
  else if(op==="reset") current = 0;
  state.today.counts[act.id] = current;
  state.today.points = calcTodayPoints();
  saveLocal();

  row.querySelector("[data-counter]").textContent = current;
  row.querySelector("[data-gained]").textContent  = act.point*current;
  row.classList.toggle("done", current>0);
  renderHeader(); // ← ここを残してOK
});

  return row;
}
function calcTodayPoints(){
  let sum=0;
  for(const [id,cnt] of Object.entries(state.today.counts)){
    const act = state.actions.find(a=>a.id===id);
    if(act) sum += act.point*cnt;
  }
  return sum;
}

/* ===== 今日の記録を「申請」（仮ポイント化） ===== */
$("#saveTodayBtn").addEventListener("click", async ()=>{
  if(needRoleSetup()){ showRoleModal(); return; }
  const date = todayStr();
  const entries = Object.entries(state.today.counts).filter(([_,c])=>c>0);
  if(entries.length===0){ alert("記録がありません。"); return; }

  let totalAdd = 0;
  for(const [id,cnt] of entries){
    const act = state.actions.find(a=>a.id===id); if(!act) continue;
    const amount = act.point * cnt;
    totalAdd += amount;
await addDoc(requestsCol(), {
  role: state.ui.role,
  actionId: id,
  actionName: act.name,
  count: cnt,
  pointPer: act.point,
  amount,
  date,
  approved: false,
  cancelled: false, // ← これを入れる！
  createdAt: serverTimestamp()
});

  }
  // 仮ポイント合計を加算
  const uref = userDocRef();
  const snap = await getDoc(uref);
  if(snap.exists()){
    const d = snap.data();
    await updateDoc(uref, { pendingPoints: (d.pendingPoints||0) + totalAdd, updatedAt: serverTimestamp() });
  }else{
    await setDoc(uref, { role: state.ui.role, approvedPoints:0, pendingPoints: totalAdd, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  alert("申請を作成しました。（仮ポイントに加算）");

  // ローカルの今日をクリア
  state.today = { date: todayStr(), counts:{}, points:0 };
  saveLocal();
  renderAll();
});

/* ===== 設定（行動のCRUD） ===== */
function renderSettingsTable(){
  const wrap = $("#actionsTableWrap");
  if(state.actions.length===0){
    wrap.innerHTML = `<div class="list"><div class="item">行動がありません。追加してください。</div></div>`;
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr><th>行動名</th><th>カテゴリ</th><th>ポイント/回</th><th>メモ</th><th>苦手</th><th>操作</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  state.actions.forEach(act=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="inp-name" value="${esc(act.name)}" /></td>
      <td>
  <input class="inp-cat" type="text" value="${esc(act.category)}" list="categoryList" />
</td>

      <td><input class="inp-pt" type="number" min="1" step="1" value="${act.point}" /></td>
      <td><input class="inp-note" value="${esc(act.note||"")}" /></td>
      <td style="text-align:center"><input class="inp-hard" type="checkbox" ${act.hard?"checked":""} /></td>
      <td class="row-actions">
        <button class="btn small ghost" data-op="save">保存</button>
        <button class="btn small danger" data-op="del">削除</button>
      </td>
    `;
    tbody.appendChild(tr);

    tr.querySelector("[data-op=save]").addEventListener("click", ()=>{
      const name = tr.querySelector(".inp-name").value.trim();
      const category = tr.querySelector(".inp-cat").value;
      const point = parseInt(tr.querySelector(".inp-pt").value||"0",10);
      const note = tr.querySelector(".inp-note").value.trim();
      const hard = tr.querySelector(".inp-hard").checked;
      if(!name || !category || !point || point<=0){ alert("入力を確認してください。"); return; }
      act.name=name; act.category=category; act.point=point; act.note=note; act.hard=hard;
      saveLocal(); renderRecordAccordion(); alert("保存しました。");
    });

    tr.querySelector("[data-op=del]").addEventListener("click", ()=>{
      if(!confirm(`「${act.name}」を削除しますか？`)) return;
      delete state.today.counts[act.id];
      state.actions = state.actions.filter(a=>a.id!==act.id);
      saveLocal(); renderSettingsTable(); renderRecordAccordion(); renderHeader();
    });
  });

  wrap.innerHTML = ""; wrap.appendChild(table);

  // 追加フォーム
  $("#addActionForm").onsubmit = e=>{
    e.preventDefault();
    const name=$("#newActionName").value.trim();
    const category=$("#newActionCategory").value;
    const point=parseInt($("#newActionPoint").value||"0",10);
    const note=$("#newActionNote").value.trim();
    const hard=$("#newActionHard").checked;
    if(!name || !category || !point || point<=0){ alert("入力を確認してください。"); return; }
    state.actions.push({ id: rid(), name, category, point, note, hard });
    saveLocal(); e.target.reset(); $("#newActionPoint").value=10;
    renderRecordAccordion(); renderSettingsTable();
  };

  // 連続ボーナス（ローカル設定）
  $("#bonusEnabled").checked = !!state.bonus.enabled;
  $("#bonusDays").value = state.bonus.days || 7;
  $("#bonusAmount").value = state.bonus.amount || 50;
  $("#bonusPerAction").checked = !!state.bonus.perAction;
  $("#bonusForm").onsubmit = e=>{
    e.preventDefault();
    state.bonus = {
      enabled: $("#bonusEnabled").checked,
      days: Math.max(2, parseInt($("#bonusDays").value||"7",10)),
      amount: Math.max(1, parseInt($("#bonusAmount").value||"50",10)),
      perAction: $("#bonusPerAction").checked
    };
    saveLocal(); alert("連続ボーナス設定を保存しました。");
  };
}

/* ===== メモ（ローカル） ===== */
$("#saveMemoBtn").addEventListener("click", ()=>{
  state.memo = $("#memoText").value.trim();
  saveLocal();
  $("#memoSavedMsg").style.display = "inline";
  setTimeout(()=> $("#memoSavedMsg").style.display="none", 2000);
});

/* ===== エクスポート/インポート（ローカル） ===== */
$("#exportBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `habit_backup_${state.today.date}.json`; a.click();
  URL.revokeObjectURL(url);
});
$("#importInput").addEventListener("change", e=>{
  const file=e.target.files?.[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{ state = JSON.parse(reader.result); saveLocal(); renderAll(); alert("インポートしました。"); }
    catch{ alert("読み込みに失敗しました。"); }
  };
  reader.readAsText(file);
});

/* ===== カレンダー（ローカル履歴） ===== */
let calCurrent = (()=>{
  const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1);
})();
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function sumPointsByDate(dateStr){ const rec = state.history.find(h=>h.date===dateStr); return rec ? rec.points : 0; }
function detailsByDate(dateStr){ const rec = state.history.find(h=>h.date===dateStr); return rec ? rec.details : []; }
function renderCalendar(){
  const y = calCurrent.getFullYear(); const m = calCurrent.getMonth();
  $("#calTitle").textContent = `${y}年${m+1}月`;
  const grid=$("#calGrid"); grid.innerHTML="";

  const first=new Date(y,m,1); const start=first.getDay();
  const last=new Date(y,m+1,0).getDate(); const prevLast=new Date(y,m,0).getDate();

  for(let i=0;i<start;i++) grid.appendChild(buildCalCell(new Date(y,m-1, prevLast-start+1+i), true));
  for(let d=1; d<=last; d++) grid.appendChild(buildCalCell(new Date(y,m,d), false));
  const need=(grid.children.length<=35)? 35-grid.children.length : 42-grid.children.length;
  for(let i=1;i<=need;i++) grid.appendChild(buildCalCell(new Date(y,m+1,i), true));

  $("#calPrev").onclick=()=>{ calCurrent=new Date(y,m-1,1); renderCalendar(); };
  $("#calNext").onclick=()=>{ calCurrent=new Date(y,m+1,1); renderCalendar(); };
}
function buildCalCell(dateObj, dim=false){
  const ds=ymd(dateObj); const pt=sumPointsByDate(ds);
  const cell=document.createElement("div");
  cell.className="cal-cell"+(dim?" dim":"")+(pt>0?" haspt":"");
  cell.innerHTML=`<div class="d">${dateObj.getDate()}</div><div class="pt">${pt>0?(pt+" pt"):""}</div>`;
  cell.onclick=()=>{
    const detail=$("#dayDetail"), title=$("#dayDetailTitle"), lines=$("#dayDetailLines");
    title.textContent=`${dateObj.getFullYear()}年${dateObj.getMonth()+1}月${dateObj.getDate()}日：合計 ${pt} pt`;
    lines.innerHTML="";
    const dsDetails=detailsByDate(ds);
    if(dsDetails.length===0){ lines.innerHTML=`<div class="line"><div>記録なし</div><div>-</div></div>`; }
    else{
      dsDetails.forEach(line=>{
        if(line.type==="bonus") lines.innerHTML += `<div class="line"><div>🎉 ボーナス（${esc(line.note)}）</div><div>+${line.amount} pt</div></div>`;
        else lines.innerHTML += `<div class="line"><div>${esc(line.name)} × ${line.count}</div><div>${line.gained} pt</div></div>`;
      });
    }
    detail.style.display="block";
    detail.scrollIntoView({behavior:"smooth", block:"start"});
  };
  return cell;
}
$("#clearHistoryBtn").onclick=()=>{
  if(!confirm("ローカル履歴をすべて削除しますか？")) return;
  state.history=[]; saveLocal(); renderCalendar();
};

/* ===== 今日のローカル操作 ===== */
$("#resetTodayBtn").addEventListener("click", ()=>{
  if(!confirm("今日の記録（ローカル）をリセットしますか？")) return;
  state.today={ date: todayStr(), counts:{}, points:0 }; saveLocal(); renderAll();
});

/* ===== まとめて描画 ===== */
function renderAll(){
  renderHeader();
  renderRecordAccordion();
  renderSettingsTable();
  $("#memoText").value = state.memo || "";
  renderCalendar();
}

/* ===== 起動：認証＆自動接続 ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ await signInAnonymously(auth); }
  if(needRoleSetup()){ showRoleModal(); }
  else{
    await ensureUserDoc();
    subscribeCloud();
    updateRoleLabel(); // ← ここを追加
  }
  renderAll();
});

/* ===== 日付変更チェック（履歴への自動記録） ===== */
function checkDateChangeAndUpdateHistory() {
  const current = todayStr();

  // 初回（state.today.dateが空ならセット）
  if (!state.today.date) {
    state.today.date = current;
    saveLocal();
    return;
  }

  // 日付が変わったとき
  if (state.today.date !== current) {
    const prevDate = state.today.date;

    // 前日分を履歴に保存
    if (state.today.points > 0) {
      const details = Object.entries(state.today.counts).map(([id, count]) => {
        const act = state.actions.find(a => a.id === id);
        if (!act) return null;
        return { name: act.name, count, gained: act.point * count };
      }).filter(Boolean);

      state.history.push({
        date: prevDate,
        points: state.today.points,
        details,
      });
    }

    // 今日をリセット
    state.today = { date: current, counts: {}, points: 0 };
    saveLocal();
    renderAll();
    console.log("🌅 日付変更を検知して履歴更新・リセットしました。");
  }
}

// アプリ起動時にチェック
checkDateChangeAndUpdateHistory();

// ページが開いている間も定期的に監視（1分ごと）
setInterval(checkDateChangeAndUpdateHistory, 60 * 1000);

