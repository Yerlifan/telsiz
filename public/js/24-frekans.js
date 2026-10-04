'use strict'

// Frekanslar: her Telsiz sunucusu bir frekanstır, kişi birden çok frekansa katılabilir. Üst çubuğun
// solundaki frekans adına (#frekans-button) basınca kayıtlı frekansların menüsü (#frekans-menu) açılır:
// açık frekans işaretli ve başta, diğerleri seçilince o frekansa geçilir, en altta Frekans ekle, her
// satırda Listeden çıkar. Menü katman yığınını kullanır (02-state-dom.js): ok tuşları, Home ve End gezer,
// Esc ve kolun daire düğmesi kapatır, odak açan düğmeye döner.
//
// İki çalışma biçimi vardır:
// - Masaüstü uygulaması (20-desktop.js window.telsizDesktop): liste ana süreçte tutulur ve doğrulanır,
//   geçişte uygulama penceresi o frekansın oturum bölümüyle yeniden açılır (her frekansın girişi ayrı
//   korunur). Frekans ekle masaüstünün adres penceresini açar.
// - Tarayıcı ve PWA: tarayıcı her kökeni yalıttığı için bu sayfa başka frekansların sunucusuna bağlanamaz
//   (CSP connect-src 'self'). Liste yalnızca bu tarayıcıda, bu kökenin yerel deposunda tutulur
//   ('telsiz.frekanslar'). Başka bir frekans seçilince sekme o adrese gider (location.assign) ve liste
//   adresin # parçasında taşınır: #frekanslar=<base64url JSON>. Karşı köken açılışta parçayı okur
//   (03-auth.js readFragment), her öğeyi sıkı biçimde doğrular, kendi listesine ekler ve parçayı adresten
//   siler. Parçada yalnızca adresler ve görünen adlar vardır, hiçbir anahtar veya oturum bilgisi yoktur.
//   Davet bağlantısının #davet= ve #anahtar= parçalarıyla çakışmaz (ayrı ad, base64url & ve = içermez).
//
// Adres kuralları masaüstüyle aynıdır (desktop/src/lib/server-url.js): yalnızca https://, tek istisna bu
// bilgisayardaki sunucu (http://localhost ve http://127.0.0.1). Kullanıcı adı, parola, yol, sorgu ve #
// bulunamaz. Saklanan değer normalleştirilmiş kökendir.

const FREKANS_STORAGE_KEY = 'telsiz.frekanslar'
const FREKANS_FRAGMENT_KEY = 'frekanslar'
const FREKANS_MAX_ITEMS = 30
const FREKANS_MAX_NAME = 100
const FREKANS_MAX_INPUT = 300
const FREKANS_MAX_FRAGMENT = 8000
const FREKANS_LOOPBACK = ['localhost', '127.0.0.1']

const frekansState = {
  bound: false,
  reportedName: null,
  desktopItems: null
}

// ------------------------------------------------------------------ doğrulama ve liste

function frekansUnsafeCode (code) {
  return code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
}

