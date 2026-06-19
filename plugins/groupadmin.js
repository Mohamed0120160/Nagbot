// ====================================================
// ⚙️ Group Admin System
// إدارة أعضاء | تحذيرات | إدارة جروب | قفل | لوج
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'

// ── Helpers ──────────────────────────────────────────

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

// تحليل المدة الزمنية: 10m / 2h / 1d
function parseDuration(str) {
  if (!str) return null
  var match = str.match(/^(\d+)(m|h|d)$/i)
  if (!match) return null
  var amount = parseInt(match[1])
  var unit   = match[2].toLowerCase()
  if (unit === 'm') return amount * 60 * 1000
  if (unit === 'h') return amount * 60 * 60 * 1000
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000
  return null
}

// وصف المدة للعرض
function durationLabel(ms) {
  var m = Math.floor(ms / 60000)
  if (m < 60) return m + ' دقيقة'
  var h = Math.floor(m / 60)
  if (h < 24) return h + ' ساعة'
  return Math.floor(h / 24) + ' يوم'
}

// تنظيف الـ JID من device suffix مثل :5@
function normalizeJid(jid) {
  if (!jid) return null
  return jid.replace(/:[0-9]+@/, '@')
}

// استخراج المستخدم المستهدف من mention أو quote أو رقم
function getTargetUser(m, args) {
  var jid = null
  if (m.mentionedJid && m.mentionedJid.length > 0) jid = m.mentionedJid[0]
  else if (m.quoted && m.quoted.sender)              jid = m.quoted.sender
  else if (args[0] && /\d{5,}/.test(args[0]))       jid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net'
  return normalizeJid(jid)
}

// تقليل تحذير واحد لكل عضو في الجروب
function autoReduceWarns(groupId) {
  var db = global.db
  if (!db || !db.data || !db.data.users) return
  var warnKey = 'warn_' + groupId
  var users   = db.data.users
  for (var uid in users) {
    if (users[uid][warnKey] && users[uid][warnKey] > 0) {
      users[uid][warnKey]--
      if (users[uid][warnKey] <= 0) delete users[uid][warnKey]
    }
  }
}

// ── Main Handler ─────────────────────────────────────

