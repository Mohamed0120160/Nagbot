// ====================================================
// 🚫 Anti-Bad Word System
// أوامر: antibadword / antibadwordmode / antibadwordmaxwarn /
//        antibadwordmatch / antibadwordignoreadmins /
//        addbadword / delbadword / badwords / clearbadwords /
//        bwarn / resetbwarn
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'

// ============================================================
// ⚙️ ثوابت عامة
// ============================================================
const DEFAULT_MAX_WARN = 3
const COOLDOWN_MS      = 8 * 1000        // تجميع عقوبات الإرسال المتكرر خلال 8 ثواني
const WARN_DECAY_MS    = 48 * 60 * 60 * 1000 // تصفير الإنذارات تلقائيا بعد 48 ساعة
const CACHE_TTL_MS     = 5 * 60 * 1000   // مدة كاش قائمة الكلمات المحظورة

// قائمة افتراضية صغيرة جدا (يفضل ترك القائمة الافتراضية محدودة)
// يمكن للأدمن إضافة كلماته الخاصة عبر addbadword
const DEFAULT_BADWORDS = [
  // سباب عربي
  'وسخ',
  'قذر',
  'نذل',
  'واطي',
  'سافل',
  'متخلف',
  'عرص',
  'خول',
  'شرموط',
  'شرموطة',
  'كسم',
  'كسمك',
  'كسمكم',

  // سباب إنجليزي
  'idiot',
  'stupid',
  'dumb',
  'moron',
  'loser',
  'bastard',
  'bitch',
  'fuck',
  'fucking',

  // كلمات مرتبطة بالمحتوى الجنسي/الإباحي
  'sex',
  'sexy',
  'xxx',
  'porn',
  'nsfw',
  'hentai',
  'adult',
  '18+'
]

// ============================================================
// 🗄️ كاش داخلي بالميموري (يقلل القراءة من قاعدة البيانات)
// ============================================================
const badwordsCacheStore = new Map() // groupId -> { list, expireAt }
const cooldownStore      = new Map() // groupId_userId -> timestamp

function getCachedBadwords(groupId, groupData) {
  var cached = badwordsCacheStore.get(groupId)
  var now    = Date.now()
  if (cached && cached.expireAt > now) return cached.list

  var custom = Array.isArray(groupData.badwords) ? groupData.badwords : []
  var list   = DEFAULT_BADWORDS.concat(custom)
  badwordsCacheStore.set(groupId, { list: list, expireAt: now + CACHE_TTL_MS })
  return list
}

function invalidateBadwordsCache(groupId) {
  badwordsCacheStore.delete(groupId)
}

function isInCooldown(groupId, userId) {
  var key  = groupId + '_' + userId
  var last = cooldownStore.get(key)
  return !!(last && (Date.now() - last) < COOLDOWN_MS)
}

function setCooldown(groupId, userId) {
  cooldownStore.set(groupId + '_' + userId, Date.now())
}

// ============================================================
// 🗃️ دوال قاعدة البيانات
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

// ============================================================
// ⚠️ نظام الإنذارات الخاص بـ antibadword
// (كل إنذار مرتبط بوقته، ويُصفّر تلقائيا بعد 48 ساعة من عدم التحديث)
// ملحوظة: لو البوت عنده نظام إنذارات عام مركزي بالفعل، يفضل ربط
// هذه الدوال به بدل التخزين المستقل تحت badwordWarns.
// ============================================================
function getWarnBucket(userId) {
  var userData = getUserData(userId)
  if (!userData) return null
  if (!userData.badwordWarns) userData.badwordWarns = {}
  return userData.badwordWarns
}

function decayIfNeeded(entry) {
  if (!entry) return entry
  var now = Date.now()
  if (entry.count > 0 && entry.lastTime && (now - entry.lastTime) > WARN_DECAY_MS) {
    entry.count = 0
  }
  return entry
}

function getWarnCount(userId, groupId) {
  var bucket = getWarnBucket(userId)
  if (!bucket) return 0
  if (!bucket[groupId]) bucket[groupId] = { count: 0, lastTime: 0 }
  decayIfNeeded(bucket[groupId])
  return bucket[groupId].count
}