// Kullanıcının yazdığı adresi doğrular. Şema yazılmamışsa https:// varsayılır.
// Sonuç: { ok: true, origin } veya { ok: false, code } (code: invalid, too_long, insecure, credentials, path)
function frekansParseAddress (input) {
  if (typeof input !== 'string') return { ok: false, code: 'invalid' }
  const text = input.trim()
  if (text === '') return { ok: false, code: 'invalid' }
  if (text.length > FREKANS_MAX_INPUT) return { ok: false, code: 'too_long' }
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || code === 0x5c || frekansUnsafeCode(code)) return { ok: false, code: 'invalid' }
    i += 1
  }
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? text : 'https://' + text
  let url = null
  try {
    url = new URL(candidate)
  } catch (err) {
    return { ok: false, code: 'invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, code: 'invalid' }
  if (url.hostname === '') return { ok: false, code: 'invalid' }
  if (url.protocol === 'http:' && FREKANS_LOOPBACK.indexOf(url.hostname) === -1) return { ok: false, code: 'insecure' }
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'credentials' }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return { ok: false, code: 'path' }
  // Ayrıştırıcının sildiği parçalar da reddedilir (yalnızca ? veya # ile biten adresler, /%2e%2e/ gibi yollar)
  const rest = candidate.slice(candidate.indexOf('//') + 2)
  const cut = rest.search(/[/?#]/)
  if (cut !== -1 && rest.slice(cut) !== '/') return { ok: false, code: 'path' }
  return { ok: true, origin: url.protocol + '//' + url.host }
}

// Saklanmış veya parçadan gelen kökenin hâlâ geçerli ve normalleştirilmiş olup olmadığı
function frekansValidOrigin (value) {
  if (typeof value !== 'string') return false
  const parsed = frekansParseAddress(value)
  return parsed.ok && parsed.origin === value
}

// Görünen ad tek satır, en fazla FREKANS_MAX_NAME karakter. Geçersizse null.
function frekansCleanName (value) {
  if (typeof value !== 'string') return null
  let out = ''
  let i = 0
  while (i < value.length) {
    out += frekansUnsafeCode(value.charCodeAt(i)) ? ' ' : value.charAt(i)
    i += 1
  }
  out = out.replace(/\s+/g, ' ').trim()
  if (out === '' || out.length > FREKANS_MAX_NAME) return null
  return out
}

// Liste doğrulaması: geçerli köken, yinelenen yok, en fazla FREKANS_MAX_ITEMS öğe. exclude: listeye
// alınmayacak köken (bu sayfanın kendi kökeni).
function frekansSanitizeList (raw, exclude) {
  const out = []
  if (!Array.isArray(raw)) return out
  const seen = {}
  raw.forEach((item) => {
    if (out.length >= FREKANS_MAX_ITEMS || !item || typeof item !== 'object' || Array.isArray(item)) return
    const origin = item.origin
    if (!frekansValidOrigin(origin) || origin === exclude || Object.prototype.hasOwnProperty.call(seen, origin)) return
    seen[origin] = true
    out.push({ origin: origin, name: frekansCleanName(item.name) })
  })
  return out
}

// Gelen listeyi yerel listeye ekler. Yerelde zaten olan frekansın adı korunur (başka bir kökenden gelen
// ad yerel adı ezemez), yeni frekanslar gelen adla eklenir. Sonuç yeni bir dizidir.
function frekansMergeLists (local, incoming, exclude) {
  const out = frekansSanitizeList(local, exclude)
  const known = {}
  out.forEach((item) => {
    known[item.origin] = true
  })
  frekansSanitizeList(incoming, exclude).forEach((item) => {
    if (out.length >= FREKANS_MAX_ITEMS || Object.prototype.hasOwnProperty.call(known, item.origin)) return
    known[item.origin] = true
    out.push(item)
  })
  return out
}

function frekansHost (origin) {
  try {
    return new URL(origin).host
  } catch (err) {
    return String(origin || '')
  }
}

function frekansDisplayName (item) {
  return item && item.name ? item.name : frekansHost(item ? item.origin : '')
}

// ------------------------------------------------------------------ adres parçası (base64url JSON)

function frekansToBase64Url (text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  let i = 0
  while (i < bytes.length) {
    bin += String.fromCharCode(bytes[i])
    i += 1
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function frekansFromBase64Url (text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  let bin = ''
  try {
    bin = atob(b64)
  } catch (err) {
    return null
  }
  const bytes = new Uint8Array(bin.length)
  let i = 0
  while (i < bin.length) {
    bytes[i] = bin.charCodeAt(i)
    i += 1
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (err) {
    return null
  }
}

// Liste parçaya yazılır: { v: 1, f: [[köken, ad veya null], ...] }. Yalnızca adres ve ad taşınır.
function frekansEncodeList (list) {
  const items = frekansSanitizeList(list, null).map((item) => [item.origin, item.name])
  let text = frekansToBase64Url(JSON.stringify({ v: 1, f: items }))
  // Çok uzunsa sondan kısaltılır (adres çubuğu sınırları)
  while (text.length > FREKANS_MAX_FRAGMENT && items.length > 1) {
    items.pop()
    text = frekansToBase64Url(JSON.stringify({ v: 1, f: items }))
  }
  return text
}

// Parçadaki listeyi çözer, her öğeyi doğrular. Bozuk veya beklenmeyen biçimde boş dizi döner.
function frekansDecodeList (text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > FREKANS_MAX_FRAGMENT) return []
  const json = frekansFromBase64Url(text)
  if (json === null) return []
  let data = null
  try {
    data = JSON.parse(json)
  } catch (err) {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1 || !Array.isArray(data.f)) return []
  const raw = []
  data.f.slice(0, FREKANS_MAX_ITEMS * 2).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 1 || pair.length > 2) return
    if (pair[1] !== undefined && pair[1] !== null && typeof pair[1] !== 'string') return
    raw.push({ origin: pair[0], name: pair[1] })
  })
  return frekansSanitizeList(raw, null)
}

// ------------------------------------------------------------------ tarayıcıdaki liste

function frekansSelfOrigin () {
  try {
    return window.location.origin
  } catch (err) {
    return ''
  }
}

function frekansReadLocal () {
  let raw = null
  try {
    raw = window.localStorage.getItem(FREKANS_STORAGE_KEY)
  } catch (err) {
    raw = null
  }
  if (!raw || raw.length > 64 * 1024) return []
  try {
    return frekansSanitizeList(JSON.parse(raw), frekansSelfOrigin())
  } catch (err) {
    return []
  }
}

function frekansWriteLocal (list) {
  const clean = frekansSanitizeList(list, frekansSelfOrigin())
  try {
    window.localStorage.setItem(FREKANS_STORAGE_KEY, JSON.stringify(clean))
  } catch (err) {
    // Depolama kapalı veya dolu: liste bu oturumla sınırlı kalır
  }
  return clean
}

// 03-auth.js readFragment çağırır: #frekanslar= parçasındaki listeyi yerel listeye ekler
function frekansMergeFragment (value) {
  if (frekansDesktop()) return 0
  const incoming = frekansDecodeList(value)
  if (!incoming.length) return 0
  const before = frekansReadLocal()
  const merged = frekansMergeLists(before, incoming, frekansSelfOrigin())
  frekansWriteLocal(merged)
  return merged.length - before.length
}

// ------------------------------------------------------------------ masaüstü

function frekansDesktop () {
  const d = window.telsizDesktop
  return d && typeof d === 'object' && typeof d.listFrequencies === 'function' ? d : null
}

// Sunucunun adı öğrenilince (03-auth.js applyInfo, 04-meta.js renderServerName) masaüstüne bildirilir
function frekansNoteName (name) {
  const d = frekansDesktop()
  if (!d || typeof d.setFrequencyName !== 'function' || !state.info) return
  const clean = frekansCleanName(name)
  if (!clean || clean === frekansState.reportedName) return
  frekansState.reportedName = clean
  Promise.resolve(d.setFrequencyName(clean)).catch(() => {})
}

// Menüde gösterilecek liste: [{ origin, name, host, active }], açık frekans başta
function frekansLoadItems () {
  const d = frekansDesktop()
  if (d) {
    return Promise.resolve(d.listFrequencies()).then((data) => {
      const items = data && Array.isArray(data.items) ? data.items : []
      return items.filter((item) => item && frekansValidOrigin(item.origin)).map((item) => ({
        origin: item.origin,
        name: item.active ? (frekansCleanName(state.serverName) || frekansCleanName(item.name)) : frekansCleanName(item.name),
        host: frekansHost(item.origin),
        active: item.active === true
      })).sort((a, b) => (a.active === b.active ? 0 : (a.active ? -1 : 1)))
    }, () => [])
  }
  const self = frekansSelfOrigin()
  const items = [{ origin: self, name: frekansCleanName(state.serverName), host: frekansHost(self), active: true }]
  frekansReadLocal().forEach((item) => {
    items.push({ origin: item.origin, name: item.name, host: frekansHost(item.origin), active: false })
  })
  return Promise.resolve(items)
}

// ------------------------------------------------------------------ geçiş, ekleme, çıkarma

function frekansSwitch (origin) {
  const d = frekansDesktop()
  if (d) {
    Promise.resolve(d.switchFrequency(origin)).then((res) => {
      if (!res || !res.ok) toast(() => t('frekans.failed'), 'error')
    }, () => toast(() => t('frekans.failed'), 'error'))
    return
  }
  if (!frekansValidOrigin(origin) || origin === frekansSelfOrigin()) return
  // Karşı köken bu sekmenin listesini parçadan alır: bu frekans (adıyla) ve diğer kayıtlı frekanslar
  const self = frekansSelfOrigin()
  const list = frekansReadLocal()
  if (frekansValidOrigin(self)) list.unshift({ origin: self, name: frekansCleanName(state.serverName) })
  const target = origin + '/#' + FREKANS_FRAGMENT_KEY + '=' + frekansEncodeList(list)
  try {
    window.location.assign(target)
  } catch (err) {
    toast(() => t('frekans.failed'), 'error')
  }
}

function frekansAdd (trigger) {
  const d = frekansDesktop()
  if (d) {
    Promise.resolve(d.addFrequency()).catch(() => {})
    return
  }
  openAppDialog({
    name: 'frekans-add',
    titleKey: 'frekans.add',
    trigger: trigger,
    build: (body, close) => {
      const form = h('form', 'form frekans-add-form')
      form.id = 'frekans-add-form'
      form.noValidate = true
      form.appendChild(h('p', 'lead', t('frekans.addLead')))
      const label = h('label', 'label', t('frekans.addressLabel'))
      label.setAttribute('for', 'frekans-add-input')
      const input = h('input', 'input')
      input.id = 'frekans-add-input'
      input.type = 'text'
      input.setAttribute('inputmode', 'url')
      input.setAttribute('autocomplete', 'url')
      input.setAttribute('autocapitalize', 'off')
      input.setAttribute('spellcheck', 'false')
      input.maxLength = FREKANS_MAX_INPUT
      input.setAttribute('placeholder', 'https://')
      input.setAttribute('aria-describedby', 'frekans-add-hint frekans-add-error')
      const hint = h('p', 'hint', t('frekans.addressHint'))
      hint.id = 'frekans-add-hint'
      const msg = h('p', 'form-error')
      msg.id = 'frekans-add-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('frekans.addSubmit'))
      save.type = 'submit'
      save.id = 'frekans-add-submit'
      row.appendChild(save)
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(hint)
      form.appendChild(msg)
      form.appendChild(row)
      const fail = (text) => {
        msg.textContent = text
        msg.hidden = false
        input.setAttribute('aria-invalid', 'true')
        focusNode(input)
      }
      input.addEventListener('input', () => {
        msg.hidden = true
        input.removeAttribute('aria-invalid')
      })
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const parsed = frekansParseAddress(input.value)
        if (!parsed.ok) {
          fail(t('frekans.error.' + parsed.code))
          return
        }
        const list = frekansReadLocal()
        if (parsed.origin === frekansSelfOrigin() || list.some((item) => item.origin === parsed.origin)) {
          fail(t('frekans.exists'))
          return
        }
        if (list.length >= FREKANS_MAX_ITEMS) {
          fail(t('frekans.error.full', { max: FREKANS_MAX_ITEMS }))
          return
        }
        list.push({ origin: parsed.origin, name: null })
        frekansWriteLocal(list)
        close('saved')
        const host = frekansHost(parsed.origin)
        toast(() => t('frekans.added', { name: host }), 'ok')
      })
      body.appendChild(form)
      return input
    }
  })
}

