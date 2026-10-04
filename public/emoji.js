'use strict'

// Emoji seçici verisi (Ek A3). Yalnızca Unicode 13.0 ve öncesi, ten rengi varyasyonu yok.
// label alanı kategori adının i18n anahtarıdır (Ek E1 madde 4), metin i18n.js sözlüğündedir.

window.EMOJI_DATA = [
  { key: 'faces', label: 'emoji.faces', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤔 🤨 😐 😏 😒 🙄 😬 😌 😔 😴 😷 🤢 🤮 🤯 🤠 🥳 😎 🤓 🙁 😮 😲 😳 🥺 😨 😰 😢 😭 😱 😞 😩 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 👾 🤖 🙈 🙉 🙊' },
  { key: 'people', label: 'emoji.people', list: '👋 🤚 ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 👀 🧠 👶 🧑 👨 👩 🧓 🙋 🙇 🤦 🤷 🙆 🙅 💃 🕺 🚶 🏃' },
  { key: 'nature', label: 'emoji.nature', list: '🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐯 🦁 🐷 🐸 🐵 🐧 🐦 🦉 🐺 🐴 🦄 🐝 🦋 🐢 🐬 🐳 🦈 🐾 🐉 🌲 🌳 🌴 🍀 🍂 🌷 🌹 🌸 🌻 🌞 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ☁️ 🌧️ ❄️ ⛄ 🌊 💧' },
  { key: 'food', label: 'emoji.food', list: '🍏 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍍 🍅 🥑 🥕 🥔 🍞 🧀 🍳 🍗 🌭 🍔 🍟 🍕 🥪 🌮 🥗 🍝 🍜 🍣 🍰 🎂 🧁 🍭 🍫 🍿 🍩 🍪 🥛 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍹' },
  { key: 'activity', label: 'emoji.activity', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🏒 🥅 ⛳ 🏹 🎣 🥊 🥋 🛹 🎿 🏆 🥇 🥈 🥉 🏅 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎸 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩 🎉 🎊 🎈 🎁' },
  { key: 'travel', label: 'emoji.travel', list: '🚗 🚕 🚌 🏎️ 🚓 🚑 🚚 🚜 🛵 🏍️ 🚲 🚨 🚄 🚂 ✈️ 🚀 🚁 ⛵ 🚢 ⛽ 🚦 🗺️ 🗽 🏰 🏟️ 🎡 🎢 🏖️ 🌋 ⛰️ 🏕️ ⛺ 🏠 🏢 🏥 🏫 🕌 🌅 🎆 🌃 🌉' },
  { key: 'objects', label: 'emoji.objects', list: '⌚ 📱 💻 ⌨️ 🖥️ 💾 📷 🎥 📞 📺 🎙️ ⏰ ⏳ 🔋 🔌 💡 💵 💰 💳 💎 🔧 🔨 🛠️ ⚙️ 💣 🔮 💊 💉 🔑 🚪 🧸 🛒 ✉️ 📦 📝 📁 📅 📌 📎 ✂️ 🔒 🔓 📚 📖 🔗 ✏️ 🔍' },
  { key: 'symbols', label: 'emoji.symbols', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💘 💯 💢 💥 💬 💤 ✅ ✔️ ❌ ➕ ❓ ❗ ‼️ ⚠️ 🚫 ⛔ 🛑 ♻️ 🔊 🔔 📢 🎵 🎶 ♠️ 🔴 🟠 🟡 🟢 🔵 🟣 ➡️ ⬅️ ⬆️ ⬇️ 🔄 🆗 🆕 🆘 1️⃣ 2️⃣ 3️⃣ #️⃣ ™️' },
  { key: 'flags', label: 'emoji.flags', list: '🇹🇷 🇦🇿 🇩🇪 🇬🇧 🇺🇸 🇫🇷 🇳🇱 🇧🇪 🇦🇹 🇨🇭 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇹 🇪🇸 🇵🇹 🇬🇷 🇵🇱 🇺🇦 🇯🇵 🇰🇷 🇧🇷 🇦🇷 🇨🇦 🇪🇺 🏁 🚩 🏳️ 🏳️\u200d🌈' }
]
