'use strict'

// Yazma alanı, gönderme, ek hazırlama, fotoğraf işleme, yükleme kuyruğu, ek çipleri, yapıştırma ve sürükle-bırak.
// Yazarken yazıyor bildirimi (19-typing.js) ve @ öneri listesi (18-mentions.js) bu dosyadaki olaylardan beslenir.

// Yazma alanı. Yazı kanalında grup anahtarıyla, özel mesajda kişisel anahtarlarla şifrelenir.

function autoGrow (ta, maxRows) {
  if (!ta.value) {
    // Boşken yer tutucu metni yüksekliği etkilemesin
    ta.style.height = ''
    ta.style.overflowY = 'hidden'
    return
  }
  const style = window.getComputedStyle(ta)
  const line = parseFloat(style.lineHeight) || 20
  const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  ta.style.height = 'auto'
  const max = line * maxRows + pad + border
  const next = Math.min(max, ta.scrollHeight + border)
  ta.style.height = Math.ceil(next) + 'px'
  ta.style.overflowY = ta.scrollHeight + border > max ? 'auto' : 'hidden'
}

function onComposerInput () {
  autoGrow(el.composerInput, 6)
  keepBottom()
  updateCounter()
  updateSendState()
  if (typeof typingOnInput === 'function') typingOnInput()
  if (typeof mentionOnInput === 'function') mentionOnInput()
}

// Telsiz DJ komut kancası (KONSEPT 6.10 ve 8.4, dj-interface uiIntegration 08-composer.js). Yazma alanı
// "/" ile başlayınca 18-mentions.js öneri listesi komutları gösterir. Komutların işlevini DJ arayüzü
// (23-dj.js) composerSetCommandHandler(fn) ile bağlar: fn(text, { files, pending }) metin bir DJ komutu
// değilse null döner ve metin mesaj olarak gider, komutsa bir sonuç (Promise) döner ve metin mesaj olarak
// GÖNDERİLMEZ (TelsizMusic.runCommand ile aynı sözleşme; sonucu bildirmek ve ekleri kullanmak
// işleyicinin işidir). İşleyici yokken liste yalnızca bilgilendirir, gönderim değişmez.
// Olaylar (yazma alanında, kabarcıklı CustomEvent): 'telsiz:commands' liste açılınca, süzülünce ve
// kapanınca { open, query, inVoice, items: [{ name, label }] }, 'telsiz:command-pick' komut seçilince
// { name, label, text }, 'telsiz:command' işleyiciye verilen komutta { text, files }.

let composerCommandHandler = null

function composerSetCommandHandler (fn) {
  composerCommandHandler = typeof fn === 'function' ? fn : null
  if (typeof mentionUpdate === 'function' && state.inApp) mentionUpdate()
}

function composerCommandsLive () {
  return Boolean(composerCommandHandler)
}

function composerEmit (name, detail) {
  const input = el.composerInput
  if (!input || typeof window.CustomEvent !== 'function') return
  try {
    input.dispatchEvent(new window.CustomEvent(name, { bubbles: true, detail: detail }))
  } catch (err) {
    // Olay kurulamadı (eski tarayıcı), kanca yine çalışır
  }
}

// Metin bir DJ komutuysa işleyiciye verir ve true döner (yazma alanı boşalır, mesaj gönderilmez)
function composerRunCommand (raw, text, ready) {
  if (!composerCommandHandler || text.charAt(0) !== '/') return false
  let result = null
  try {
    result = composerCommandHandler(text, { files: ready.slice(), pending: pendingUploads() })
  } catch (err) {
    window.console.error(err)
    result = null
  }
  if (result === null || result === undefined) return false
  composerEmit('telsiz:command', { text: text, files: ready.length })
  if (el.composerInput.value === raw) el.composerInput.value = ''
  if (typeof mentionClose === 'function') mentionClose()
  onComposerInput()
  Promise.resolve(result).catch((err) => {
    window.console.error(err)
  })
  return true
}

function updateCounter () {
  const len = cpLength(el.composerInput.value)
  const max = state.limits.messageMaxChars
  if (len >= COUNTER_FROM) {
    el.charCounter.hidden = false
    el.charCounter.textContent = (max - len) < 0 ? t('composer.counterOver', { count: len - max }) : t('composer.counterLeft', { count: max - len })
    el.charCounter.classList.toggle('is-error', len > max)
  } else {
    el.charCounter.hidden = true
  }
}

function pendingUploads () {
  return state.attachments.filter((a) => a.status !== 'done' && a.status !== 'error').length
}