function addWarn(userId, groupId) {
  var bucket = getWarnBucket(userId)
  if (!bucket) return 1
  if (!bucket[groupId]) bucket[groupId] = { count: 0, lastTime: 0 }
  decayIfNeeded(bucket[groupId])
  bucket[groupId].count += 1
  bucket[groupId].lastTime = Date.now()
  return bucket[groupId].count
}

function resetWarn(userId, groupId) {
  var bucket = getWarnBucket(userId)
  if (!bucket) return
  bucket[groupId] = { count: 0, lastTime: Date.now() }
}

// ============================================================
// 🧹 تنظيف النص لمواجهة التحايل (مسافات/نقاط/شرطات/تطويل...)
// ============================================================
function cleanText(text) {
  if (!text) return ''
  return text
    .toString()
    .toLowerCase()
    // محارف غير ظاهرة (Zero-width) تستخدم للتحايل
    .replace(/[\u200B-\u200F\uFEFF\u00AD]/g, '')
    // تشكيل عربي + تطويل (كشيدة) يستخدم لتمديد الحروف
    .replace(/[\u0617-\u061A\u064B-\u0652\u0670\u0640]/g, '')
    // علامات ترقيم/رموز شائعة تُستخدم كفواصل للتحايل (ك.ل.م.ة / ك-ل-م-ة)
    .replace(/[.\-_*~`'"!@#$%^&+=|\\\/:;,<>?(){}\[\]،؛؟“”‘’]/g, '')
}

// كشف التحايل بمسافات حقيقية بين الحروف: "ك ل م ة"
function detectSpacedEvasion(cleanedText, badwordCompact) {
  var tokens = cleanedText.split(/\s+/).filter(Boolean)
  var i = 0
  while (i < tokens.length) {
    if (tokens[i].length <= 2) {
      var j = i, concat = ''
      while (j < tokens.length && tokens[j].length <= 2 && concat.length <= badwordCompact.length) {
        concat += tokens[j]
        if (concat === badwordCompact) return true
        j++
      }
    }
    i++
  }
  return false
}

/**
 * يبحث عن كلمة محظورة داخل نص الرسالة
 * @returns {string|null} الكلمة (كما هي مكتوبة في القائمة) لو وُجدت، أو null
 */
function findBadWord(text, badwordsList, matchMode) {
  if (!text || !badwordsList || !badwordsList.length) return null
  var cleaned = cleanText(text)
  if (!cleaned.trim()) return null
  var tokens = cleaned.split(/\s+/).filter(Boolean)

  for (var k = 0; k < badwordsList.length; k++) {
    var raw = badwordsList[k]
    var bw  = cleanText(raw).replace(/\s+/g, '')
    if (!bw) continue

    if (matchMode === 'full') {
      if (tokens.indexOf(bw) !== -1) return raw
    } else {
      if (cleaned.includes(bw)) return raw
    }

    // كشف التحايل بمسافات بين الحروف (يطبق دائما بغض النظر عن نوع المطابقة)
    if (bw.length >= 2 && detectSpacedEvasion(cleaned, bw)) return raw
  }
  return null
}

// ============================================================
// 🛂 استثناءات (مالك البوت / مطور / أدمن لو مفعل التجاهل)
// ============================================================
function isExemptUser(m, participants, groupData) {
  var ownerList = global.owner ? global.owner.map(function(o) { return o[0] + '@s.whatsapp.net' }) : []
  if (ownerList.includes(m.sender)) return true

  var senderData = participants.find(function(p) { return p.id === m.sender })
  var isAdmin    = senderData ? !!senderData.admin : false
  var ignoreAdmins = groupData.antibadwordIgnoreAdmins !== false // افتراضيا: مفعل

  if (isAdmin && ignoreAdmins) return true
  return false
}

// ============================================================
// 👮 الطرد
// ============================================================
async function tryKick(conn, groupId, participants, userId, senderNumber) {
  var botId      = conn.user.id.replace(/:.*@/, '@')
  var botData    = participants.find(function(p) { return p.id === botId })
  var isBotAdmin = botData ? !!botData.admin : false

  if (!isBotAdmin) {
    await conn.sendMessage(groupId, { text: 'البوت ليس ادمن، لا يمكن طرد المستخدم!' })
    return false
  }

  await conn.groupParticipantsUpdate(groupId, [userId], 'remove')
  await conn.sendMessage(groupId, {
    text: 'تم طرد @' + senderNumber + ' بسبب استخدام كلمة محظورة',
    mentions: [userId]
  })
  return true
}

// ============================================================
// 🎛️ Handler الأوامر
// ============================================================
let handler = async (m, { conn, usedPrefix, command, args, text }) => {

  var groupId = m.chat
  if (!groupId.endsWith('@g.us')) return m.reply('هذا الامر يعمل داخل الجروبات فقط!')

  var groupMetadata, participants
  try {
    groupMetadata = await conn.groupMetadata(groupId)
    participants  = groupMetadata.participants || []
  } catch (e) {
    return m.reply('حدث خطأ في جلب بيانات الجروب')
  }

  var senderInfo = participants.find(function(p) { return p.id === m.sender })
  var isAdmin    = senderInfo ? !!senderInfo.admin : false
  var ownerList  = global.owner ? global.owner.map(function(o) { return o[0] + '@s.whatsapp.net' }) : []
  var isBotOwner = ownerList.includes(m.sender)

  if (!isAdmin && !isBotOwner) return m.reply('هذا الامر للادمن فقط!')

  var groupData = getGroupData(groupId)
  if (!groupData) return m.reply('خطأ في قاعدة البيانات!')
  if (!Array.isArray(groupData.badwords)) groupData.badwords = []

  // ── antibadword on/off/status ────────────────────────────
  if (command === 'antibadword') {
    var sub = args[0] ? args[0].toLowerCase() : ''
    var modeLabels = { delete: 'حذف فقط', warn: 'حذف + تحذير', kick: 'حذف + طرد مباشر', warnkick: 'حذف + تحذير ثم طرد' }

    if (sub === 'on') {
      groupData.antibadword = true
      if (!groupData.antibadwordMode) groupData.antibadwordMode = 'delete'
      return conn.sendMessage(groupId, {
        text: '*تم تفعيل نظام Anti-BadWord!*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'الوضع الحالي: ' + modeLabels[groupData.antibadwordMode] + '\n\n' +
              'لتغيير الوضع:\n' +
              usedPrefix + 'antibadwordmode delete\n' +
              usedPrefix + 'antibadwordmode warn\n' +
              usedPrefix + 'antibadwordmode kick\n' +
              usedPrefix + 'antibadwordmode warnkick'
      }, { quoted: m })
    }

    if (sub === 'off') {
      groupData.antibadword = false
      return conn.sendMessage(groupId, {
        text: '*تم ايقاف نظام Anti-BadWord!*\n\nالجروب: ' + groupMetadata.subject
      }, { quoted: m })
    }

    return conn.sendMessage(groupId, {
      text: '*حالة نظام Anti-BadWord:*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'الحالة: ' + (groupData.antibadword ? 'مفعّل' : 'موقف') + '\n' +
            'الوضع: ' + (groupData.antibadwordMode || 'delete') + '\n' +
            'نوع المطابقة: ' + (groupData.antibadwordMatch || 'contains') + '\n' +
            'الحد الأقصى للإنذارات: ' + (groupData.antibadwordMaxWarn || DEFAULT_MAX_WARN) + '\n' +
            'تجاهل الأدمن: ' + (groupData.antibadwordIgnoreAdmins !== false ? 'مفعل' : 'موقف') + '\n' +
            'عدد الكلمات المخصصة: ' + groupData.badwords.length + '\n\n' +
            'الاوامر:\n' +
            usedPrefix + 'antibadword on / off\n' +
            usedPrefix + 'antibadwordmode delete|warn|kick|warnkick\n' +
            usedPrefix + 'antibadwordmaxwarn <رقم>\n' +
            usedPrefix + 'antibadwordmatch full|contains\n' +
            usedPrefix + 'antibadwordignoreadmins on|off\n' +
            usedPrefix + 'addbadword <كلمة>\n' +
            usedPrefix + 'delbadword <كلمة>\n' +
            usedPrefix + 'badwords\n' +
            usedPrefix + 'clearbadwords\n' +
            usedPrefix + 'bwarn [منشن]\n' +
            usedPrefix + 'resetbwarn [منشن]'
    }, { quoted: m })
  }

  // ── antibadwordmode ───────────────────────────────────────
  if (command === 'antibadwordmode') {
    var sub = args[0] ? args[0].toLowerCase() : ''
    var validModes = {
      delete:   'حذف الرسالة فقط',
      warn:     'حذف الرسالة + تحذير',
      kick:     'حذف الرسالة + طرد مباشر',
      warnkick: 'حذف + تحذير، وعند الوصول للحد الأقصى يتم الطرد',
    }
    if (!validModes[sub]) {
      return m.reply('وضع غير صحيح!\n\n' +
        usedPrefix + 'antibadwordmode delete\n' +
        usedPrefix + 'antibadwordmode warn\n' +
        usedPrefix + 'antibadwordmode kick\n' +
        usedPrefix + 'antibadwordmode warnkick')
    }
    groupData.antibadwordMode = sub
    return conn.sendMessage(groupId, {
      text: '*تم تغيير وضع Anti-BadWord!*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'الوضع الجديد: ' + sub + '\n' +
            'التفاصيل: ' + validModes[sub]
    }, { quoted: m })
  }

  // ── antibadwordmaxwarn ─────────────────────────────────────
  if (command === 'antibadwordmaxwarn' || command === 'bwmaxwarn') {
    var n = parseInt(args[0])
    if (!n || n < 1) {
      return m.reply('حدد عدد صحيح اكبر من 0!\nمثال: ' + usedPrefix + 'antibadwordmaxwarn 3')
    }
    groupData.antibadwordMaxWarn = n
    return conn.sendMessage(groupId, {
      text: '*تم تحديد الحد الأقصى للإنذارات!*\n\nالجروب: ' + groupMetadata.subject + '\nالحد الأقصى: ' + n
    }, { quoted: m })
  }

  // ── antibadwordmatch ───────────────────────────────────────
  if (command === 'antibadwordmatch' || command === 'bwmatch') {
    var sub = args[0] ? args[0].toLowerCase() : ''
    if (sub !== 'full' && sub !== 'contains') {
      return m.reply('اختر نوع المطابقة:\n\n' +
        usedPrefix + 'antibadwordmatch full      (مطابقة كاملة للكلمة)\n' +
        usedPrefix + 'antibadwordmatch contains  (اكتشاف الكلمة داخل نص اطول)')
    }
    groupData.antibadwordMatch = sub
    return conn.sendMessage(groupId, {
      text: '*تم تغيير نوع المطابقة!*\n\nالجروب: ' + groupMetadata.subject + '\nالنوع الجديد: ' + sub
    }, { quoted: m })
  }

  // ── antibadwordignoreadmins ────────────────────────────────
  if (command === 'antibadwordignoreadmins' || command === 'bwignoreadmins') {
    var sub = args[0] ? args[0].toLowerCase() : ''
    if (sub === 'on') groupData.antibadwordIgnoreAdmins = true
    else if (sub === 'off') groupData.antibadwordIgnoreAdmins = false
    else return m.reply('استخدم:\n' + usedPrefix + 'antibadwordignoreadmins on\n' + usedPrefix + 'antibadwordignoreadmins off')

    return conn.sendMessage(groupId, {
      text: '*تم تحديث تجاهل الأدمن!*\n\nالجروب: ' + groupMetadata.subject + '\nتجاهل الأدمن: ' + (groupData.antibadwordIgnoreAdmins ? 'مفعل' : 'موقف')
    }, { quoted: m })
  }

  // ── addbadword ─────────────────────────────────────────────
  if (command === 'addbadword') {
    if (!text || !text.trim()) return m.reply('اكتب الكلمة المراد اضافتها!\nمثال: ' + usedPrefix + 'addbadword كلمة')
    var word = text.trim()
    var exists = groupData.badwords.some(function(w) { return w.toLowerCase() === word.toLowerCase() })
    if (exists) return m.reply('الكلمة موجودة بالفعل في القائمة!')

    groupData.badwords.push(word)
    invalidateBadwordsCache(groupId)
    return conn.sendMessage(groupId, {
      text: '*تمت اضافة الكلمة بنجاح!*\n\nالجروب: ' + groupMetadata.subject + '\nالكلمة: ' + word
    }, { quoted: m })
  }

  // ── delbadword ─────────────────────────────────────────────
  if (command === 'delbadword') {
    if (!text || !text.trim()) return m.reply('اكتب الكلمة المراد حذفها!\nمثال: ' + usedPrefix + 'delbadword كلمة')
    var word = text.trim()
    var idx = groupData.badwords.findIndex(function(w) { return w.toLowerCase() === word.toLowerCase() })
    if (idx === -1) return m.reply('الكلمة غير موجودة في القائمة المخصصة لهذا الجروب!\n(ملحوظة: لا يمكن حذف الكلمات الافتراضية للنظام)')

    groupData.badwords.splice(idx, 1)
    invalidateBadwordsCache(groupId)
    return conn.sendMessage(groupId, {
      text: '*تم حذف الكلمة بنجاح!*\n\nالجروب: ' + groupMetadata.subject + '\nالكلمة: ' + word
    }, { quoted: m })
  }

  // ── badwords ───────────────────────────────────────────────
  if (command === 'badwords') {
    var fullList = DEFAULT_BADWORDS.concat(groupData.badwords)
    if (!fullList.length) return m.reply('لا توجد كلمات محظورة حاليا.')

    var listText = fullList.map(function(w, i) { return (i + 1) + '- ' + w }).join('\n')
    return conn.sendMessage(groupId, {
      text: '*📋 قائمة الكلمات المحظورة:*\n\n' + listText +
            '\n\n(' + DEFAULT_BADWORDS.length + ' افتراضية + ' + groupData.badwords.length + ' مخصصة)'
    }, { quoted: m })
  }

  // ── clearbadwords ──────────────────────────────────────────
  if (command === 'clearbadwords') {
    var removedCount = groupData.badwords.length
    groupData.badwords = []
    invalidateBadwordsCache(groupId)
    return conn.sendMessage(groupId, {
      text: '*تم حذف جميع الكلمات المخصصة!*\n\nالجروب: ' + groupMetadata.subject + '\nعدد الكلمات المحذوفة: ' + removedCount +
            '\n\n(الكلمات الافتراضية للنظام تظل سارية)'
    }, { quoted: m })
  }

  // ── bwarn (عرض عدد إنذارات عضو) ───────────────────────────
  if (command === 'bwarn' || command === 'badwordwarn') {
    var target = (m.mentionedJid && m.mentionedJid[0]) || (m.quoted && m.quoted.sender) || m.sender
    var count  = getWarnCount(target, groupId)
    var maxW   = groupData.antibadwordMaxWarn || DEFAULT_MAX_WARN
    var num    = target.replace('@s.whatsapp.net', '')
    return conn.sendMessage(groupId, {
      text: '*إنذارات Anti-BadWord*\n\n@' + num + '\nعدد الإنذارات: ' + count + '/' + maxW,
      mentions: [target]
    }, { quoted: m })
  }

  // ── resetbwarn (تصفير إنذارات عضو) ────────────────────────
  if (command === 'resetbwarn' || command === 'resetbadwordwarn') {
    var target = (m.mentionedJid && m.mentionedJid[0]) || (m.quoted && m.quoted.sender) || null
    if (!target) return m.reply('منشن العضو او رد على رسالته لتصفير إنذاراته!\nمثال: ' + usedPrefix + 'resetbwarn @user')

    resetWarn(target, groupId)
    var num = target.replace('@s.whatsapp.net', '')
    return conn.sendMessage(groupId, {
      text: '*تم تصفير الإنذارات بنجاح!*\n\n@' + num + '\nعدد الإنذارات الحالي: 0',
      mentions: [target]
    }, { quoted: m })
  }
}

// ============================================================
// 👁️ all() — بيشتغل على كل رسالة (مرور الرسائل من handler.js)
// ✅ handler.js بيبعت all() فقط: { chatUpdate, __dirname, __filename }
// ✅ مش بيبعت conn — لازم نستخدم (this) بدلاً منه
// ============================================================
handler.all = async function (m, { chatUpdate }) {
  var conn = this

  if (!m.chat.endsWith('@g.us')) return
  if (m.isBaileys) return

  var groupId   = m.chat
  var groupData = getGroupData(groupId)
  if (!groupData || !groupData.antibadword) return

  var msgText = m.text || (m.msg && (m.msg.caption || m.msg.text)) || ''
  if (!msgText) return

  try {
    var groupMetadata = await conn.groupMetadata(groupId)
    var participants  = groupMetadata.participants || []

    if (isExemptUser(m, participants, groupData)) return

    var matchMode    = groupData.antibadwordMatch || 'contains'
    var badwordsList = getCachedBadwords(groupId, groupData)
    var matched      = findBadWord(msgText, badwordsList, matchMode)
    if (!matched) return

    // الحذف يحدث دائما فورا بغض النظر عن الكولداون
    await conn.sendMessage(groupId, { delete: m.key })

    // ⏱️ Cooldown: لو العضو بيسبح بكلمات محظورة متتالية، منمنع سبام التحذيرات/اللوج
    if (isInCooldown(groupId, m.sender)) return
    setCooldown(groupId, m.sender)

    var mode         = groupData.antibadwordMode || 'delete'
    var maxWarn      = groupData.antibadwordMaxWarn || DEFAULT_MAX_WARN
    var senderNumber = m.sender.replace('@s.whatsapp.net', '')
    var senderName   = m.pushName || senderNumber
    var groupName    = groupMetadata.subject

    var actionLabel = 'Delete'
    var warnCount   = null

    if (mode === 'warn') {
      warnCount   = addWarn(m.sender, groupId)
      actionLabel = 'Delete + Warn'
      await conn.sendMessage(groupId, {
        text: '*⚠️ تحذير | كلمة محظورة*\n' + '─'.repeat(26) + '\n' +
              '@' + senderNumber + '\n\n' +
              'تم رصد كلمة محظورة في رسالتك وتم حذفها.\n' +
              'عدد الإنذارات: ' + warnCount + '/' + maxWarn,
        mentions: [m.sender]
      })

    } else if (mode === 'kick') {
      actionLabel = 'Delete + Kick'
      await tryKick(conn, groupId, participants, m.sender, senderNumber)

    } else if (mode === 'warnkick') {
      warnCount = addWarn(m.sender, groupId)

      if (warnCount >= maxWarn) {
        actionLabel = 'Delete + Kick (Max Warn)'
        var kicked = await tryKick(conn, groupId, participants, m.sender, senderNumber)
        if (kicked) resetWarn(m.sender, groupId)
      } else {
        actionLabel = 'Delete + Warn'
        var remaining = maxWarn - warnCount
        await conn.sendMessage(groupId, {
          text: '*⚠️ تحذير | كلمة محظورة*\n' + '─'.repeat(26) + '\n' +
                '@' + senderNumber + '\n\n' +
                'تم رصد كلمة محظورة في رسالتك وتم حذفها.\n' +
                'عدد الإنذارات: ' + warnCount + '/' + maxWarn +
                (remaining <= 1 ? '\n\nتحذير اخير! الإنذار القادم سيؤدي الى طردك من الجروب.' : ''),
          mentions: [m.sender]
        })
      }

    } else {
      actionLabel = 'Delete'
    }

    // 📤 إرسال السجل الكامل لجروب اللوج (متكامل مع grouplog/securityLogger)
    var msgId    = (m.key && m.key.id) || m.id || '—'
    var logExtra =
      'Group ID: ' + groupId + '\n' +
      'Message ID: ' + msgId + '\n' +
      'Member: ' + senderName + '\n' +
      'Detected Word: ' + matched + '\n' +
      'Message: ' + msgText.slice(0, 150) +
      (warnCount !== null ? '\nWarnings: ' + warnCount + '/' + maxWarn : '')

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    m.sender,
      action:    actionLabel,
      reason:    'Bad word detected',
      extra:     logExtra
    })

  } catch (err) {
    console.error('[Anti-BadWord] Error:', err.message)
  }
}

// ============================================================
handler.help    = [
  'antibadword'
]
handler.tags    = ['group']
handler.command = [
  'antibadword',
  'antibadwordmode',
  'antibadwordmaxwarn', 'bwmaxwarn',
  'antibadwordmatch', 'bwmatch',
  'antibadwordignoreadmins', 'bwignoreadmins',
  'addbadword',
  'delbadword',
  'badwords',
  'clearbadwords',
  'bwarn', 'badwordwarn',
  'resetbwarn', 'resetbadwordwarn',
]

handler.group    = false
handler.admin    = false
handler.botAdmin = false

handler.type    = 'protection'

export default handler