function frekansRemove (item, trigger) {
  const d = frekansDesktop()
  const name = frekansDisplayName(item)
  openAppDialog({
    name: 'frekans-remove',
    titleKey: 'frekans.removeTitle',
    trigger: trigger,
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('frekans.removeText', { name: name, host: item.host })))
      let clearBox = null
      if (d && item.active) body.appendChild(h('p', 'hint', t('frekans.removeActiveNote')))
      if (d) {
        // Masaüstünde oturum verisi yalnızca açıkça seçilirse silinir, varsayılan korumaktır
        const wrap = h('label', 'check frekans-remove-clear')
        clearBox = h('input')
        clearBox.type = 'checkbox'
        clearBox.id = 'frekans-remove-clear'
        clearBox.checked = false
        wrap.appendChild(clearBox)
        wrap.appendChild(h('span', null, t('frekans.removeClear')))
        body.appendChild(wrap)
        body.appendChild(h('p', 'hint', t('frekans.removeClearHint')))
      }
      const row = h('div', 'row dialog-actions')
      const confirm = button('button button-danger', t('frekans.removeConfirm'))
      confirm.id = 'frekans-remove-confirm'
      const cancel = button('button button-secondary', t('common.cancel'))
      cancel.id = 'frekans-remove-cancel'
      row.appendChild(confirm)
      row.appendChild(cancel)
      body.appendChild(row)
      cancel.addEventListener('click', () => close('dismiss'))
      confirm.addEventListener('click', () => {
        if (d) {
          confirm.disabled = true
          Promise.resolve(d.removeFrequency(item.origin, Boolean(clearBox && clearBox.checked))).then((res) => {
            close('done')
            if (res && res.ok) toast(() => t('frekans.removed', { name: name }), 'ok')
            else toast(() => t('frekans.failed'), 'error')
          }, () => {
            close('done')
            toast(() => t('frekans.failed'), 'error')
          })
          return
        }
        frekansWriteLocal(frekansReadLocal().filter((entry) => entry.origin !== item.origin))
        close('done')
        toast(() => t('frekans.removed', { name: name }), 'ok')
      })
      return cancel
    }
  })
}