function canSend () {
  if (!state.channelId || !conversationKeyReady() || state.sending) return false
  const len = cpLength(el.composerInput.value.trim())
  if (len > state.limits.messageMaxChars) return false
  if (pendingUploads() > 0) return false
  if (state.attachments.some((a) => a.status === 'error')) return false
  return len > 0 || state.attachments.some((a) => a.status === 'done')
}

function updateSendState () {
  el.btnSend.disabled = !canSend()
  const uploading = pendingUploads()
  el.btnSend.title = t(uploading ? 'composer.waitUploadsTitle' : 'composer.send')
}

function onComposerKeydown (e) {
  if (e.isComposing || e.keyCode === 229) return
  // Öneri listesi açıkken oklar, Enter, Tab ve Esc listeye aittir
  if (typeof mentionOnKeydown === 'function' && mentionOnKeydown(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
    return
  }
  if (e.key === 'ArrowUp' && el.composerInput.value === '' && !state.attachments.length) {
    if (editLastOwnMessage()) e.preventDefault()
  }
}

// Mesajın istemci kimliği (32 hex karakter). Sunucu aynı kimlikle gelen yinelemede yeni mesaj açmaz,
// ilk mesajı döner. Böylece yanıtı kaybolan gönderim yeniden denenince mesaj ikilenmez ve ekler
// bad_uploads hatası vermez. Kimlik, gönderilemeyen aynı metin ve ekler (aynı konuşmada) yeniden
// gönderildikçe korunur, başarılı gönderimden sonra veya metin ya da ekler değişince yenilenir.
function newClientMessageId () {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16)).join('')
}

function clientMessageIdFor (channelId, text, uploadIds) {
  const key = JSON.stringify([String(channelId), text, uploadIds])
  if (!state.unsentMessage || state.unsentMessage.key !== key) state.unsentMessage = { key: key, id: newClientMessageId() }
  return state.unsentMessage.id
}

async function sendMessage () {
  if (state.sending) return
  const channelId = state.channelId
  const raw = el.composerInput.value
  const text = raw.trim()
  if (composerRunCommand(raw, text, state.attachments.filter((a) => a.status === 'done'))) return
  if (pendingUploads() > 0) {
    toast(() => t('composer.waitUploads'))
    return
  }
  if (state.attachments.some((a) => a.status === 'error')) {
    toast(() => t('composer.removeFailed'), 'error')
    return
  }
  const ready = state.attachments.filter((a) => a.status === 'done')
  if (!text && !ready.length) return
  if (cpLength(text) > state.limits.messageMaxChars) {
    toast(() => t('composer.tooLong', { max: state.limits.messageMaxChars }), 'error')
    return
  }
  if (!channelId || !conversationKeyReady()) {
    toast(() => conversationProblemText(), 'error')
    return
  }
  const files = ready.map((a) => {
    const f = { u: a.uploadId, k: a.key, n: a.nonce, kind: a.kind, name: a.name, m: a.mime, s: a.size }
    if (a.w) f.w = a.w
    if (a.h) f.h = a.h
    return f
  })
  let body = ''
  try {
    const plain = { v: 1, a: state.me.id, c: channelId, t: text, f: files }
    body = isDmChannel(channelId) ? dmSealBody(plain, channelId) : window.E2EE.sealJson(activeKid(), plain)
  } catch (err) {
    toast(errorProducer(err, () => t('composer.sealFailed')), 'error')
    return
  }
  if (body.length > state.limits.maxBodyChars) {
    toast(() => t('composer.bodyTooLong'), 'error')
    return
  }
  state.sending = true
  updateSendState()
  if (typeof mentionClose === 'function') mentionClose()
  const uploadIds = ready.map((a) => a.uploadId)
  const payload = { channelId: channelId, body: body, clientMessageId: clientMessageIdFor(channelId, text, uploadIds) }
  if (ready.length) payload.uploads = uploadIds
  const res = await api('POST', '/api/messages', payload)
  state.sending = false
  if (res.status === 200 && res.data && res.data.message) {
    state.unsentMessage = null
    if (el.composerInput.value === raw) el.composerInput.value = ''
    ready.forEach((a) => {
      removeAttachment(a, true)
    })
    onComposerInput()
    if (typeof typingAfterSend === 'function') typingAfterSend(channelId)
    if (sameId(channelId, state.channelId)) {
      // Aramadan gelinen eski bir bölümdeyken gönderilen mesajla en yeni mesajlara dönülür
      if (state.hasNewer) {
        jumpToLatest()
      } else {
        insertMessage(res.data.message, { own: true })
        markRead()
      }
    }
    return
  }
  updateSendState()
  toast(() => errorText(res, t('composer.sendFailed'), { rate_limited: t('composer.rateLimited') }), 'error')
}

