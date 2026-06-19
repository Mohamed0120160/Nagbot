// ====================================================
// 📡 نظام Message Monitoring
// AntiDelete + AntiViewOnce
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'

// ============================================================
// أدوات مساعدة
// ============================================================

function getGroupData(groupId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.groups) db.data.groups = {}
  if (!db.data.groups[groupId]) db.data.groups[groupId] = {}
  return db.data.groups[groupId]
}

// إرجاع جروب اللوج للجروب ده (نفس ما تعمله securityLogger داخلياً)
function getLogGroupId(groupId) {
  return global.db?.data?.groups?.[groupId]?.logGroup || null
}

// اسم نوع الرسالة بالعربي
function getMsgTypeName(mtype) {
  var map = {
    imageMessage:           'صورة 🖼️',
    videoMessage:           'فيديو 🎥',
    audioMessage:           'صوت 🎵',
    documentMessage:        'ملف 📎',
    stickerMessage:         'ملصق 🎭',
    extendedTextMessage:    'نص 💬',
    conversation:           'نص 💬',
    contactMessage:         'جهة اتصال 📱',
    locationMessage:        'موقع 📍',
    viewOnceMessage:        'View Once 👁️',
    viewOnceMessageV2:      'View Once 👁️',
    viewOnceMessageV2Extension: 'View Once 👁️',
  }
  return map[mtype] || (mtype ? mtype : 'غير معروف')
}

// استخراج نص الرسالة (أي نوع)
function getMsgText(m) {
  if (typeof m.text === 'string' && m.text) return m.text.slice(0, 120)
  if (m.msg?.caption)                        return m.msg.caption.slice(0, 120)
  if (m.msg?.text)                           return m.msg.text.slice(0, 120)
  return ''
}

// هل الرسالة تحتوي وسائط قابلة للإعادة إرسال؟
function isMediaMessage(mtype) {
  return ['imageMessage', 'videoMessage', 'audioMessage',
          'documentMessage', 'stickerMessage'].includes(mtype)
}

// ============================================================
// إرسال الوسائط إلى جروب اللوج قبل الـ text log
// (يُستدعى قبل sendSecurityLog مباشرةً)
// ============================================================

async function forwardMediaToLog(conn, logGroupId, mediaMsg) {
  if (!logGroupId || !mediaMsg) return
  try {
    await conn.copyNForward(logGroupId, mediaMsg, true)
  } catch (e) {
    console.error('[AntiMonitor] Media forward error:', e.message)
  }
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

  var sub = args[0] ? args[0].toLowerCase() : ''

  // ─── monitor: عرض حالة الأنظمة ──────────────────────
  if (command === 'monitor') {
    return conn.sendMessage(groupId, {
      text:
        `*📡 حالة نظام المراقبة*\n` +
        `${'─'.repeat(28)}\n` +
        `👥 الجروب: ${groupMetadata.subject}\n` +
        `${'─'.repeat(28)}\n` +
        `🗑️ AntiDelete:   ${groupData.antiDelete   ? '✅ مفعّل' : '❌ موقف'}\n` +
        `👁️  AntiViewOnce: ${groupData.antiViewOnce ? '✅ مفعّل' : '❌ موقف'}\n` +
        `${'─'.repeat(28)}\n` +
        `📋 الأوامر:\n` +
        `${usedPrefix}antidelete on/off\n` +
        `${usedPrefix}antiviewonce on/off`
    }, { quoted: m })
  }

  // ─── antidelete ──────────────────────────────────────────
  if (command === 'antidelete') {
    if (!sub) {
      return conn.sendMessage(groupId, {
        text:
          `*🗑️ AntiDelete*\n` +
          `الجروب: ${groupMetadata.subject}\n` +
          `الحالة: ${groupData.antiDelete ? '✅ مفعّل' : '❌ موقف'}\n\n` +
          `${usedPrefix}antidelete on\n` +
          `${usedPrefix}antidelete off`
      }, { quoted: m })
    }
    if (sub === 'on') {
      groupData.antiDelete = true
      return conn.sendMessage(groupId, {
        text:
          `*✅ تم تفعيل AntiDelete!*\n\n` +
          `👥 الجروب: ${groupMetadata.subject}\n\n` +
          `سيتم أرشفة أي رسالة تُحذف وإرسالها إلى جروب السجلات.`
      }, { quoted: m })
    }
    if (sub === 'off') {
      groupData.antiDelete = false
      return conn.sendMessage(groupId, {
        text: `*❌ تم إيقاف AntiDelete!*\n\n👥 الجروب: ${groupMetadata.subject}`
      }, { quoted: m })
    }
    return m.reply(`وضع غير صحيح!\n\n${usedPrefix}antidelete on\n${usedPrefix}antidelete off`)
  }

  // ─── antiviewonce ─────────────────────────────────────────
  if (command === 'antiviewonce') {
    if (!sub) {
      return conn.sendMessage(groupId, {
        text:
          `*👁️ AntiViewOnce*\n` +
          `الجروب: ${groupMetadata.subject}\n` +
          `الحالة: ${groupData.antiViewOnce ? '✅ مفعّل' : '❌ موقف'}\n\n` +
          `${usedPrefix}antiviewonce on\n` +
          `${usedPrefix}antiviewonce off`
      }, { quoted: m })
    }
    if (sub === 'on') {
      groupData.antiViewOnce = true
      return conn.sendMessage(groupId, {
        text:
          `*✅ تم تفعيل AntiViewOnce!*\n\n` +
          `👥 الجروب: ${groupMetadata.subject}\n\n` +
          `سيتم حفظ جميع صور وفيديوهات View Once وإرسالها إلى جروب السجلات.`
      }, { quoted: m })
    }
    if (sub === 'off') {
      groupData.antiViewOnce = false
      return conn.sendMessage(groupId, {
        text: `*❌ تم إيقاف AntiViewOnce!*\n\n👥 الجروب: ${groupMetadata.subject}`
      }, { quoted: m })
    }
    return m.reply(`وضع غير صحيح!\n\n${usedPrefix}antiviewonce on\n${usedPrefix}antiviewonce off`)
  }
}

