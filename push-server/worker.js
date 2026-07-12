/* ============================================================
   NurMakon — To'lov so'rovi PUSH yuboruvchi (Cloudflare Worker)
   ------------------------------------------------------------
   Har daqiqada yangi (notified != true) 'pending' to'lov so'rovlarini
   tekshiradi va admin(lar)ning FCM tokenlariga push bildirishnoma yuboradi.
   Yuborilgach, so'rovni 'notified: true' deb belgilaydi (takror yubormaslik uchun).

   Kerakli maxfiy o'zgaruvchi (secret):
     FIREBASE_SA  — Firebase service account JSON (butun matn)

   BEPUL: Cloudflare Workers Free reja + Cron Triggers yetarli.
   Sozlash yo'riqnomasi: ../PUSH-SETUP.md
   ============================================================ */

export default {
  // Cron bo'yicha (har daqiqa) avtomatik ishlaydi
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Qo'lda tekshirish uchun HTTP trigger (ixtiyoriy): worker URL ni brauzerda ochsangiz ishlaydi
  async fetch(req, env) {
    try { const n = await run(env); return new Response('OK, yuborildi: ' + n); }
    catch (e) { return new Response('Xato: ' + e.message, { status: 500 }); }
  }
};

async function run(env) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const projectId = sa.project_id;
  const accessToken = await getAccessToken(sa);

  const adminTokens = await getAdminTokens(projectId, accessToken);
  if (!adminTokens.length) return 0;

  const topups = await getPendingTopups(projectId, accessToken);
  let sent = 0;
  for (const tp of topups) {
    const body = buildBody(tp.fields);
    for (const fcmToken of adminTokens) {
      await sendPush(projectId, accessToken, fcmToken, body);
    }
    await markNotified(projectId, accessToken, tp.name);
    sent++;
  }
  return sent;
}

/* ---- Service account -> OAuth access token (RS256 JWT) ---- */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlBytes(new Uint8Array(sig));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token olinmadi: ' + JSON.stringify(j));
  return j.access_token;
}

/* ---- adminConfig/push hujjatidan admin FCM tokenlarini o'qish ---- */
async function getAdminTokens(projectId, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/adminConfig/push`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) return [];
  const j = await res.json();
  const vals = j.fields && j.fields.tokens && j.fields.tokens.arrayValue && j.fields.tokens.arrayValue.values;
  return (vals || []).map(v => v.stringValue).filter(Boolean);
}

/* ---- status == 'pending' va notified != true bo'lgan so'rovlar ---- */
async function getPendingTopups(projectId, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'topups' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
      limit: 20
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  const rows = await res.json();
  const out = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row.document) continue;
    const f = row.document.fields || {};
    if (f.notified && f.notified.booleanValue === true) continue; // allaqachon yuborilgan
    out.push({ name: row.document.name, fields: f });
  }
  return out;
}

function buildBody(f) {
  const name = (f.brokerName && f.brokerName.stringValue) || 'Makler';
  const premium = f.premium && f.premium.booleanValue === true;
  const credits = (f.credits && (f.credits.integerValue || f.credits.doubleValue)) || 0;
  const amount = (f.amount && f.amount.stringValue) || '';
  const what = premium ? 'Premium obuna' : (credits + ' kredit');
  return `${name} — ${what}${amount ? (' · ' + amount + " so'm") : ''}`;
}

/* ---- FCM HTTP v1 orqali bitta tokenga push ---- */
async function sendPush(projectId, accessToken, fcmToken, body) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const title = "💳 Yangi to'lov so'rovi";
  const msg = {
    message: {
      token: fcmToken,
      notification: { title, body },
      webpush: {
        notification: { title, body, icon: 'icon.svg', badge: 'icon.svg', tag: 'nm-topup' },
        fcm_options: { link: '/' }
      }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  return res.ok;
}

/* ---- so'rovni notified:true deb belgilash ---- */
async function markNotified(projectId, accessToken, docName) {
  const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=notified`;
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { notified: { booleanValue: true } } })
  });
}

/* ---- Yordamchi: base64url ---- */
function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function importKey(pem) {
  const clean = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}