// Ek ekleme: Fotoğraf ve Dosya düğmeleri, yapıştırma, sürükle-bırak

function addFiles (fileList, mode) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  if (!conversationKeyReady()) {
    toast(() => conversationProblemText(), 'error')
    return
  }
  const max = state.limits.maxUploadsPerMessage
  let skipped = 0
  files.forEach((file) => {
    if (state.attachments.length >= max) {
      skipped += 1
      return
    }
    const photo = mode === 'photo' || (mode === 'auto' && /^image\//i.test(file.type || ''))
    state.attachSeq += 1
    const att = {
      id: state.attachSeq,
      file: file,
      photo: photo,
      name: cleanFileName(file.name || t(photo ? 'files.photoName' : 'files.defaultName')),
      status: 'processing',
      progress: 0,
      kind: 'file',
      mime: '',
      size: file.size || 0,
      w: 0,
      h: 0,
      previewUrl: '',
      box: null,
      key: '',
      nonce: '',
      uploadId: '',
      xhr: null,
      error: '',
      removed: false
    }
    state.attachments.push(att)
    processAttachment(att)
  })
  if (skipped) toast(() => t('attach.max', { max: max }), 'error')
  renderAttachments()
  updateSendState()
}

async function processAttachment (att) {
  try {
    const bytes = await readBlobBytes(att.file)
    if (att.removed) return
    let out = { bytes: bytes, kind: 'file', mime: (att.file.type || 'application/octet-stream').slice(0, 100), w: 0, h: 0, name: att.name }
    if (att.photo) out = await processPhoto(bytes, att)
    if (att.removed) return
    if (out.bytes.length + 16 > state.limits.uploadMaxBytes) {
      throw textError(() => t('attach.tooBig', { max: formatSize(state.limits.uploadMaxBytes - 16) }))
    }
    att.kind = out.kind
    att.mime = out.mime
    att.size = out.bytes.length
    att.w = out.w
    att.h = out.h
    att.name = out.name
    if (out.kind === 'image' && IMAGE_TYPES.indexOf(out.mime) !== -1) {
      att.previewUrl = URL.createObjectURL(new Blob([out.bytes], { type: out.mime }))
    }
    att.status = 'encrypting'
    renderAttachments()
    await wait(0)
    if (att.removed) return
    const enc = window.E2EE.encryptFile(out.bytes)
    att.box = enc.box
    att.key = enc.key
    att.nonce = enc.nonce
    att.status = 'queued'
    renderAttachments()
    pumpUploads()
  } catch (err) {
    if (att.removed) return
    att.status = 'error'
    att.error = errorProducer(err, () => t('attach.prepareFailed'))
    renderAttachments()
    updateSendState()
  }
}

// Fotoğraf işleme: GIF olduğu gibi, diğerleri canvas ile yeniden kodlanır.
// Yeniden kodlama EXIF ve konum dahil tüm üst veriyi siler.
async function processPhoto (bytes, att) {
  const sniffed = window.E2EE.sniffImage(bytes)
  const declared = String(att.file.type || '').toLowerCase()
  if (sniffed === 'image/gif') {
    const dims = await decodeImage(bytes, 'image/gif')
    if (dims) dims.release()
    return { bytes: bytes, kind: 'image', mime: 'image/gif', w: dims ? dims.w : 0, h: dims ? dims.h : 0, name: att.name }
  }
  const decodeType = sniffed || (declared.indexOf('image/') === 0 ? declared : 'application/octet-stream')
  const decoded = await decodeImage(bytes, decodeType)
  if (!decoded) {
    return { bytes: bytes, kind: 'file', mime: (declared || 'application/octet-stream').slice(0, 100), w: 0, h: 0, name: att.name }
  }
  const wantPng = sniffed === 'image/png'
  let encoded = null
  try {
    encoded = await reencode(decoded.image, wantPng ? 'image/png' : 'image/jpeg')
  } catch (err) {
    encoded = null
  }
  decoded.release()
  if (encoded) {
    const ext = IMAGE_EXT[encoded.mime] || 'jpg'
    return { bytes: encoded.bytes, kind: 'image', mime: encoded.mime, w: encoded.w, h: encoded.h, name: cleanFileName(replaceExt(att.name, ext)) }
  }
  // Canvas başarısız: JPEG ve diğerleri özgün gönderilmez, konum bilgisi sızabilir
  if (sniffed === 'image/png' || sniffed === 'image/webp') {
    return { bytes: bytes, kind: 'image', mime: sniffed, w: decoded.w, h: decoded.h, name: att.name }
  }
  throw textError(() => t('attach.photoFailed'))
}

