import moment from 'moment-timezone'
import fs from 'fs'

const handler = async (m, { conn, usedPrefix: _p, command }) => {
  try {
    const tag     = command.toLowerCase()
    const plugins = Object.values(global.plugins || {}).filter(p => !p.disabled)

    const matched = plugins.filter(p => {
      const tags = Array.isArray(p.tags) ? p.tags : (p.tags ? [p.tags] : [])
      return tags.map(t => t.toLowerCase()).includes(tag)
    })

    if (!matched.length) return m.reply(`❌ لا توجد أوامر في قسم ${tag}`)

    const uptime    = clockString(process.uptime() * 1000)
    const totalreg  = Object.keys(global.db?.data?.users  || {}).length
    const rtotalreg = Object.values(global.db?.data?.users || {}).filter(u => u.registered).length
    const now       = moment.tz('Africa/Cairo')
    const date      = now.format('ddd، DD MMM YYYY')
    const time      = now.format('HH:mm')

    const name = global.db?.data?.users?.[m.sender]?.registered
      ? global.db.data.users[m.sender].name
      : conn.getName(m.sender)

    const HIDDEN_COMMANDS = ['script']

const lines = matched.flatMap(p => {
  const helps = Array.isArray(p.help) ? p.help : (p.help ? [p.help] : [])
  return helps
    .filter(h => h && !HIDDEN_COMMANDS.includes(h.toLowerCase()))
    .map(h => {
        const flags = (p.owner ? ' 👑' : '') + (p.premium ? ' 💎' : '') + (p.limit ? ' ⚡' : '')
        return `◈ ${_p}${h}${flags}`
      })
    })

    const EMOJI = {
      ai:'🤖', tools:'🔧', downloader:'📥', uploader:'📤',
      editor:'✏️', sticker:'🎭', group:'👥', owner:'👑',
      info:'ℹ️', game:'🎮', media:'📸', utility:'⚙️',
    }

    const emoji    = EMOJI[tag] || '📌'
    const label    = tag.toUpperCase()
    const firstCmd = (Array.isArray(matched[0]?.help) ? matched[0].help[0] : matched[0]?.help) || 'cmd'

    const div = '───────────────────'

    const caption = `${div}
           🥰 *${conn.user.name}* 🥰
${div}
${ucapan()} ${name}
📅 التاريخ:${date}
🕐 الوقت:${time} 
🛜 الرفع:${uptime}
${div}
              ${emoji} *${label} قائمة*
${div}
${lines.join('\n')}
${div}
💡 مثال: ${_p}${firstCmd}`

    await conn.sendMessage(
      m.chat,
      {
        image: fs.readFileSync('./media/menu.jpg'),
        caption,
      },
      { quoted: m }
    )

  } catch (e) {
    console.error(e)
    m.reply('❌ خطأ في عرض قائمة القسم.')
  }
}

handler.help = []
handler.tags = ['main']

Object.defineProperty(handler, 'command', {
  get() {
    if (!global.plugins) return /^$/
    const tags = new Set()
    Object.values(global.plugins)
      .filter(p => !p.disabled && p !== handler)
      .forEach(p => {
        const t = Array.isArray(p.tags) ? p.tags : (p.tags ? [p.tags] : [])
        t.forEach(tag => { if (tag && tag !== 'main') tags.add(tag.toLowerCase()) })
      })
    if (!tags.size) return /^$/
    return new RegExp(`^(${[...tags].join('|')})$`, 'i')
  },
  configurable: true,
  enumerable: true,
})

export default handler

function clockString(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return [h, m, s].map(v => v.toString().padStart(2, 0)).join(':')
}

function ucapan() {
  const h = parseInt(moment.tz('Africa/Cairo').format('HH'))
  if (h < 4)  return 'مساء الخير'
  if (h < 10) return 'صباح الخير'
  if (h < 15) return 'صباح الخير'
  if (h < 18) return 'مساء الخير'
  return '🌙'
}
