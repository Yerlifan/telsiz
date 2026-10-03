'use strict'

// Emoji seçici verisi (Ek A3). Yalnızca Unicode 13.0 ve öncesi, ten rengi varyasyonu yok.

window.EMOJI_DATA = [
  { key: 'faces', label: 'Yüzler', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤔 🤨 😐 😏 😒 🙄 😬 😌 😔 😴 😷 🤢 🤮 🤯 🤠 🥳 😎 🤓 🙁 😮 😲 😳 🥺 😨 😰 😢 😭 😱 😞 😩 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 👾 🤖 🙈 🙉 🙊' },
  { key: 'people', label: 'İnsanlar ve el hareketleri', list: '👋 🤚 ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 👀 🧠 👶 🧑 👨 👩 🧓 🙋 🙇 🤦 🤷 🙆 🙅 💃 🕺 🚶 🏃' },
  { key: 'nature', label: 'Hayvanlar ve doğa', list: '🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐯 🦁 🐷 🐸 🐵 🐧 🐦 🦉 🐺 🐴 🦄 🐝 🦋 🐢 🐬 🐳 🦈 🐾 🐉 🌲 🌳 🌴 🍀 🍂 🌷 🌹 🌸 🌻 🌞 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ☁️ 🌧️ ❄️ ⛄ 🌊 💧' },
  { key: 'food', label: 'Yiyecek ve içecek', list: '🍏 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍍 🍅 🥑 🥕 🥔 🍞 🧀 🍳 🍗 🌭 🍔 🍟 🍕 🥪 🌮 🥗 🍝 🍜 🍣 🍰 🎂 🧁 🍭 🍫 🍿 🍩 🍪 🥛 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍹' },
  { key: 'activity', label: 'Etkinlik ve oyun', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🏒 🥅 ⛳ 🏹 🎣 🥊 🥋 🛹 🎿 🏆 🥇 🥈 🥉 🏅 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎸 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩 🎉 🎊 🎈 🎁' },
  { key: 'travel', label: 'Seyahat ve yerler', list: '🚗 🚕 🚌 🏎️ 🚓 🚑 🚚 🚜 🛵 🏍️ 🚲 🚨 🚄 🚂 ✈️ 🚀 🚁 ⛵ 🚢 ⛽ 🚦 🗺️ 🗽 🏰 🏟️ 🎡 🎢 🏖️ 🌋 ⛰️ 🏕️ ⛺ 🏠 🏢 🏥 🏫 🕌 🌅 🎆 🌃 🌉' },
  { key: 'objects', label: 'Nesneler', list: '⌚ 📱 💻 ⌨️ 🖥️ 💾 📷 🎥 📞 📺 🎙️ ⏰ ⏳ 🔋 🔌 💡 💵 💰 💳 💎 🔧 🔨 🛠️ ⚙️ 💣 🔮 💊 💉 🔑 🚪 🧸 🛒 ✉️ 📦 📝 📁 📅 📌 📎 ✂️ 🔒 🔓 📚 📖 🔗 ✏️ 🔍' },
  { key: 'symbols', label: 'Semboller', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💘 💯 💢 💥 💬 💤 ✅ ✔️ ❌ ➕ ❓ ❗ ‼️ ⚠️ 🚫 ⛔ 🛑 ♻️ 🔊 🔔 📢 🎵 🎶 ♠️ 🔴 🟠 🟡 🟢 🔵 🟣 ➡️ ⬅️ ⬆️ ⬇️ 🔄 🆗 🆕 🆘 1️⃣ 2️⃣ 3️⃣ #️⃣ ™️' },
  { key: 'flags', label: 'Bayraklar', list: '🇹🇷 🇦🇿 🇩🇪 🇬🇧 🇺🇸 🇫🇷 🇳🇱 🇧🇪 🇦🇹 🇨🇭 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇹 🇪🇸 🇵🇹 🇬🇷 🇵🇱 🇺🇦 🇯🇵 🇰🇷 🇧🇷 🇦🇷 🇨🇦 🇪🇺 🏁 🚩 🏳️ 🏳️\u200d🌈' }
]