// ------------------------------------------------------------------ menü

function frekansCloseMenu () {
  const layer = findLayer('frekans-menu')
  if (layer) closeLayer(layer, false)
}

// Menü üst çubuktaki düğmenin altında, solda açılır ve görünür alanda kalır
function frekansPositionMenu (menu, anchor) {
  const rect = anchor.getBoundingClientRect()
  menu.style.left = '0px'
  menu.style.top = '0px'
  const pw = menu.offsetWidth
  const ph = menu.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.left
  if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw)
  if (left < 8) left = 8
  let top = rect.bottom + 6
  if (top + ph > vh - 8) top = Math.max(8, vh - 8 - ph)
  menu.style.left = Math.round(left) + 'px'
  menu.style.top = Math.round(top) + 'px'
}

function frekansEmblem (name) {
  const em = h('span', 'frekans-emblem', initial(name))
  em.setAttribute('aria-hidden', 'true')
  return em
}

function frekansItemRow (item, desktop, anchor) {
  const name = frekansDisplayName(item)
  const row = h('div', 'frekans-row' + (item.active ? ' is-active' : ''))
  row.setAttribute('role', 'none')
  const main = h('button', 'menu-item frekans-item')
  main.type = 'button'
  main.setAttribute('role', 'menuitemradio')
  main.setAttribute('aria-checked', item.active ? 'true' : 'false')
  main.setAttribute('data-frekans', item.origin)
  main.setAttribute('aria-label', item.active ? t('frekans.activeLabel', { name: name, host: item.host }) : t('frekans.switchLabel', { name: name, host: item.host }))
  main.appendChild(frekansEmblem(name))
  const text = h('span', 'frekans-item-text')
  text.appendChild(h('span', 'frekans-item-name', name))
  // Adı henüz bilinmeyen frekansta ad yerine adres yazar, alt satır tekrarlanmaz
  if (item.active) text.appendChild(h('span', 'frekans-item-sub', t('frekans.activeSub', { host: item.host })))
  else if (item.name) text.appendChild(h('span', 'frekans-item-sub', item.host))
  main.appendChild(text)
  if (item.active) main.appendChild(icon('i-check', 'frekans-item-check'))
  main.addEventListener('click', () => {
    frekansCloseMenu()
    if (!item.active) frekansSwitch(item.origin)
  })
  row.appendChild(main)
  // Tarayıcıda açık frekans listeden çıkarılamaz (bu sayfanın kendisidir)
  if (desktop || !item.active) {
    const remove = h('button', 'icon-button frekans-remove')
    remove.type = 'button'
    remove.setAttribute('role', 'menuitem')
    remove.setAttribute('data-frekans-remove', item.origin)
    const label = t('frekans.removeLabel', { name: name })
    remove.setAttribute('aria-label', label)
    remove.title = label
    remove.appendChild(icon('i-close'))
    remove.addEventListener('click', () => {
      frekansCloseMenu()
      frekansRemove(item, anchor)
    })
    row.appendChild(remove)
  }
  return row
}