// ============================================================
// all() — بيشتغل على كل رسالة
// ✅ handler.js بيبعت all() فقط: { chatUpdate, __dirname, __filename }
// ✅ مش بيبعت conn — لازم نستخدم (this) بدلاً منه
// ============================================================

handler.all = async function (m, { chatUpdate }) {
  // this = conn هنا لأن handler.js بيعمل plugin.all.call(this, m, {...})
  var conn = this

  if (!m.chat.endsWith('@g.us')) return
  if (m.isBaileys) return

  var groupId   = m.chat
  var groupData = getGroupData(groupId)
  if (!groupData) return

  // لو مفيش أي ميزة مفعّلة → تجاهل فوراً
  if (!groupData.antiDelete && !groupData.antiViewOnce) return

  try {
    var groupMetadata = await conn.groupMetadata(groupId)
    var groupName     = groupMetadata.subject
    var logGroupId    = getLogGroupId(groupId)

    // ================================================================
    // 🗑️ AntiDelete — حذف رسالة للجميع عبر Protocol Message (type 0)
    // ================================================================
    if (groupData.antiDelete && m.mtype === 'protocolMessage' && m.msg) {
      var proto     = m.msg
      var protoType = proto.type  // 0 = REVOKE (حذف للجميع)

      if (protoType === 0 && proto.key) {
        var deletedKey   = proto.key
        var deletedMsgId = deletedKey.id

        // محاولة جلب الرسالة الأصلية من كاش البوت
        var origMsg = null
        try {
          if (conn.loadMessage) {
            var raw = conn.loadMessage(deletedMsgId)
            origMsg = (raw && conn.serializeM) ? conn.serializeM(raw) : raw
          }
        } catch (e) { /* الرسالة مش موجودة في الكاش */ }

        var origType    = origMsg ? getMsgTypeName(origMsg.mtype) : 'غير معروف'
        var origContent = origMsg ? getMsgText(origMsg) : 'لا يمكن استرجاع الرسالة'
        var origOwner   = deletedKey.participant
          ? deletedKey.participant.replace('@s.whatsapp.net', '')
          : (deletedKey.fromMe ? conn.user.id.replace(/@.*/, '') : m.sender.replace('@s.whatsapp.net', ''))

        // إرسال الوسائط أولاً إن وجدت
        if (logGroupId && origMsg && isMediaMessage(origMsg.mtype)) {
          await forwardMediaToLog(conn, logGroupId, origMsg)
        }

        await sendSecurityLog(conn, groupId, {
          groupName: groupName,
          userId:    m.sender,
          action:    'Archived (AntiDelete)',
          reason:    `${origType} — deleted for everyone`,
          extra:     origContent
            ? `Content: ${origContent}\nMsg owner: @${origOwner}`
            : `Msg ID: ${deletedMsgId} | Owner: @${origOwner}`,
        })
      }
      return  // protocol message → نخرج دايماً
    }

    // ================================================================
    // 👁️ AntiViewOnce — كشف صور/فيديو بصيغة View Once
    //
    // ✅ الحل النهائي: نرجع للـ raw message في chatUpdate.messages
    //    قبل ما smsg() تلمسه خالص، بدل ما نعتمد على m.mtype أو m.msg
    //    اللي ممكن smsg() تكون غيّرتهم بأي شكل.
    // ================================================================
    if (groupData.antiViewOnce) {

      // ─── الخطوة 1: جلب الـ raw message من chatUpdate ────────
      var rawMsgArr = chatUpdate?.messages || []
      var rawEntry  = rawMsgArr.find(function (msg) {
        return msg.key && msg.key.id === m.key.id
      })
      var rawMsgObj = (rawEntry && rawEntry.message) ? rawEntry.message : {}

      // ─── الخطوة 2: فحص الـ raw object مباشرةً ───────────────
      var voWrapRaw =
        rawMsgObj.viewOnceMessage            ||
        rawMsgObj.viewOnceMessageV2          ||
        rawMsgObj.viewOnceMessageV2Extension ||
        null

      // ─── الخطوة 3: fallback على m في حالة chatUpdate مش متاح ─
      var voFallback =
        !!(m.message?.viewOnceMessage)            ||
        !!(m.message?.viewOnceMessageV2)          ||
        !!(m.message?.viewOnceMessageV2Extension) ||
        m.mtype === 'viewOnceMessage'             ||
        m.mtype === 'viewOnceMessageV2'           ||
        m.mtype === 'viewOnceMessageV2Extension'  ||
        m.msg?.viewOnce === true

      var isViewOnce = !!(voWrapRaw || voFallback)

      if (isViewOnce) {
        // ─── استخراج المحتوى من الـ raw message (الأدق) ─────────
        var rawInner  = voWrapRaw ? (voWrapRaw.message || {}) : {}
        var mediaType = 'غير معروف'
        var caption   = ''

        if (rawInner.imageMessage) {
          mediaType = 'صورة 🖼️'
          caption   = rawInner.imageMessage.caption || ''
        } else if (rawInner.videoMessage) {
          mediaType = 'فيديو 🎥'
          caption   = rawInner.videoMessage.caption || ''
        } else {
          // fallback: اسأل m.msg اللي smsg حضّرته
          var inner2 = m.msg?.message || m.msg || {}
          if (inner2.imageMessage || m.mtype === 'imageMessage') {
            mediaType = 'صورة 🖼️'
            caption   = (inner2.imageMessage || m.msg)?.caption || ''
          } else if (inner2.videoMessage || m.mtype === 'videoMessage') {
            mediaType = 'فيديو 🎥'
            caption   = (inner2.videoMessage || m.msg)?.caption || ''
          }
        }

        // ─── إرسال الوسائط أولاً (قبل اللوج) ────────────────────
        if (logGroupId) {
          await forwardMediaToLog(conn, logGroupId, m)
        }

        await sendSecurityLog(conn, groupId, {
          groupName: groupName,
          userId:    m.sender,
          action:    'Archived (AntiViewOnce)',
          reason:    `View Once ${mediaType} captured`,
          extra:     caption ? `Caption: ${caption.slice(0, 80)}` : undefined,
        })
        return
      }
    }

  } catch (err) {
    console.error('[AntiMonitor] Error in all():', err.message)
  }
}

// ============================================================
handler.help    = ['monitor']
handler.tags    = ['group']
handler.command = ['monitor', 'antidelete', 'antiviewonce']

handler.group    = false
handler.admin    = false
handler.botAdmin = false

handler.type = 'protection'

export default handler