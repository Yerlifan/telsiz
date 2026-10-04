'use strict'

// Masaüstü uygulamasının başlık şeridi (Windows ve Linux). Ana süreç uygulama penceresini yerel başlık
// çubuğu ve menü çubuğu olmadan, Pencere Denetimleri Kaplamasıyla açar (desktop/src/lib/title-bar.js):
// küçült, ekranı boyutla ve kapat düğmelerini işletim sistemi sağ üste çizer. Bu modül:
// - Sayfanın en üstüne düğmeler kadar yükseklikte bir şerit koyar: solda Telsiz simgesi ve uygulama
//   menüleri (Telsiz, Düzen, Görünüm, Yardım), ortada pencere başlığı. Şerit pencereyi sürükleme bölgesidir.
//   Yükseklik ve yer CSS ortam değişkenlerinden gelir (components.css .titlebar), tam ekranda şerit kalkar.
//   Sayfanın şerit kadar aşağıdan başlaması için kök öğedeki has-titlebar sınıfını theme-init.js ilk
//   çizimden önce ekler. Kaplama açık değilse bu modül sınıfı kaldırır ve şerit çizmez.
// - Pencere düğmelerinin rengini temadan verir: zemin sayfanın zemini, simgeler sayfanın metin rengi. Tema
//   değişince renkler yeniden gönderilir.
// - Menü düğmesine basınca (veya odaktayken Enter, boşluk, aşağı ok) ana süreç uygulama menüsünün o
//   bölümünü düğmenin altında açar. Sol ve sağ ok tuşları menü düğmeleri arasında gezinir.
// Menü etiketleri ve şeridin erişilebilir adı masaüstü uygulamasının kendi dilindedir (yerel menüdeki gibi).

const TitleBar = (function () {
  const desktop = window.telsizDesktop
  const api = desktop && typeof desktop === 'object' ? desktop.titleBar : null
  const root = document.documentElement
  const strip = { node: null, menus: null, title: null, lastColors: '', open: false }

  function hasApi () {
    return Boolean(api && typeof api.getInfo === 'function' && typeof api.setColors === 'function' && typeof api.openMenu === 'function')
  }

  // getComputedStyle rengini (rgb veya rgba) #rrggbb biçimine çevirir, başka biçimde null
  function toHex (value) {
    const m = /^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/.exec(String(value || ''))
    if (!m) return null
    const part = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
    return '#' + part(m[1]) + part(m[2]) + part(m[3])
  }

  function sendColors () {
    if (!document.body) return
    const style = window.getComputedStyle(document.body)
    const color = toHex(style.backgroundColor)
    const symbolColor = toHex(style.color)
    if (!color || !symbolColor) return
    const key = color + symbolColor
    if (key === strip.lastColors) return
    strip.lastColors = key
    api.setColors(color, symbolColor)
  }

  function updateTitle () {
    if (strip.title) strip.title.textContent = document.title || 'Telsiz'
  }

  function watchTitle () {
    const head = document.head
    if (!head || typeof MutationObserver !== 'function') return
    const observer = new MutationObserver(updateTitle)
    observer.observe(head, { childList: true, subtree: true, characterData: true })
  }

  function menuButtons () {
    return strip.menus ? Array.prototype.slice.call(strip.menus.querySelectorAll('.titlebar-menu')) : []
  }

  function openMenu (button) {
    if (strip.open) return
    const index = Number(button.getAttribute('data-index'))
    const rect = button.getBoundingClientRect()
    strip.open = true
    button.setAttribute('aria-expanded', 'true')
    const done = () => {
      strip.open = false
      button.setAttribute('aria-expanded', 'false')
    }
    api.openMenu(index, Math.max(0, rect.left), Math.max(0, rect.bottom)).then(done, done)
  }

  function onMenuKey (e) {
    const buttons = menuButtons()
    const at = buttons.indexOf(e.target)
    if (at < 0) return
    let next = -1
    if (e.key === 'ArrowRight') next = (at + 1) % buttons.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu(e.target)
      return
    }
    if (next < 0) return
    e.preventDefault()
    focusMenu(buttons, next)
  }

  // Menü çubuğunda yalnızca bir düğme Sekme sırasındadır (gezinen tabindex), oklar diğerlerine geçer
  function focusMenu (buttons, index) {
    buttons.forEach((button, i) => {
      button.tabIndex = i === index ? 0 : -1
    })
    buttons[index].focus()
  }

  function render (info) {
    const bar = h('div', 'titlebar')
    bar.id = 'titlebar'
    bar.appendChild(icon('i-logo', 'titlebar-logo'))
    const menus = h('div', 'titlebar-menus')
    menus.setAttribute('role', 'menubar')
    if (info.label) menus.setAttribute('aria-label', info.label)
    info.menus.forEach((label, index) => {
      if (!label) return
      const button = h('button', 'titlebar-menu', label)
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-haspopup', 'menu')
      button.setAttribute('aria-expanded', 'false')
      button.setAttribute('data-index', String(index))
      button.tabIndex = menus.childNodes.length === 0 ? 0 : -1
      button.addEventListener('click', () => openMenu(button))
      menus.appendChild(button)
    })
    menus.addEventListener('keydown', onMenuKey)
    bar.appendChild(menus)
    const title = h('span', 'titlebar-title')
    title.id = 'titlebar-title'
    bar.appendChild(title)
    document.body.insertBefore(bar, document.body.firstChild)
    strip.node = bar
    strip.menus = menus
    strip.title = title
    updateTitle()
    watchTitle()
  }

  function init () {
    if (!hasApi() || !root.classList.contains('has-titlebar')) {
      root.classList.remove('has-titlebar')
      return
    }
    api.getInfo().then((info) => {
      if (!info || !info.enabled) {
        root.classList.remove('has-titlebar')
        return
      }
      render(info)
      sendColors()
      if (window.TelsizTheme && typeof window.TelsizTheme.onChange === 'function') window.TelsizTheme.onChange(sendColors)
    }, () => {
      root.classList.remove('has-titlebar')
    })
  }

  return { init: init, sendColors: sendColors }
})()

TitleBar.init()
