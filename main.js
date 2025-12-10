// main.js - client-only multi-account + admin controls for Mini Gacha
// WARNING: client-only. Not secure. Good for prototypes among friends.

const ACCOUNTS_KEY = "miniGacha_accounts_v1";
const CURRENT_USER_KEY = "miniGacha_current_user_v1";
const ADMIN_KEY = "miniGacha_admin_hash_v1";

const CHARACTERS = [
  { id: "aiko", name: "Aiko", rarity: 5, weight: 1 },
  { id: "yuna", name: "Yuna", rarity: 4, weight: 4 },
  { id: "mika", name: "Mika", rarity: 4, weight: 4 },
  { id: "ren", name: "Ren", rarity: 3, weight: 30 },
  { id: "kai", name: "Kai", rarity: 3, weight: 30 },
  { id: "sora", name: "Sora", rarity: 3, weight: 30 },
];
const RARITY_BASE = { 5: 0.02, 4: 0.18, 3: 0.80 };
const COST_SINGLE = 100;
const COST_TEN = 900;
const PITY_THRESHOLD = 90;

let accounts = {}; // loaded from storage
let currentUser = null; // username string when logged in
let adminSession = false; // true if admin authenticated in this page session

document.addEventListener("DOMContentLoaded", async () => {
  // load accounts and ensure default admin
  accounts = loadAccounts();
  await ensureAdminHash();

  // Build simple auth + admin UI in header if not present
  initAuthUI();
  initGameUI(); // hooks into existing DOM elements (currency, pulls, etc.)
  renderAuthState();
  renderGameForCurrentUser();
});

// ---------------- storage & crypto helpers ----------------
function loadAccounts(){
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { console.warn("loadAccounts failed", e); return {}; }
}
function saveAccounts(){
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch(e) { console.warn("saveAccounts failed", e); }
}
function saveCurrentUser(){
  if(currentUser) localStorage.setItem(CURRENT_USER_KEY, currentUser);
  else localStorage.removeItem(CURRENT_USER_KEY);
}
function loadCurrentUser(){
  return localStorage.getItem(CURRENT_USER_KEY);
}