function frekansBuildMenu (menu, items, anchor) {
  clear(menu)
  const desktop = Boolean(frekansDesktop())
  menu.appendChild(h('p', 'kicker frekans-kicker', t('frekans.kicker')))
  const list = h('div', 'frekans-list')
  list.setAttribute('role', 'group')
  list.setAttribute('aria-label', t('frekans.title'))
  items.forEach((item) => {
    list.appendChild(frekansItemRow(item, desktop, anchor))
  })
  menu.appendChild(list)
  menu.appendChild(menuSeparator())
  const add = h('button', 'menu-item menu-entry frekans-add')
  add.type = 'button'
  add.id = 'frekans-add'
  add.setAttribute('role', 'menuitem')
  add.appendChild(icon('i-plus'))
  const addText = h('span', 'frekans-item-text')
  addText.appendChild(h('span', 'frekans-item-name', t('frekans.add')))
  addText.appendChild(h('span', 'frekans-item-sub', t('frekans.addSub')))
  add.appendChild(addText)
  add.addEventListener('click', () => {
    frekansCloseMenu()
    frekansAdd(anchor)
  })
  menu.appendChild(add)
  const inVoice = typeof snap === 'function' && Boolean(snap().channelId)
  if (inVoice && items.length > 1) menu.appendChild(h('p', 'hint frekans-note', t('frekans.voiceNote')))
  if (!desktop && items.length > 1) menu.appendChild(h('p', 'hint frekans-note', t('frekans.webNote')))
  menu.addEventListener('keydown', onPopupMenuKey)
}