function decodeImage (bytes, type) {
  return new Promise((resolve) => {
    let url = ''
    let done = false
    const img = new Image()
    const release = () => {
      if (url) {
        try {
          URL.revokeObjectURL(url)
        } catch (err) {
          // Zaten bırakılmış
        }
        url = ''
      }
    }
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (ok && img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ image: img, w: img.naturalWidth, h: img.naturalHeight, release: release })
      } else {
        release()
        resolve(null)
      }
    }
    const timer = setTimeout(() => {
      finish(false)
    }, 30000)
    img.onload = () => {
      finish(true)
    }
    img.onerror = () => {
      finish(false)
    }
    try {
      url = URL.createObjectURL(new Blob([bytes], { type: type }))
      img.src = url
    } catch (err) {
      finish(false)
    }
  })
}

function canvasToBytes (canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('toBlob failed'))
            return
          }
          readBlobBytes(blob).then(resolve, reject)
        }, type, quality)
        return
      } catch (err) {
        reject(err)
        return
      }
    }
    try {
      const dataUrl = canvas.toDataURL(type, quality)
      const comma = dataUrl.indexOf(',')
      const bin = window.atob(dataUrl.slice(comma + 1))
      const out = new Uint8Array(bin.length)
      let i = 0
      while (i < bin.length) {
        out[i] = bin.charCodeAt(i)
        i += 1
      }
      resolve(out)
    } catch (err) {
      reject(err)
    }
  })
}

async function reencode (image, type) {
  const w0 = image.naturalWidth
  const h0 = image.naturalHeight
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const hh = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = hh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  if (type === 'image/jpeg') {
    // Saydam alanlar JPEG'de siyah görünmesin
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, hh)
  }
  ctx.drawImage(image, 0, 0, w, hh)
  const bytes = await canvasToBytes(canvas, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
  const actual = window.E2EE.sniffImage(bytes)
  if (!actual || IMAGE_TYPES.indexOf(actual) === -1) throw new Error('encoding failed')
  canvas.width = 1
  canvas.height = 1
  return { bytes: bytes, mime: actual, w: w, h: hh }
}

// Yükleme kuyruğu: en fazla iki eşzamanlı yükleme, 503'te 2 sn arayla 3 kez yeniden deneme.

function pumpUploads () {
  while (state.activeUploads < UPLOAD_PARALLEL) {
    const next = state.attachments.filter((a) => a.status === 'queued')[0]
    if (!next) return
    runUpload(next)
  }
}

async function runUpload (att) {
  state.activeUploads += 1
  att.status = 'uploading'
  att.progress = 0
  renderAttachments()
  let tries = 0
  while (!att.removed) {
    const pending = request('POST', '/api/uploads', {
      binary: att.box,
      timeout: TRANSFER_TIMEOUT_MS,
      onUploadProgress: (e) => {
        if (e && e.lengthComputable && e.total > 0) {
          att.progress = e.loaded / e.total
          updateChipProgress(att)
        }
      }
    })
    att.xhr = pending
    const res = await pending
    att.xhr = null
    if (att.removed) break
    if (res.status === 200 && res.data && typeof res.data.id === 'string' && UPLOAD_ID_RE.test(res.data.id)) {
      att.uploadId = res.data.id
      att.status = 'done'
      att.progress = 1
      att.box = null
      break
    }
    if (res.status === 503 && tries < UPLOAD_RETRY_MAX) {
      tries += 1
      att.status = 'retry'
      att.error = () => errorText(res, t('attach.busy'))
      renderAttachments()
      await wait(UPLOAD_RETRY_MS)
      if (att.removed) break
      att.status = 'uploading'
      att.progress = 0
      renderAttachments()
      continue
    }
    checkAuthFailure(res)
    att.status = 'error'
    att.error = () => errorText(res, t('attach.uploadFailed'), { rate_limited: t('attach.rateLimited') })
    break
  }
  state.activeUploads -= 1
  renderAttachments()
  updateSendState()
  pumpUploads()
}

