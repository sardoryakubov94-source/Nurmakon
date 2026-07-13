/* ============================================================
   NurMakon — To'lov so'rovi PUSH yuboruvchi (Cloudflare Worker)
   ------------------------------------------------------------
   Har daqiqada yangi (notified != true) 'pending' to'lov so'rovlarini
   tekshiradi va admin(lar)ning FCM tokenlariga push bildirishnoma yuboradi.
   Yuborilgach, so'rovni 'notified: true' deb belgilaydi (takror yubormaslik uchun).

   Ilovadagi topups hujjati maydonlari (tekshirilgan):
     brokerUid (string), brokerName (string), credits (number),
     premium (boolean), amount (string), status ('pending'|'approved'|'rejected')

   Kerakli maxfiy o'zgaruvchi (secret):
     FIREBASE_SA  — Firebase service account JSON (butun matn)

   TEST: Worker URL'ini brauzerda ochsangiz, JSON diagnostika qaytaradi
         (nechta admin token, nechta pending so'rov, nechta yuborildi).
   BEPUL: Cloudflare Workers Free reja + Cron Triggers yetarli.
   ============================================================ */

export default {
  // Cron bo'yicha (har daqiqa) avtomatik ishlaydi
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Qo'lda tekshirish uchun HTTP trigger: worker URL ni brauzerda ochsangiz ishlaydi
  async fetch(req, env) {
    const out = await run(env, true);
    return new Response(JSON.stringify(out, null, 2), {
      status: out.error ? 500 : 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};

async function run(env, verbose = false) {
  const log = { adminTokens: 0, pending: 0, sent: 0 };
  try {
    if (!env.FIREBASE_SA) throw new Error("FIREBASE_SA secret o'rnatilmagan");
    const sa = JSON.parse(env.FIREBASE_SA);
    const projectId = sa.project_id;
    const accessToken = await getAccessToken(sa);

    const adminTokens = await getAdminTokens(projectId, accessToken);
    log.adminTokens = adminTokens.length;
    if (!adminTokens.length) {
      if (verbose) log.note = "adminConfig/push da token yo'q — admin ilovaga kirib, bildirishnomaga ruxsat berishi kerak";
      return verbose ? log : 0;
    }

    const topups = await getPendingTopups(projectId, accessToken);
    log.pending = topups.length;

    const results = [];
    for (const tp of topups) {
      const body = buildBody(tp.fields);
      for (const fcmToken of adminTokens) {
        const r = await sendPush(projectId, accessToken, fcmToken, body);
        if (verbose) results.push({ body, ok: r.ok, error: r.error });
      }
      await markNotified(projectId, accessToken, tp.name);
      log.sent++;
    }
    if (verbose) log.results = results;
    return verbose ? log : log.sent;
  } catch (e) {
    if (verbose) { log.error = e.message; return log; }
    throw e;
  }
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
  if (!j.access_token) throw new Error('OAuth token olinmadi: ' + JSON.stringify(j));
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
      limit: 25
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

/* ---- topups maydonlaridan bildirishnoma matnini yasash (ilovaga mos) ---- */
function buildBody(f) {
  const name = (f.brokerName && f.brokerName.stringValue) || 'Makler';
  const premium = f.premium && f.premium.booleanValue === true;
  // Firestore REST: butun son integerValue (string), kasr doubleValue
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
        notification: { title, body, icon: 'icon.svg', badge: 'icon.svg', tag: 'nm-topup', requireInteraction: true },
        fcm_options: { link: '/' }
      }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  if (res.ok) return { ok: true };
  let err = '';
  try { err = JSON.stringify(await res.json()); } catch (e) { err = 'HTTP ' + res.status; }
  return { ok: false, error: err };
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

/* ---- Yordamchi: base64url + RSA kalit ---- */
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