function frekansOpenMenu (anchor) {
  const menu = byId('frekans-menu')
  if (!menu || !state.inApp) return
  const existing = findLayer('frekans-menu')
  if (existing) {
    closeLayer(existing, false)
    return
  }
  frekansLoadItems().then((items) => {
    if (!state.inApp || findLayer('frekans-menu')) return
    frekansBuildMenu(menu, items, anchor)
    menu.hidden = false
    if (anchor) {
      frekansPositionMenu(menu, anchor)
      anchor.setAttribute('aria-expanded', 'true')
    }
    openLayer({
      name: 'frekans-menu',
      el: menu,
      trigger: anchor || null,
      level: 2,
      outside: true,
      closeOnFocusOut: true,
      initialFocus: () => menu.querySelector('.frekans-item[aria-checked="true"]') || menu.querySelector('button'),
      onClose: () => {
        menu.hidden = true
        menu.removeEventListener('keydown', onPopupMenuKey)
        clear(menu)
        if (anchor) anchor.setAttribute('aria-expanded', 'false')
      }
    })
  })
}

// Üst çubuktaki düğmenin erişilebilir adı (04-meta.js renderServerName çağırır)
function frekansRenderButton () {
  const b = byId('frekans-button')
  if (!b) return
  b.setAttribute('aria-label', t('frekans.buttonLabel', { name: state.serverName || t('app.name') }))
}

function frekansInit () {
  if (frekansState.bound) return
  const b = byId('frekans-button')
  if (!b) return
  frekansState.bound = true
  b.addEventListener('click', () => {
    frekansOpenMenu(b)
  })
}

window.TelsizFrekans = {
  parseAddress: frekansParseAddress,
  validOrigin: frekansValidOrigin,
  cleanName: frekansCleanName,
  sanitizeList: frekansSanitizeList,
  mergeLists: frekansMergeLists,
  encodeList: frekansEncodeList,
  decodeList: frekansDecodeList,
  mergeFragment: frekansMergeFragment,
  readLocal: frekansReadLocal,
  open: frekansOpenMenu
}
