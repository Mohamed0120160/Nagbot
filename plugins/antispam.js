// ====================================================
// نظام Anti-Spam
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'

// ============================================================
// الإعدادات الافتراضية
// ============================================================
var DEFAULT_LIMIT      = 5      // عدد الرسائل المسموح بها
var DEFAULT_INTERVAL   = 4000   // المدة بالميلي ثانية (4 ثواني)
var DEFAULT_ACTION     = 'warn'
var DEFAULT_MUTE_TIME  = 600    // مدة الكتم بالثواني (10 دقائق)
var REPEAT_THRESHOLD   = 4      // عدد مرات تكرار نفس الرسالة لاعتبارها سبام
var REPEAT_WINDOW_MULT = 3      // نافذة فحص التكرار = spamInterval * عدد
var CLEANUP_RETENTION  = 5 * 60 * 1000 // مدة الاحتفاظ بالبيانات القديمة قبل تنظيفها
var CLEANUP_EVERY      = 30000  // كل قد ايه نشغل تنظيف الذاكرة

// ============================================================
// الذاكرة المؤقتة (تايمر واحد بس للبوت كله - مش setInterval لكل عضو)
// key = groupId + '|' + sender  ->  { entries: [{t, text}], muteUntil }
// ============================================================
var spamCache = new Map()

setInterval(function () {
  var now = Date.now()
  spamCache.forEach(function (data, key) {
    data.entries = data.entries.filter(function (e) { return now - e.t < CLEANUP_RETENTION })
    if (data.entries.length === 0 && (!data.muteUntil || data.muteUntil < now)) {
      spamCache.delete(key)
    }
  })
}, CLEANUP_EVERY)

// ============================================================
// دوال مساعدة
// ============================================================
function getGroupData(groupId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.groups) db.data.groups = {}
  if (!db.data.groups[groupId]) db.data.groups[groupId] = {}
  return db.data.groups[groupId]
}

function getUserData(userId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.users) db.data.users = {}
  if (!db.data.users[userId]) db.data.users[userId] = {}
  return db.data.users[userId]
}

