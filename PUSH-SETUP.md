# NurMakon — To'lov so'rovlari uchun bildirishnoma (sozlash)

Bu hujjat ikkita bildirishnoma turini yoqishni tushuntiradi:

- **4-variant — ilova ichida ovoz + belgi (badge):** *hech qanday sozlash kerak emas, allaqachon ishlaydi.* Admin tizimga kirganida, yangi to'lov so'rovi tushsa "ding" ovozi chiqadi, admin tugmasida qizil hisoblagich ko'rinadi va toast chiqadi.
- **1-variant — FCM push (ilova yopiq bo'lsa ham telefonga xabar):** quyidagi 3 qadamni bajarish kerak. Hammasi **bepul**.

---

## 0. Avval: Firestore qoidalarini yangilash (muhim, bepul)

`firestore.rules` fayli yangilandi — endi foydalanuvchi o'z balansini (`credits`), rejasini (`plan`) yoki admin huquqini (`isAdmin`) o'zi ko'tara olmaydi.

Yangilashni chop etish:
1. Firebase Console → **Firestore Database → Rules**.
2. `firestore.rules` faylidagi matnni to'liq nusxalab qo'ying → **Publish**.

---

## 1-QADAM — VAPID kalitini olish (Web Push)

1. [Firebase Console](https://console.firebase.google.com) → loyihangiz → ⚙️ **Project settings**.
2. **Cloud Messaging** tabini oching.
3. **Web configuration** → **Web Push certificates** → **Generate key pair** (yoki mavjud kalitni nusxalang).
4. Chiqqan kalitni (`B...` bilan boshlanadi) nusxalang.
5. `index.html` faylida shu qatorni toping va kalitni qo'ying:

   ```js
   const PUSH_VAPID_KEY = ""; // <-- shu yerga qo'ying
   ```

   Masalan: `const PUSH_VAPID_KEY = "BLxx...uzun_kalit...";`

> Shu qadamdan keyin: admin tizimga kirganda brauzer bildirishnomaga ruxsat so'raydi. Ruxsat bergач, admin FCM tokeni `adminConfig/push` hujjatiga saqlanadi.

---

## 2-QADAM — Service account faylini olish

Push **yuborish** uchun serverga Firebase kaliti kerak:

1. Firebase Console → ⚙️ **Project settings** → **Service accounts**.
2. **Generate new private key** → **Generate key**. `.json` fayl yuklab olinadi.
3. Bu faylni **maxfiy saqlang** (hech qayerga oshkor qilmang, GitHubga qo'ymang).

---

## 3-QADAM — Cloudflare Worker'ni joylash (bepul)

Worker kodi `push-server/` papkasida tayyor.

### A) Cloudflare hisob (bepul, karta kerak emas)
1. https://dash.cloudflare.com → ro'yxatdan o'ting.

### B) Wrangler bilan joylash (kompyuterda)
```bash
# 1) Wrangler o'rnatish (Node.js kerak)
npm install -g wrangler

# 2) Cloudflare'ga kirish
wrangler login

# 3) push-server papkasiga o'tish
cd push-server

# 4) Service account JSON ni maxfiy o'zgaruvchi sifatida qo'shish
#    (fayl matnini so'raganda, yuklab olgan .json faylini oching va butun matnini joylang)
wrangler secret put FIREBASE_SA

# 5) Joylash
wrangler deploy
```

Tayyor! Worker har daqiqada yangi to'lov so'rovlarini tekshirib, adminga push yuboradi.

### Tekshirish
- Worker joylangач, Cloudflare bergan URL'ni brauzerda oching — `OK, yuborildi: N` chiqadi.
- Maklerdan sinov "Balansni to'ldirish" so'rovi yuboring → 1 daqiqa ichida telefoningizga push kelishi kerak.

---

## Ishlash mantig'i (qisqacha)

1. Makler "Balansni to'ldirish" bosadi → `topups` ga `status: 'pending'` so'rov tushadi.
2. **Ilova ochiq bo'lsa** (4-variant): admin darhol ovoz + belgi + toast ko'radi.
3. **Ilova yopiq bo'lsa** (1-variant): Worker 1 daqiqa ichida topib, telefonga push yuboradi.
4. Admin bildirishnomani bosadi → ilova ochiladi → Admin panel → bir bosishda tasdiqlaydi.

## Xarajat
- Firebase Cloud Messaging: **bepul**.
- Cloudflare Workers + Cron: **bepul** reja yetarli (kuniga 100k so'rov, karta kerak emas).

## Keyingi bosqich (kelajakda)
To'liq avtomatik to'lov (Payme/Click) uchun yuridik shaxs/YaTT va merchant shartnoma kerak bo'ladi — daromad paydo bo'lgach ulaymiz.