async function hashText(text){
  if(window.crypto && crypto.subtle){
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  // fallback (insecure)
  let h = 0;
  for(let i=0;i<text.length;i++) h = ((h<<5)-h) + text.charCodeAt(i);
  return String(h >>> 0);
}

// ensure admin password exists (default "yuki" if missing)
async function ensureAdminHash(){
  if(!localStorage.getItem(ADMIN_KEY)){
    const h = await hashText("yuki");
    localStorage.setItem(ADMIN_KEY, h);
    console.info("No admin password found; default 'yuki' has been created. Change it ASAP.");
  }
}
async function verifyAdminPassword(plain){
  const stored = localStorage.getItem(ADMIN_KEY);
  if(!stored) await ensureAdminHash();
  const h = await hashText(plain);
  return h === localStorage.getItem(ADMIN_KEY);
}
async function setAdminPassword(plain){
  const h = await hashText(plain);
  localStorage.setItem(ADMIN_KEY, h);
}

// ---------------- account management ----------------
async function createAccount(username, password){
  username = (username || "").trim();
  if(!username) throw new Error("Username required");
  if(accounts[username]) throw new Error("Username already exists");
  const pwHash = await hashText(password || "");
  accounts[username] = {
    passwordHash: pwHash,
    currency: 500,
    pity: 0,
    inventory: {},
    history: [],
    createdAt: Date.now()
  };
  saveAccounts();
}
async function loginAccount(username, password){
  username = (username || "").trim();
  const acct = accounts[username];
  if(!acct) throw new Error("No such user");
  const h = await hashText(password || "");
  if(h !== acct.passwordHash) throw new Error("Wrong password");
  currentUser = username;
  saveCurrentUser();
  renderAuthState();
  renderGameForCurrentUser();
}
function logoutAccount(){
  currentUser = null;
  saveCurrentUser();
  renderAuthState();
  renderGameForCurrentUser();
}
function deleteAccount(username){
  delete accounts[username];
  saveAccounts();
  if(currentUser === username) logoutAccount();
}

// ---------------- admin actions ----------------
async function adminAuthenticatePrompt(){
  const pw = prompt("Enter admin password:");
  if(pw === null) return false;
  const ok = await verifyAdminPassword(pw);
  if(ok){
    adminSession = true;
    alert("Admin session active for this page (until refresh).");
    renderAuthState();
    return true;
  } else {
    alert("Incorrect admin password.");
    return false;
  }
}
async function adminAddCurrencyTo(username, amount){
  if(!adminSession){
    const ok = await adminAuthenticatePrompt();
    if(!ok) return;
  }
  const acct = accounts[username];
  if(!acct) { alert("Target user not found"); return; }
  acct.currency = (acct.currency || 0) + Number(amount || 0);
  saveAccounts();
  alert(`Added ${amount} to ${username}. New balance: ${acct.currency}`);
  renderGameForCurrentUser();
}
async function adminChangePasswordFlow(){
  if(!adminSession){
    const ok = await adminAuthenticatePrompt();
    if(!ok) return;
  }
  const newPw = prompt("New admin password (min 4 chars):");
  if(!newPw) return;
  if(newPw.length < 4){ alert("Too short"); return; }
  await setAdminPassword(newPw);
  alert("Admin password changed.");
}

// ---------------- game logic (per-account) ----------------
function getAccount(username){
  if(!username) return null;
  return accounts[username] || null;
}
function saveAccount(username, acct){
  accounts[username] = acct;
  saveAccounts();
}
function currentAcct(){
  if(!currentUser) return null;
  if(!accounts[currentUser]) return null;
  return accounts[currentUser];
}

// Pulls (same logic as before), operate on current account
function doPullsForCurrentUser(n){
  const acct = currentAcct();
  if(!acct){ alert("Not logged in."); return; }
  const cost = (n === 10) ? COST_TEN : COST_SINGLE;
  if((acct.currency || 0) < cost){ alert("Insufficient currency."); return; }
  acct.currency -= cost;
  const results = [];
  for(let i=0;i<n;i++){
    const r = pullOneForAcct(acct);
    results.push(r);
    acct.history.unshift({ time: Date.now(), result: r });
    if(acct.history.length > 200) acct.history.pop();
    acct.inventory[r.id] = (acct.inventory[r.id]||0) + 1;
  }
  saveAccount(currentUser, acct);
  renderGameForCurrentUser();
  showResults(results);
}

function pullOneForAcct(acct){
  if(acct.pity >= PITY_THRESHOLD - 1){
    const five = CHARACTERS.filter(c=>c.rarity===5);
    const chosen = sampleOne(five);
    acct.pity = 0;
    return chosen;
  }
  const r = sampleRarity();
  const pool = CHARACTERS.filter(c=>c.rarity===r);
  const chosen = sampleWeighted(pool);
  if(chosen.rarity === 5) acct.pity = 0;
  else acct.pity = (acct.pity || 0) + 1;
  return chosen;
}

function sampleRarity(){
  const r = Math.random();
  if(r < RARITY_BASE[5]) return 5;
  if(r < RARITY_BASE[5] + RARITY_BASE[4]) return 4;
  return 3;
}
function sampleWeighted(list){
  const total = list.reduce((s,it)=>s+(it.weight||1),0);
  let r = Math.random()*total;
  for(const it of list){
    r -= (it.weight||1);
    if(r <= 0) return it;
  }
  return list[list.length-1];
}
function sampleOne(list){ return list[Math.floor(Math.random()*list.length)]; }

// ---------------- UI wiring ----------------
function initAuthUI(){
  // Create a small auth panel (username/password) and admin controls, append to header
  const header = document.querySelector("header") || document.body;
  const panel = document.createElement("div");
  panel.style.display = "flex";
  panel.style.alignItems = "center";
  panel.style.gap = "8px";
  panel.id = "mini-auth-panel";

  // username input
  const userIn = document.createElement("input");
  userIn.placeholder = "username";
  userIn.id = "mini-username";
  userIn.style.padding = "6px";
  // password input
  const pwIn = document.createElement("input");
  pwIn.placeholder = "password";
  pwIn.type = "password";
  pwIn.id = "mini-password";
  pwIn.style.padding = "6px";

  const signupBtn = document.createElement("button");
  signupBtn.textContent = "Sign up";
  signupBtn.onclick = async () => {
    try {
      await createAccount(userIn.value, pwIn.value);
      alert("Account created. You can now log in.");
      userIn.value = "";
      pwIn.value = "";
      refreshAccountListUI();
    } catch(e) { alert("Sign up error: " + e.message); }
  };

  const loginBtn = document.createElement("button");
  loginBtn.textContent = "Log in";
  loginBtn.onclick = async () => {
    try {
      await loginAccount(userIn.value, pwIn.value);
    } catch(e) { alert("Login failed: " + e.message); }
  };

  const logoutBtn = document.createElement("button");
  logoutBtn.textContent = "Log out";
  logoutBtn.onclick = () => logoutAccount();

  const adminAuthBtn = document.createElement("button");
  adminAuthBtn.textContent = "Admin log in";
  adminAuthBtn.onclick = async () => { await adminAuthenticatePrompt(); };

  const changeAdminBtn = document.createElement("button");
  changeAdminBtn.textContent = "Change Admin Password";
  changeAdminBtn.onclick = async () => { await adminChangePasswordFlow(); };

  const adminPanel = document.createElement("div");
  adminPanel.id = "mini-admin-panel";
  adminPanel.style.display = "inline-flex";
  adminPanel.style.alignItems = "center";
  adminPanel.style.gap = "6px";
  adminPanel.style.marginLeft = "12px";

  const userSelect = document.createElement("select");
  userSelect.id = "mini-user-select";
  userSelect.style.padding = "6px";
  refreshAccountListUI();

  const amtInput = document.createElement("input");
  amtInput.placeholder = "amount";
  amtInput.type = "number";
  amtInput.min = "1";
  amtInput.style.width = "80px";
  amtInput.id = "mini-admin-amt";

  const addToUserBtn = document.createElement("button");
  addToUserBtn.textContent = "Add to user";
  addToUserBtn.onclick = async () => {
    const target = userSelect.value;
    const amt = Number(amtInput.value);
    if(!target || !amt || amt <= 0){ alert("Pick user & positive amount"); return; }
    await adminAddCurrencyTo(target, amt);
    refreshAccountListUI();
  };

  adminPanel.appendChild(userSelect);
  adminPanel.appendChild(amtInput);
  adminPanel.appendChild(addToUserBtn);

  panel.appendChild(userIn);
  panel.appendChild(pwIn);
  panel.appendChild(signupBtn);
  panel.appendChild(loginBtn);
  panel.appendChild(logoutBtn);
  panel.appendChild(adminAuthBtn);
  panel.appendChild(changeAdminBtn);
  panel.appendChild(adminPanel);

  header.appendChild(panel);

  // restore current user if any
  const maybe = loadCurrentUser();
  if(maybe && accounts[maybe]) currentUser = maybe;
  refreshAccountListUI();
  renderAuthState();
}

function refreshAccountListUI(){
  const sel = document.getElementById("mini-user-select");
  if(!sel) return;
  // clear
  while(sel.firstChild) sel.removeChild(sel.firstChild);
  for(const name of Object.keys(accounts)){
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

function renderAuthState(){
  const panel = document.getElementById("mini-auth-panel");
  if(!panel) return;
  // show logged-in user visually by changing background of the username input
  const nameInput = document.getElementById("mini-username");
  if(currentUser){
    nameInput.style.background = "#e6f7ff";
    nameInput.value = currentUser;
  } else {
    nameInput.style.background = "";
  }
  // show admin marker
  const adminPanel = document.getElementById("mini-admin-panel");
  if(adminPanel){
    adminPanel.style.border = adminSession ? "1px solid gold" : "1px dashed transparent";
  }
  refreshAccountListUI();
}

// ---------------- integrate with existing game UI ----------------
function initGameUI(){
  // Hook existing elements if available: currency, pity, pulls, collection, result list
  const pull1Btn = document.getElementById("pull-1");
  const pull10Btn = document.getElementById("pull-10");
  const addCurrencyBtn = document.getElementById("add-currency");
  const changePwBtn = document.getElementById("change-admin-pw-btn");

  if(pull1Btn) pull1Btn.addEventListener("click", () => doPullsForCurrentUser(1));
  if(pull10Btn) pull10Btn.addEventListener("click", () => doPullsForCurrentUser(10));
  if(addCurrencyBtn){
    // make original "+100" admin-only: prompt for admin then add to current user
    addCurrencyBtn.addEventListener("click", async () => {
      if(!currentUser){
        alert("Not logged in. Ask admin to add funds to your account, or log in.");
        return;
      }
      if(!adminSession){
        const ok = await adminAuthenticatePrompt();
        if(!ok) return;
      }
      const acct = currentAcct();
      acct.currency = (acct.currency||0) + 100;
      saveAccount(currentUser, acct);
      renderGameForCurrentUser();
      alert("Added 100 currency to the currently logged-in user.");
    });
  }

  // If the existing "change admin pw" exists, hook it to proper flow
  if(changePwBtn){
    changePwBtn.addEventListener("click", async () => {
      await adminChangePasswordFlow();
    });
  }
}

function renderGameForCurrentUser(){
  const currencyEl = document.getElementById("currency");
  const pityEl = document.getElementById("pity");
  const collectionGrid = document.getElementById("collection-grid");
  const userLabel = document.getElementById("user-label");
  const acct = currentAcct();

  if(userLabel){
    userLabel.textContent = currentUser ? `User: ${currentUser}` : `Not signed in`;
  } else {
    // create a small label in header if not present
    const hud = document.querySelector(".hud");
    if(hud){
      const lbl = document.createElement("div");
      lbl.id = "user-label";
      lbl.style.marginLeft = "12px";
      lbl.textContent = currentUser ? `User: ${currentUser}` : `Not signed in`;
      hud.appendChild(lbl);
    }
  }

  if(currencyEl) currencyEl.textContent = acct ? (acct.currency || 0) : "—";
  if(pityEl) pityEl.textContent = acct ? (acct.pity || 0) : "—";
  if(collectionGrid){
    collectionGrid.innerHTML = "";
    for(const c of CHARACTERS){
      const count = acct ? (acct.inventory[c.id] || 0) : 0;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<div class="card-title">${c.name}</div>
                        <div class="card-rarity">Rarity: ${c.rarity}★</div>
                        <div>Owned: ${count}</div>`;
      collectionGrid.appendChild(card);
    }
  }
}

// ---------------- result display (reuses existing result-area if present) ----------------
function showResults(results){
  const resultArea = document.getElementById("result-area");
  const resultList = document.getElementById("result-list");
  if(!resultList) return;
  resultList.innerHTML = "";
  for(const r of results){
    const div = document.createElement("div");
    div.className = `result-item rarity-${r.rarity}`;
    div.innerHTML = `<div style="font-size:20px">${emojiForRarity(r.rarity)} </div>
                     <strong>${r.name}</strong>
                     <div class="muted">Rarity ${r.rarity}★</div>`;
    resultList.appendChild(div);
  }
  if(resultArea) resultArea.classList.remove("hidden");
}

function emojiForRarity(r){
  if(r===5) return "🌟";
  if(r===4) return "✨";
  return "⭐";
}