let handler = async (m, { conn, usedPrefix, command, args, text }) => {

  var groupId = m.chat
  if (!groupId.endsWith('@g.us')) return m.reply('هذا الأمر يعمل داخل الجروبات فقط!')

  var groupMetadata, participants
  try {
    groupMetadata = await conn.groupMetadata(groupId)
    participants  = groupMetadata.participants || []
  } catch (e) {
    return m.reply('حدث خطأ في جلب بيانات الجروب')
  }

  var senderInfo = participants.find(function(p) { return conn.getJid(p.id) === m.sender })
  var isAdmin    = senderInfo ? !!senderInfo.admin : false
  var ownerList  = global.owner ? global.owner.map(function(o) { return o[0] + '@s.whatsapp.net' }) : []
  var isBotOwner = ownerList.includes(m.sender)

  if (!isAdmin && !isBotOwner) return m.reply('هذا الأمر للأدمن فقط!')

  var botData    = participants.find(function(p) { return conn.getJid(p.id) === conn.user.jid })
  var isBotAdmin = botData ? !!botData.admin : false

  var groupData = getGroupData(groupId)
  if (!groupData) return m.reply('خطأ في قاعدة البيانات!')

  var groupName    = groupMetadata.subject
  var senderNumber = m.sender.replace('@s.whatsapp.net', '')

  // ══════════════════════════════════════════════════
  // 🚪 KICK — طرد عضو
  // ══════════════════════════════════════════════════
  if (command === 'kick') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')

    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    var targetInfo = participants.find(function(p) { return conn.getJid(p.id) === target })
    if (!targetInfo) return m.reply('العضو غير موجود في الجروب!')
    if (targetInfo.admin) return m.reply('❌ لا يمكن طرد أدمن!')

    var targetNum = target.replace('@s.whatsapp.net', '')
    await conn.groupParticipantsUpdate(groupId, [target], 'remove')
    await conn.sendMessage(groupId, {
      text:     '🚪 *تم الطرد*\n──────────────\nالعضو: @' + targetNum + '\nبواسطة: @' + senderNumber,
      mentions: [target, m.sender]
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'Kick',
      reason:    'Admin action',
      extra:     'By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // ⚠️ WARN — تحذير عضو
  // ══════════════════════════════════════════════════
  if (command === 'warn') {
    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    // ✅ FIX: كان بيقارن p.id الخام (ممكن يكون فيه device suffix زي :32@)
    // مع target المنظّف، فميرجعش نتيجة حتى لو العضو موجود فعلاً.
    var targetInfo = participants.find(function(p) { return conn.getJid(p.id) === target })
    if (!targetInfo) return m.reply('العضو غير موجود في الجروب!')
    if (targetInfo.admin) return m.reply('❌ لا يمكن تحذير أدمن!')

    // السبب = كل ما بعد المنشن
    var reason = text.replace(/<@[^>]+>/g, '').replace(/@\d+/g, '').trim() || 'لم يُحدد سبب'

    var userData = getUserData(target)
    if (!userData) return m.reply('خطأ في قاعدة البيانات!')

    var warnKey   = 'warn_' + groupId
    userData[warnKey] = (userData[warnKey] || 0) + 1
    var warnCount = userData[warnKey]
    var maxWarns  = groupData.maxWarns || 3
    var targetNum = target.replace('@s.whatsapp.net', '')

    var warnMsg =
      '⚠️ *تحذير*\n' +
      '──────────────\n' +
      'العضو: @' + targetNum + '\n' +
      'السبب: ' + reason + '\n' +
      'التحذيرات: ' + warnCount + ' / ' + maxWarns

    if (warnCount >= maxWarns) warnMsg += '\n\n🚨 *الحد الأقصى! سيتم تنفيذ الإجراء...*'

    await conn.sendMessage(groupId, { text: warnMsg, mentions: [target] }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'Warn (' + warnCount + '/' + maxWarns + ')',
      reason:    reason,
      extra:     'By: ' + senderNumber
    })

    // طرد تلقائي عند الوصول للحد الأقصى
    if (warnCount >= maxWarns) {
      userData[warnKey] = 0
      if (isBotAdmin) {
        await conn.groupParticipantsUpdate(groupId, [target], 'remove')
        await conn.sendMessage(groupId, {
          text:     '🚨 تم طرد @' + targetNum + ' تلقائياً بعد الوصول للحد الأقصى من التحذيرات!',
          mentions: [target]
        })
        await sendSecurityLog(conn, groupId, {
          groupName: groupName,
          userId:    target,
          action:    'Auto-Kick (Max Warns Reached)',
          reason:    'Exceeded ' + maxWarns + ' warnings',
          extra:     'By: ' + senderNumber
        })
      } else {
        await conn.sendMessage(groupId, {
          text: '⚠️ وصل @' + targetNum + ' للحد الأقصى لكن البوت غير أدمن للطرد!',
          mentions: [target]
        })
      }
    }
    return
  }

  // ══════════════════════════════════════════════════
  // ✅ UNWARN — إزالة تحذير
  // ══════════════════════════════════════════════════
  if (command === 'unwarn' || command === 'rmwarn') {
    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    var userData = getUserData(target)
    if (!userData) return m.reply('خطأ في قاعدة البيانات!')

    var warnKey   = 'warn_' + groupId
    var prevCount = userData[warnKey] || 0
    if (prevCount <= 0) return m.reply('هذا العضو ليس لديه تحذيرات!')

    userData[warnKey] = prevCount - 1
    var newCount  = userData[warnKey]
    var targetNum = target.replace('@s.whatsapp.net', '')

    await conn.sendMessage(groupId, {
      text:     '✅ *تم إزالة تحذير*\n──────────────\nالعضو: @' + targetNum + '\nالتحذيرات: ' + prevCount + ' ← ' + newCount,
      mentions: [target]
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'Warn Removed',
      reason:    'Admin action',
      extra:     'Warns: ' + prevCount + ' → ' + newCount + ' | By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // 🗑️ CLEARWARN — مسح كل تحذيرات عضو
  // ══════════════════════════════════════════════════
  if (command === 'clearwarn' || command === 'resetwarn') {
    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    var userData = getUserData(target)
    if (!userData) return m.reply('خطأ في قاعدة البيانات!')

    var warnKey   = 'warn_' + groupId
    var prevCount = userData[warnKey] || 0
    if (prevCount <= 0) return m.reply('هذا العضو ليس لديه تحذيرات أصلاً!')

    delete userData[warnKey]
    var targetNum = target.replace('@s.whatsapp.net', '')

    await conn.sendMessage(groupId, {
      text:     '🗑️ *تم مسح كل التحذيرات*\n──────────────\nالعضو: @' + targetNum + '\nتم حذف: ' + prevCount + ' تحذير',
      mentions: [target]
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'All Warns Cleared',
      reason:    'Admin action',
      extra:     'Cleared ' + prevCount + ' warn(s) | By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // 📊 WARNLIST — عرض التحذيرات
  // ══════════════════════════════════════════════════
  if (command === 'warnlist' || command === 'warns') {
    var maxWarns = groupData.maxWarns || 3
    var target   = getTargetUser(m, args)

    // تحذيرات عضو محدد
    if (target) {
      var userData = getUserData(target)
      var warnKey  = 'warn_' + groupId
      var count    = (userData && userData[warnKey]) || 0
      var targetNum = target.replace('@s.whatsapp.net', '')
      return conn.sendMessage(groupId, {
        text:     '📊 *تحذيرات العضو*\n──────────────\nالعضو: @' + targetNum + '\nالتحذيرات: ' + count + ' / ' + maxWarns,
        mentions: [target]
      }, { quoted: m })
    }

    // قائمة الكل
    var db      = global.db
    var warnKey = 'warn_' + groupId
    var list    = []
    var mentions = []

    if (db && db.data && db.data.users) {
      for (var uid in db.data.users) {
        var cnt = db.data.users[uid][warnKey] || 0
        if (cnt > 0) {
          list.push('  • @' + uid.replace('@s.whatsapp.net', '') + ': ' + cnt + '/' + maxWarns)
          mentions.push(uid)
        }
      }
    }

    if (list.length === 0) return m.reply('✅ لا يوجد أعضاء لديهم تحذيرات في هذا الجروب')

    return conn.sendMessage(groupId, {
      text:     '📊 *قائمة التحذيرات*\n' + groupName + '\n──────────────\n' + list.join('\n'),
      mentions: mentions
    }, { quoted: m })
  }

  // ══════════════════════════════════════════════════
  // 🔢 SETWARN — تعيين الحد الأقصى للتحذيرات
  // ══════════════════════════════════════════════════
  if (command === 'setwarn' || command === 'maxwarn') {
    var num = parseInt(args[0])
    if (isNaN(num) || num < 1 || num > 20) return m.reply('حدد رقماً صحيحاً بين 1 و 20')
    groupData.maxWarns = num
    return conn.sendMessage(groupId, {
      text: '✅ *تم تعيين حد التحذيرات*\n──────────────\nالجروب: ' + groupName + '\nالحد الجديد: ' + num + '\nعند الوصول يتم الطرد تلقائياً'
    }, { quoted: m })
  }

  // ══════════════════════════════════════════════════
  // ⬆️ PROMOTE — رفع أدمن
  // ══════════════════════════════════════════════════
  if (command === 'promote') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')

    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    // ✅ FIX: نفس مشكلة العضو غير موجود
    var targetInfo = participants.find(function(p) { return conn.getJid(p.id) === target })
    if (!targetInfo) return m.reply('العضو غير موجود في الجروب!')
    if (targetInfo.admin) return m.reply('هذا العضو أدمن بالفعل!')

    var targetNum = target.replace('@s.whatsapp.net', '')
    await conn.groupParticipantsUpdate(groupId, [target], 'promote')
    await conn.sendMessage(groupId, {
      text:     '⬆️ *تم الترقية*\n──────────────\nالعضو: @' + targetNum + '\nأصبح الآن أدمن في الجروب 🎉',
      mentions: [target]
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'Promoted to Admin',
      reason:    'Admin action',
      extra:     'By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // ⬇️ DEMOTE — تنزيل أدمن
  // ══════════════════════════════════════════════════
  if (command === 'demote') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')

    var target = getTargetUser(m, args)
    if (!target) return m.reply('حدد العضو برد على رسالته أو منشنه!')

    // ✅ FIX: نفس مشكلة العضو غير موجود
    var targetInfo = participants.find(function(p) { return conn.getJid(p.id) === target })
    if (!targetInfo) return m.reply('العضو غير موجود في الجروب!')
    if (!targetInfo.admin) return m.reply('هذا العضو ليس أدمن!')

    var targetNum = target.replace('@s.whatsapp.net', '')
    await conn.groupParticipantsUpdate(groupId, [target], 'demote')
    await conn.sendMessage(groupId, {
      text:     '⬇️ *تم التنزيل*\n──────────────\nالعضو: @' + targetNum + '\nتم إزالته من الأدمن',
      mentions: [target]
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    target,
      action:    'Demoted from Admin',
      reason:    'Admin action',
      extra:     'By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // ✏️ SETNAME — تغيير اسم الجروب
  // ══════════════════════════════════════════════════
  if (command === 'setname' || command === 'rename') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')
    if (!text || !text.trim()) return m.reply('حدد الاسم الجديد للجروب!\nمثال: ' + usedPrefix + 'setname اسم الجروب')

    var newName = text.trim()
    await conn.groupUpdateSubject(groupId, newName)
    await conn.sendMessage(groupId, {
      text: '✏️ *تم تغيير اسم الجروب*\n──────────────\nالاسم القديم: ' + groupName + '\nالاسم الجديد: ' + newName
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: newName,
      userId:    m.sender,
      action:    'Group Name Changed',
      reason:    'Admin action',
      extra:     '"' + groupName + '" → "' + newName + '"'
    })
    return
  }

  // ══════════════════════════════════════════════════
  // 📝 SETDESC — تغيير وصف الجروب
  // ══════════════════════════════════════════════════
  if (command === 'setdesc' || command === 'desc') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')
    if (!text || !text.trim()) return m.reply('حدد الوصف الجديد!\nمثال: ' + usedPrefix + 'setdesc وصف الجروب')

    var newDesc = text.trim()
    await conn.groupUpdateDescription(groupId, newDesc)
    await conn.sendMessage(groupId, {
      text: '📝 *تم تغيير وصف الجروب*\n──────────────\n' + newDesc
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    m.sender,
      action:    'Group Description Changed',
      reason:    'Admin action',
      extra:     newDesc.slice(0, 80)
    })
    return
  }

  // ══════════════════════════════════════════════════
  // 🖼️ SETPP — تغيير صورة الجروب
  // ══════════════════════════════════════════════════
  if (command === 'setpp' || command === 'setgrouppp') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')

    var mediaMsg = m.quoted || m
    var mimetype = (mediaMsg.msg || mediaMsg)?.mimetype || ''
    if (!mimetype.startsWith('image/')) return m.reply('أرسل صورة أو ارد على صورة لتغيير صورة الجروب!')

    try {
      var buffer = await conn.downloadMediaMessage(mediaMsg)
      await conn.updateProfilePicture(groupId, buffer)
      await conn.sendMessage(groupId, {
        text: '🖼️ *تم تغيير صورة الجروب بنجاح!*\nالجروب: ' + groupName
      }, { quoted: m })

      await sendSecurityLog(conn, groupId, {
        groupName: groupName,
        userId:    m.sender,
        action:    'Group Picture Changed',
        reason:    'Admin action',
        extra:     'By: ' + senderNumber
      })
    } catch (e) {
      return m.reply('حدث خطأ أثناء تغيير الصورة: ' + e.message)
    }
    return
  }

  // ══════════════════════════════════════════════════
  // 🔒 LOCK — غلق الجروب (دائم أو مؤقت)
  // ══════════════════════════════════════════════════
  if (command === 'lock' || command === 'close') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')

    var durMs    = parseDuration(args[0])
    var isTemp   = durMs !== null
    var unlockAt = isTemp ? Date.now() + durMs : null

    groupData.locked    = true
    groupData.lockUntil = unlockAt

    await conn.groupSettingUpdate(groupId, 'announcement')

    if (isTemp) {
      var label = durationLabel(durMs)
      await conn.sendMessage(groupId, {
        text: '🔒 *تم غلق الجروب مؤقتاً*\n──────────────\nالجروب: ' + groupName + '\nالمدة: ' + args[0] + ' (' + label + ')\nسيُفتح تلقائياً بعد انتهاء المدة'
      }, { quoted: m })

      await sendSecurityLog(conn, groupId, {
        groupName: groupName,
        userId:    m.sender,
        action:    'Group Locked — Temp (' + args[0] + ')',
        reason:    'Admin action',
        extra:     'Auto-unlock at: ' + new Date(unlockAt).toLocaleTimeString('ar-EG')
      })

      // ✅ FIX: مفيش أي حاجة قبل كانت بتفك القفل فعلياً بعد المدة —
      // كان بيتسجل lockUntil بس وخلاص. ده setTimeout مباشر يفك
      // القفل لوحده بالظبط بعد المدة المطلوبة، من غير الاعتماد على
      // scheduler خارجي. (ملحوظة: لو البوت اتقفل/اتعمل له ريستارت
      // قبل ما الوقت يخلص، الـ timer ده هيضيع والجروب هيفضل مقفول
      // لحد ما تستخدم .unlock يدوي — لو محتاج يفضل شغال بعد ريستارت
      // محتاج تخزين دائم + فحص دوري عند بدء تشغيل البوت).
      setTimeout(async function() {
        var freshGroupData = getGroupData(groupId)
        // لو حد فك القفل يدوي أو قفل تاني بمدة مختلفة، متعملش حاجة
        if (!freshGroupData || !freshGroupData.locked || freshGroupData.lockUntil !== unlockAt) return
        try {
          freshGroupData.locked    = false
          freshGroupData.lockUntil = null
          await conn.groupSettingUpdate(groupId, 'not_announcement')
          await conn.sendMessage(groupId, {
            text: '🔓 *تم فتح الجروب تلقائياً*\n──────────────\nالجروب: ' + groupName + '\nانتهت مدة القفل المؤقت (' + args[0] + ')'
          })
          await sendSecurityLog(conn, groupId, {
            groupName: groupName,
            userId:    m.sender,
            action:    'Group Auto-Unlocked (Temp Lock Expired)',
            reason:    'Scheduled',
            extra:     'Duration was: ' + args[0]
          })
        } catch (e) {
          console.error('Auto-unlock error:', e)
        }
      }, durMs)

    } else {
      await conn.sendMessage(groupId, {
        text: '🔒 *تم غلق الجروب*\n──────────────\nالجروب: ' + groupName + '\nفقط الأدمن يمكنهم الإرسال الآن\nلفتح الجروب: ' + usedPrefix + 'unlock'
      }, { quoted: m })

      await sendSecurityLog(conn, groupId, {
        groupName: groupName,
        userId:    m.sender,
        action:    'Group Locked',
        reason:    'Admin action',
        extra:     'By: ' + senderNumber
      })
    }
    return
  }

  // ══════════════════════════════════════════════════
  // 🔓 UNLOCK — فتح الجروب
  // ══════════════════════════════════════════════════
  if (command === 'unlock' || command === 'open') {
    if (!isBotAdmin) return m.reply('⚠️ البوت ليس أدمن، لا يمكن تنفيذ هذا الأمر!')
    if (!groupData.locked) return m.reply('الجروب مفتوح بالفعل!')

    groupData.locked    = false
    groupData.lockUntil = null

    await conn.groupSettingUpdate(groupId, 'not_announcement')
    await conn.sendMessage(groupId, {
      text: '🔓 *تم فتح الجروب*\n──────────────\nالجروب: ' + groupName + '\nيمكن لجميع الأعضاء الإرسال الآن'
    }, { quoted: m })

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    m.sender,
      action:    'Group Unlocked',
      reason:    'Admin action',
      extra:     'By: ' + senderNumber
    })
    return
  }

  // ══════════════════════════════════════════════════
  // 📋 SETLOG — تعيين جروب اللوج
  // ══════════════════════════════════════════════════
  if (command === 'setlog') {
    var logTarget = null
    if (m.quoted && m.quoted.chat && m.quoted.chat.endsWith('@g.us')) {
      logTarget = m.quoted.chat
    } else if (text && text.trim().endsWith('@g.us')) {
      logTarget = text.trim()
    } else {
      logTarget = groupId
    }

    try {
      var logMeta = await conn.groupMetadata(logTarget)
      groupData.logGroup     = logTarget
      groupData.logGroupName = logMeta.subject

      return conn.sendMessage(groupId, {
        text: '✅ *تم تعيين جروب اللوج*\n──────────────\nجروب اللوج: ' + logMeta.subject + '\nID: ' + logTarget + '\n\nسيتم إرسال جميع أحداث الحماية والإدارة لهذا الجروب تلقائياً'
      }, { quoted: m })
    } catch (e) {
      return m.reply('تعذر الوصول للجروب المحدد، تأكد أن البوت موجود فيه!')
    }
  }

  // ══════════════════════════════════════════════════
  // ❓ GADMIN — قائمة الأوامر
  // ══════════════════════════════════════════════════
  if (command === 'gadmin' || command === 'adminhelp') {
    var list =
      '⚙️ *أوامر إدارة الجروب*\n' +
      '──────────────\n' +
      usedPrefix + 'kick @user — طرد عضو\n' +
      usedPrefix + 'warn @user [سبب] — تحذير عضو\n' +
      usedPrefix + 'unwarn @user — إزالة تحذير واحد\n' +
      usedPrefix + 'clearwarn @user — مسح كل تحذيرات العضو\n' +
      usedPrefix + 'warnlist [@user] — عرض التحذيرات\n' +
      usedPrefix + 'setwarn <رقم> — تعيين الحد الأقصى للتحذيرات\n' +
      usedPrefix + 'promote @user — رفع أدمن\n' +
      usedPrefix + 'demote @user — تنزيل أدمن\n' +
      usedPrefix + 'setname <اسم> — تغيير اسم الجروب\n' +
      usedPrefix + 'setdesc <وصف> — تغيير وصف الجروب\n' +
      usedPrefix + 'setpp — تغيير صورة الجروب (رد على صورة)\n' +
      usedPrefix + 'lock [مدة] — غلق الجروب (مثال: lock 10m)\n' +
      usedPrefix + 'unlock — فتح الجروب\n' +
      usedPrefix + 'setlog — تعيين جروب اللوج'

    return m.reply(list)
  }
}

handler.help    = ['kick', 'warn', 'unwarn', 'clearwarn', 'warnlist', 'setwarn', 'promote', 'demote', 'setname', 'setdesc', 'setpp', 'lock', 'unlock', 'setlog', 'gadmin']
handler.tags    = ['group']
handler.command = ['kick', 'warn', 'unwarn', 'rmwarn', 'clearwarn', 'resetwarn', 'warnlist', 'warns', 'setwarn', 'maxwarn', 'promote', 'demote', 'setname', 'rename', 'setdesc', 'desc', 'setpp', 'setgrouppp', 'lock', 'close', 'unlock', 'open', 'setlog', 'gadmin', 'adminhelp']

handler.group = true

handler.type    = 'protection'

export default handler