function normalizeText(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// نظام الاستثناءات: Owner / Real Owner / Developers / Bot / Admin (اختياري) / Trusted
function isExempt(conn, m, participants, groupData) {
  if (m.fromMe) return true

  var botId = conn.user && conn.user.id ? conn.user.id.replace(/:.*@/, '@') : ''
  if (m.sender === botId) return true

  var ownerList = global.owner || []
  var isOwner = ownerList.some(function (o) { return (o[0] + '@s.whatsapp.net') === m.sender })
  if (isOwner) return true

  var skipAdmin = groupData ? groupData.antispamSkipAdmin !== false : true // مفعل افتراضيًا
  if (skipAdmin && participants && participants.length) {
    var senderInfo = participants.find(function (p) { return p.id === m.sender })
    if (senderInfo && senderInfo.admin) return true
  }

  // مستخدمين موثوقين من النظام المركزي (لو موجود)
  var userData = global.db?.data?.users?.[m.sender]
  if (userData && userData.trusted) return true

  return false
}

async function tryKick(conn, groupId, userId) {
  try {
    var groupMetadata = (conn.chats[groupId] || {}).metadata || (await conn.groupMetadata(groupId))
    var participants  = groupMetadata.participants || []
    var botId      = conn.user.id.replace(/:.*@/, '@')
    var botData    = participants.find(function (p) { return p.id === botId })
    var isBotAdmin = botData ? !!botData.admin : false

    if (!isBotAdmin) {
      await conn.sendMessage(groupId, { text: 'البوت ليس ادمن، لا يمكن طرد المستخدم!' })
      return
    }
    await conn.groupParticipantsUpdate(groupId, [userId], 'remove')
    await conn.sendMessage(groupId, {
      text: 'تم طرد @' + userId.replace('@s.whatsapp.net', '') + ' بسبب السبام المتكرر',
      mentions: [userId]
    })
  } catch (e) {
    console.error('[AntiSpam] Kick failed:', e.message)
  }
}

async function executeAction(conn, m, groupId, groupData, cache, action, reason, groupName) {
  var senderNumber = m.sender.replace('@s.whatsapp.net', '')
  var actionLabel  = action

  switch (action) {
    case 'delete':
      await conn.sendMessage(groupId, { delete: m.key }).catch(function () {})
      break

    case 'warn': {
      // عدد الإنذارات بيتاخد من نظام warnings المركزي (مفيش نظام إنذارات جديد هنا)
      var userData = getUserData(m.sender)
      var warnKey  = 'warn_' + groupId
      userData[warnKey] = (userData[warnKey] || 0) + 1
      var warnCount = userData[warnKey]

      if (warnCount >= 3) {
        await tryKick(conn, groupId, m.sender)
        actionLabel = 'kick (3rd warning)'
        userData[warnKey] = 0
      } else {
        actionLabel = 'warn (' + warnCount + '/3)'
        await conn.sendMessage(groupId, {
          text: '⚠️ *تم رصد سبام*\n\n' +
                'العضو:\n@' + senderNumber + '\n\n' +
                'السبب:\n' + reason + '\n\n' +
                'الإنذار:\n' + warnCount + '/3',
          mentions: [m.sender]
        })
      }
      break
    }

    case 'mute': {
      var muteSeconds = groupData.spamMuteDuration || DEFAULT_MUTE_TIME
      cache.muteUntil = Date.now() + muteSeconds * 1000
      await conn.sendMessage(groupId, { delete: m.key }).catch(function () {})
      await conn.sendMessage(groupId, {
        text: '🔇 *تم كتم العضو*\n\n' +
              '@' + senderNumber + '\n\n' +
              'السبب:\n' + reason + '\n\n' +
              'مدة الكتم:\n' + Math.round(muteSeconds / 60) + ' دقيقة',
        mentions: [m.sender]
      })
      break
    }

    case 'kick':
      await tryKick(conn, groupId, m.sender)
      break
  }

  await sendSecurityLog(conn, groupId, {
    groupName: groupName || 'غير معروف',
    userId:    m.sender,
    action:    actionLabel,
    reason:    'Antispam: ' + reason,
  })
}

// ============================================================
// Handler الأوامر
// ============================================================
let handler = async (m, { conn, usedPrefix, command, args }) => {

  var groupId = m.chat
  if (!groupId.endsWith('@g.us')) return m.reply('هذا الامر يعمل داخل الجروبات فقط!')

  var groupMetadata, participants
  try {
    groupMetadata = await conn.groupMetadata(groupId)
    participants  = groupMetadata.participants || []
  } catch (e) {
    return m.reply('حدث خطأ في جلب بيانات الجروب')
  }

  var senderInfo = participants.find(function (p) { return p.id === m.sender })
  var isAdmin    = senderInfo ? !!senderInfo.admin : false
  var ownerList  = global.owner ? global.owner.map(function (o) { return o[0] + '@s.whatsapp.net' }) : []
  var isBotOwner = ownerList.includes(m.sender)

  if (!isAdmin && !isBotOwner) return m.reply('هذا الامر للادمن فقط!')

  var groupData = getGroupData(groupId)
  if (!groupData) return m.reply('خطأ في قاعدة البيانات!')

  if (command === 'antispam') {
    var sub = args[0] ? args[0].toLowerCase() : ''

    if (sub === 'on') {
      groupData.antispam     = true
      groupData.spamLimit    = groupData.spamLimit    || DEFAULT_LIMIT
      groupData.spamInterval = groupData.spamInterval || DEFAULT_INTERVAL
      groupData.spamAction   = groupData.spamAction   || DEFAULT_ACTION
      return conn.sendMessage(groupId, {
        text: '*تم تفعيل نظام Anti-Spam!*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'الحد: ' + groupData.spamLimit + ' رسائل / ' + (groupData.spamInterval / 1000) + ' ثواني\n' +
              'العقوبة: ' + groupData.spamAction + '\n\n' +
              'لتغيير الإعدادات:\n' +
              usedPrefix + 'spamlimit <عدد>\n' +
              usedPrefix + 'spaminterval <ثواني>\n' +
              usedPrefix + 'spamaction <warn/delete/mute/kick>'
      }, { quoted: m })
    }

    if (sub === 'off') {
      groupData.antispam = false
      return conn.sendMessage(groupId, {
        text: '*تم ايقاف نظام Anti-Spam!*\n\nالجروب: ' + groupMetadata.subject
      }, { quoted: m })
    }

    return conn.sendMessage(groupId, {
      text: '*حالة نظام Anti-Spam:*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'الحالة: ' + (groupData.antispam ? 'مفعّل ✅' : 'موقف ❌') + '\n' +
            'الحد: ' + (groupData.spamLimit || DEFAULT_LIMIT) + ' رسائل\n' +
            'المدة: ' + ((groupData.spamInterval || DEFAULT_INTERVAL) / 1000) + ' ثواني\n' +
            'العقوبة: ' + (groupData.spamAction || DEFAULT_ACTION) + '\n\n' +
            'الاوامر:\n' +
            usedPrefix + 'antispam on\n' +
            usedPrefix + 'antispam off\n' +
            usedPrefix + 'spamlimit <عدد>\n' +
            usedPrefix + 'spaminterval <ثواني>\n' +
            usedPrefix + 'spamaction <warn/delete/mute/kick>'
    }, { quoted: m })
  }

  if (command === 'spamlimit') {
    var n = parseInt(args[0])
    if (!n || n < 2) return m.reply('من فضلك ادخل عدد صحيح اكبر من 1\nمثال: ' + usedPrefix + 'spamlimit 5')
    groupData.spamLimit = n
    return m.reply('تم تعيين حد الرسائل الى ' + n)
  }

  if (command === 'spaminterval') {
    var sec = parseFloat(args[0])
    if (!sec || sec <= 0) return m.reply('من فضلك ادخل عدد الثواني\nمثال: ' + usedPrefix + 'spaminterval 4')
    groupData.spamInterval = Math.round(sec * 1000)
    return m.reply('تم تعيين مدة الفحص الى ' + sec + ' ثواني')
  }

  if (command === 'spamaction') {
    var act   = args[0] ? args[0].toLowerCase() : ''
    var valid = ['warn', 'delete', 'mute', 'kick']
    if (!valid.includes(act)) {
      return m.reply('عقوبة غير صحيحة!\n\n' + valid.map(function (v) { return usedPrefix + 'spamaction ' + v }).join('\n'))
    }
    groupData.spamAction = act
    return m.reply('تم تغيير عقوبة السبام الى: ' + act)
  }
}

// ============================================================
// all() — بيشتغل على كل رسالة (بدون اوامر)
// ✅ handler.js بيبعت all() فقط: { chatUpdate, __dirname, __filename }
// ✅ مش بيبعت conn — لازم نستخدم (this) بدلاً منه
// ============================================================
handler.all = async function (m, { chatUpdate }) {
  var conn = this

  try {
    if (!m.chat.endsWith('@g.us')) return
    if (m.isBaileys) return

    var groupId   = m.chat
    var groupData = getGroupData(groupId)
    if (!groupData || !groupData.antispam) return

    var cacheKey = groupId + '|' + m.sender
    var cache    = spamCache.get(cacheKey)
    if (!cache) {
      cache = { entries: [], muteUntil: 0 }
      spamCache.set(cacheKey, cache)
    }

    // لو العضو متكتم بالفعل - امسح اي رسالة منه لحد ما تنتهي مدة الكتم
    if (cache.muteUntil && cache.muteUntil > Date.now()) {
      await conn.sendMessage(groupId, { delete: m.key }).catch(function () {})
      return
    }

    // بيانات الجروب من الكاش (بدون طلب شبكة لكل رسالة - للحفاظ على الأداء)
    var groupMetadata = (conn.chats[groupId] || {}).metadata || {}
    var participants  = groupMetadata.participants || []

    if (isExempt(conn, m, participants, groupData)) return

    var msgText  = m.text || (m.msg && (m.msg.caption || m.msg.text)) || ''
    var now      = Date.now()
    var interval = groupData.spamInterval || DEFAULT_INTERVAL
    var limit    = groupData.spamLimit    || DEFAULT_LIMIT
    var action   = groupData.spamAction   || DEFAULT_ACTION

    cache.entries.push({ t: now, text: normalizeText(msgText) })

    // نظافة تلقائية: نشيل اي رسالة اقدم من نافذة فحص التكرار
    var repeatWindow = interval * REPEAT_WINDOW_MULT
    cache.entries = cache.entries.filter(function (e) { return now - e.t < repeatWindow })

    // 1) فحص معدل الرسائل خلال spamInterval
    var withinInterval = cache.entries.filter(function (e) { return now - e.t < interval })
    var rateSpam = withinInterval.length >= limit

    // 2) فحص الرسائل المتكررة (نسخ ولصق) حتى لو العدد اقل من الحد
    var normalized     = normalizeText(msgText)
    var sameTextCount  = normalized ? cache.entries.filter(function (e) { return e.text === normalized }).length : 0
    var repeatThreshold = Math.min(limit, REPEAT_THRESHOLD)
    var repeatSpam = sameTextCount >= repeatThreshold

    if (!rateSpam && !repeatSpam) return

    var reason = rateSpam
      ? (withinInterval.length + ' رسائل خلال ' + (interval / 1000) + ' ثواني')
      : ('رسائل متكررة (' + sameTextCount + ' مرات)')

    // نصفّر السجل بعد الرصد لمنع تكرار العقوبة على نفس الدفعة
    cache.entries = []

    await executeAction(conn, m, groupId, groupData, cache, action, reason, groupMetadata.subject)

  } catch (err) {
    console.error('[AntiSpam] Error:', err.message)
  }
}

// ============================================================
handler.help    = ['antispam <on/off>', 'spamlimit <عدد>', 'spaminterval <ثواني>', 'spamaction <warn/delete/mute/kick>']
handler.tags    = ['group', 'security']
handler.command = ['antispam', 'spamlimit', 'spaminterval', 'spamaction']

handler.group    = false
handler.admin    = false
handler.botAdmin = false

handler.type = 'protection'

export default handler