function removeAttachment (att, keepFocus) {
  att.removed = true
  if (att.xhr) att.xhr.abort()
  if (att.previewUrl) {
    try {
      URL.revokeObjectURL(att.previewUrl)
    } catch (err) {
      // Zaten bırakılmış
    }
  }
  att.box = null
  state.attachments = state.attachments.filter((a) => a !== att)
  renderAttachments()
  updateSendState()
  if (!keepFocus) focusNode(el.composerInput.disabled ? el.btnFile : el.composerInput)
}

function clearAttachments () {
  state.attachments.slice().forEach((att) => {
    removeAttachment(att, true)
  })
}

// Ek çipleri

function chipStatusText (att) {
  const pct = Math.round(att.progress * 100)
  switch (att.status) {
    case 'processing': return t('attach.status.processing')
    case 'encrypting': return t('attach.status.encrypting')
    case 'queued': return t('attach.status.queued')
    case 'uploading': return t('attach.status.uploading', { pct: pct })
    case 'retry': return t('attach.status.retry')
    case 'done': return t('attach.status.done')
    case 'error': return textOf(att.error) || t('attach.status.error')
    default: return ''
  }
}

function renderAttachments () {
  const list = el.attachList
  const focusKey = activeFocusKey(list)
  clear(list)
  state.attachments.forEach((att) => {
    const li = h('li', 'chip chip-' + att.status)
    li.setAttribute('data-attach-id', String(att.id))
    if (att.previewUrl) {
      const img = h('img', 'chip-preview')
      img.alt = ''
      img.src = att.previewUrl
      li.appendChild(img)
    } else {
      li.appendChild(icon(att.photo && att.status === 'processing' ? 'i-image' : (FILE_ICONS[fileKind(att.name)] || 'i-file'), 'chip-icon'))
    }
    const info = h('span', 'chip-info')
    info.appendChild(h('span', 'chip-name', att.name))
    const meta = h('span', 'chip-meta')
    meta.textContent = t('attach.meta', { size: formatSize(att.size), status: chipStatusText(att) })
    info.appendChild(meta)
    const bar = h('span', 'chip-bar')
    const fill = h('span', 'chip-bar-fill')
    fill.style.width = Math.round((att.status === 'done' ? 1 : att.progress) * 100) + '%'
    bar.appendChild(fill)
    info.appendChild(bar)
    li.appendChild(info)
    const remove = button('icon-button chip-remove', '', 'i-close', t('attach.remove', { name: att.name }))
    remove.setAttribute('data-focus-key', 'remove-' + att.id)
    remove.addEventListener('click', () => {
      removeAttachment(att, false)
    })
    li.appendChild(remove)
    list.appendChild(li)
  })
  list.hidden = state.attachments.length === 0
  el.photoNote.hidden = !state.attachments.some((a) => a.photo)
  restoreFocusKey(list, focusKey)
  keepBottom()
}

function updateChipProgress (att) {
  const li = Array.from(el.attachList.children).filter((node) => node.getAttribute('data-attach-id') === String(att.id))[0]
  if (!li) return
  const fill = li.querySelector('.chip-bar-fill')
  const meta = li.querySelector('.chip-meta')
  const pct = Math.round(att.progress * 100)
  if (fill) fill.style.width = pct + '%'
  if (meta) meta.textContent = t('attach.meta', { size: formatSize(att.size), status: chipStatusText(att) })
}

// Yapıştırma ve sürükle-bırak

function onPaste (e) {
  const data = e.clipboardData
  if (!data) return
  let files = Array.from(data.files || [])
  if (!files.length && data.items) {
    files = Array.from(data.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
  }
  if (!files.length) return
  e.preventDefault()
  addFiles(files, 'auto')
}

let dragDepth = 0

function hasDraggedFiles (e) {
  const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : []
  return types.indexOf('Files') !== -1
}

function onDragEnter (e) {
  if (!hasDraggedFiles(e)) return
  e.preventDefault()
  dragDepth += 1
  if (conversationKeyReady()) el.dropOverlay.hidden = false
}

function onDragOver (e) {
  if (!hasDraggedFiles(e)) return
  e.preventDefault()
  try {
    e.dataTransfer.dropEffect = 'copy'
  } catch (err) {
    // Bazı tarayıcılarda salt okunur
  }
}

function onDragLeave (e) {
  if (!hasDraggedFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) el.dropOverlay.hidden = true
}

function onDrop (e) {
  if (!hasDraggedFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  el.dropOverlay.hidden = true
  addFiles(e.dataTransfer.files, 'auto')
}
