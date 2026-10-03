'use strict'

// Emoji seçici: kategoriler, son kullanılanlar, ızgara ve klavye gezinmesi.

// Emoji seçici (Ek A3)

let emojiBuilt = false

function emojiData () {
  const data = Array.isArray(window.EMOJI_DATA) ? window.EMOJI_DATA : []
  return data.filter((c) => c && typeof c.key === 'string' && typeof c.list === 'string')
}

function recentEmoji () {
  const raw = storeGet(KEYS.recentEmoji)
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string' && e.length > 0 && e.length <= 32).slice(0, RECENT_EMOJI_MAX) : []
  } catch (err) {
    return []
  }
}

function rememberEmoji (emoji) {
  const list = recentEmoji().filter((e) => e !== emoji)
  list.unshift(emoji)
  storeSet(KEYS.recentEmoji, JSON.stringify(list.slice(0, RECENT_EMOJI_MAX)))
}

function emojiCategories () {
  const cats = [{ key: 'recent', label: t('emoji.recent'), items: recentEmoji(), tabIcon: null }]
  emojiData().forEach((c) => {
    const items = c.list.split(' ').filter(Boolean)
    // emoji.js kategori adlarını i18n anahtarı olarak verir (ör. 'emoji.faces')
    const label = typeof c.label === 'string' && hasText(c.label) ? t(c.label) : c.key
    cats.push({ key: c.key, label: label, items: items, tabIcon: items[0] || '?' })
  })
  return cats
}

function buildEmojiTabs () {
  clear(el.emojiTabs)
  emojiCategories().forEach((c) => {
    const tab = h('button', 'emoji-tab')
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('data-category', c.key)
    tab.setAttribute('aria-label', c.label)
    tab.title = c.label
    tab.setAttribute('aria-controls', 'emoji-grid')
    if (c.tabIcon) {
      tab.appendChild(h('span', 'emoji-glyph', c.tabIcon))
    } else {
      tab.appendChild(h('span', 'emoji-glyph', '🕘'))
    }
    tab.addEventListener('click', () => {
      selectEmojiCategory(c.key, false, true)
    })
    el.emojiTabs.appendChild(tab)
  })
  emojiBuilt = true
}

function selectEmojiCategory (key, focusTab, explicit) {
  const cats = emojiCategories()
  let cat = cats.filter((c) => c.key === key)[0] || cats[0]
  if (!explicit && cat.key === 'recent' && !cat.items.length && cats.length > 1) cat = cats[1]
  Array.from(el.emojiTabs.children).forEach((tab) => {
    const selected = tab.getAttribute('data-category') === cat.key
    tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    tab.tabIndex = selected ? 0 : -1
    if (selected && focusTab) focusNode(tab)
  })
  el.emojiTitle.textContent = cat.label
  clear(el.emojiGrid)
  if (!cat.items.length) {
    el.emojiGrid.appendChild(h('p', 'emoji-empty', t('emoji.empty')))
    return
  }
  const frag = document.createDocumentFragment()
  cat.items.forEach((emoji) => {
    const b = h('button', 'emoji-button', emoji)
    b.type = 'button'
    b.setAttribute('aria-label', emoji)
    b.setAttribute('data-emoji', emoji)
    frag.appendChild(b)
  })
  el.emojiGrid.appendChild(frag)
  el.emojiGrid.scrollTop = 0
}

// Dil değişince kategori adları yeniden üretilir, seçici açıksa yerinde yeniden çizilir
function refreshEmojiLanguage () {
  emojiBuilt = false
  if (!findLayer('emoji')) return
  const selected = el.emojiTabs.querySelector('[aria-selected="true"]')
  const key = selected ? selected.getAttribute('data-category') : 'recent'
  buildEmojiTabs()
  selectEmojiCategory(key, false, true)
}

function openEmojiPicker () {
  if (el.btnEmoji.disabled) return
  const existing = findLayer('emoji')
  if (existing) {
    closeLayer(existing, true)
    return
  }
  if (!emojiBuilt) buildEmojiTabs()
  const first = recentEmoji().length ? 'recent' : (emojiData()[0] ? emojiData()[0].key : 'recent')
  selectEmojiCategory(first, false)
  el.emojiPicker.hidden = false
  el.emojiPicker.classList.toggle('is-sheet', isNarrow())
  el.btnEmoji.setAttribute('aria-expanded', 'true')
  openLayer({
    name: 'emoji',
    el: el.emojiPicker,
    trigger: el.btnEmoji,
    level: 1,
    outside: true,
    trap: true,
    initialFocus: () => el.emojiGrid.querySelector('.emoji-button') || el.emojiTabs.querySelector('[aria-selected="true"]'),
    onClose: () => {
      el.emojiPicker.hidden = true
      el.btnEmoji.setAttribute('aria-expanded', 'false')
    }
  })
}

function insertAtCursor (ta, text) {
  const value = ta.value
  const from = typeof ta.selectionStart === 'number' ? ta.selectionStart : value.length
  const to = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : value.length
  ta.value = value.slice(0, from) + text + value.slice(to)
  const pos = from + text.length
  try {
    ta.setSelectionRange(pos, pos)
  } catch (err) {
    // Seçim desteklenmiyor
  }
  onComposerInput()
}

function onEmojiGridClick (e) {
  const target = e.target && e.target.closest ? e.target.closest('.emoji-button') : null
  if (!target) return
  const emoji = target.getAttribute('data-emoji')
  if (!emoji) return
  insertAtCursor(el.composerInput, emoji)
  rememberEmoji(emoji)
  if (e.shiftKey) return
  const layer = findLayer('emoji')
  if (layer) closeLayer(layer, false)
  focusNode(el.composerInput)
}

function gridColumns (buttons) {
  if (!buttons.length) return 1
  const top = buttons[0].offsetTop
  let cols = 0
  buttons.some((b) => {
    if (b.offsetTop !== top) return true
    cols += 1
    return false
  })
  return Math.max(1, cols)
}

function onEmojiGridKey (e) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (keys.indexOf(e.key) === -1) return
  const buttons = Array.from(el.emojiGrid.querySelectorAll('.emoji-button'))
  const i = buttons.indexOf(document.activeElement)
  if (i === -1) return
  e.preventDefault()
  const cols = gridColumns(buttons)
  let next = i
  if (e.key === 'ArrowLeft') next = i - 1
  else if (e.key === 'ArrowRight') next = i + 1
  else if (e.key === 'ArrowUp') next = i - cols
  else if (e.key === 'ArrowDown') next = i + cols
  else if (e.key === 'Home') next = 0
  else next = buttons.length - 1
  if (next < 0) {
    const tab = el.emojiTabs.querySelector('[aria-selected="true"]')
    focusNode(tab)
    return
  }
  focusNode(buttons[Math.min(buttons.length - 1, next)])
}

function onEmojiTabsKey (e) {
  const tabs = Array.from(el.emojiTabs.children)
  const i = tabs.indexOf(document.activeElement)
  if (i === -1) return
  let next = -1
  if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
  else if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusNode(el.emojiGrid.querySelector('.emoji-button'))
    return
  }
  if (next === -1) return
  e.preventDefault()
  selectEmojiCategory(tabs[next].getAttribute('data-category'), true, true)
}
