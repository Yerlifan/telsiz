'use strict'

// Frekans tanıtımı: oturum açmamış ziyaretçinin bir frekansın adresini açınca ilk gördüğü sayfa
// (#tanitim, giriş görünümünün içinde, giriş kartının yerine). Frekans adı ve sahibin herkese açık tanıtım
// metni GET /api/info yanıtından gelir (03-auth.js applyInfo, state.info.about). Tanıtım metni yalnızca
// textContent ile yazılır, satır sonları CSS ile korunur, bağlantılar etkinleştirilmez.
//
// Ne zaman gösterilir (03-auth.js loadInfo, tanitimShouldShow): kurulum gerekmiyorsa, saklı oturum yoksa,
// adreste #davet=, #anahtar= veya #frekanslar= parçası gelmediyse (bunlar doğrudan kayıt, giriş veya
// frekans geçişine gider, state.fragmentSeen), oturumda bekleyen davet kodu yoksa, masaüstü uygulamasında
// değilse (masaüstünde frekans zaten bilerek eklenmiştir, doğrudan giriş kartı açılır) ve bu tarayıcıda bu
// frekansa daha önce giriş yapılmadıysa (telsiz.tanitim.gecildi, başarılı oturumda yazılır). Giriş kartındaki
// "Telsiz'i tanı" düğmesi sayfayı her zaman yeniden açar.

const TANITIM_KEY = 'telsiz.tanitim.gecildi'
// Belge bağlantıları dile göre: Türkçe belge ve İngilizce eşi (GitHub başlık çapalarıyla)
const TANITIM_DOCS = {
  'tanitim-docs': {
    tr: 'https://github.com/Yerlifan/telsiz#readme',
    en: 'https://github.com/Yerlifan/telsiz/blob/main/README.en.md'
  },
  'tanitim-guide-link': {
    tr: 'https://github.com/Yerlifan/telsiz/blob/main/docs/KURULUM.md#vps-ve-alan-ad%C4%B1yla-ad%C4%B1m-ad%C4%B1m',
    en: 'https://github.com/Yerlifan/telsiz/blob/main/docs/DEPLOYMENT.md#step-by-step-with-a-vps-and-a-domain'
  }
}

let tanitimReady = false
const tanitimEl = {}

function tanitimCache () {
  if (tanitimReady) return Boolean(tanitimEl.root)
  tanitimReady = true
  const ids = ['tanitim', 'tanitim-name', 'tanitim-host', 'tanitim-about-wrap', 'tanitim-about', 'tanitim-login', 'tanitim-join',
    'tanitim-join-note', 'tanitim-join-code', 'tanitim-desktop', 'tanitim-version', 'tanitim-back']
  ids.forEach((id) => {
    tanitimEl[camel(id.replace(/^tanitim-?/, '') || 'root')] = byId(id)
  })
  if (!tanitimEl.root) return false
  Array.from(tanitimEl.root.querySelectorAll('.tanitim-cmd[data-cmd]')).forEach(tanitimBuildCommand)
  tanitimEl.login.addEventListener('click', () => {
    showLogin('')
  })
  tanitimEl.join.addEventListener('click', () => {
    const open = tanitimEl.joinNote.hidden
    tanitimEl.joinNote.hidden = !open
    tanitimEl.join.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) focusNode(tanitimEl.joinCode)
  })
  tanitimEl.joinCode.addEventListener('click', () => {
    showLogin('')
    selectAuthTab('register', false)
    focusNode(el.registerName)
  })
  // Dil sayfa açıkken değişebilir: bağlantı adresi tıklanınca da güncellenir
  Object.keys(TANITIM_DOCS).forEach((id) => {
    const link = byId(id)
    if (link) link.addEventListener('click', tanitimDocLinks)
  })
  if (tanitimEl.back) {
    tanitimEl.back.addEventListener('click', () => {
      tanitimShow(true)
    })
  }
  return true
}

// Kopyalanabilir komut satırı: <div class="tanitim-cmd" data-cmd="..."> içine kod ve Kopyala düğmesi.
// {domain} yeri dile göre örnek alan adıyla dolar (dil değişince setLive yeniden yazar).
let tanitimCmdSeq = 0

function tanitimCommandText (template) {
  return template.split('{domain}').join(t('landing.guide.domain'))
}

function tanitimBuildCommand (box) {
  const template = box.getAttribute('data-cmd') || ''
  tanitimCmdSeq += 1
  const code = h('code', 'tanitim-cmd-text')
  code.id = 'tanitim-cmd-' + tanitimCmdSeq
  if (template.indexOf('{domain}') !== -1) setLive(code, () => tanitimCommandText(template))
  else code.textContent = template
  const copy = button('tanitim-cmd-copy', '', 'i-copy')
  const label = h('span', 'tanitim-cmd-copy-text', t('landing.copy'))
  label.setAttribute('data-i18n', 'landing.copy')
  copy.appendChild(label)
  copy.setAttribute('aria-describedby', code.id)
  copy.addEventListener('click', () => {
    copyWithToast(code.textContent)
  })
  const prompt = h('span', 'tanitim-cmd-prompt', '$')
  prompt.setAttribute('aria-hidden', 'true')
  box.appendChild(prompt)
  box.appendChild(code)
  box.appendChild(copy)
}

function tanitimDocLinks () {
  const lang = window.I18N && window.I18N.lang === 'en' ? 'en' : 'tr'
  Object.keys(TANITIM_DOCS).forEach((id) => {
    const link = byId(id)
    if (link) link.setAttribute('href', TANITIM_DOCS[id][lang])
  })
}

function tanitimDesktop () {
  return Boolean(window.telsizDesktop)
}

function tanitimShouldShow () {
  if (tanitimDesktop() || state.fragmentSeen) return false
  if (storeGet(KEYS.invite, 'session')) return false
  if (storeGet(TANITIM_KEY) === '1') return false
  return Boolean(byId('tanitim'))
}

// Başarılı oturumdan sonra bu tarayıcı tanıtımı atlar (03-auth.js startSession)
function tanitimRemember () {
  storeSet(TANITIM_KEY, '1')
}

function tanitimRender () {
  const info = state.info || {}
  tanitimEl.name.textContent = state.serverName || t('app.name')
  tanitimEl.host.textContent = window.location.host || ''
  tanitimEl.host.hidden = !window.location.host
  const about = typeof info.about === 'string' ? info.about.trim() : ''
  tanitimEl.aboutWrap.hidden = about === ''
  tanitimEl.about.textContent = about
  siteFootRender()
  tanitimDocLinks()
  // Frekans fotoğrafı ekranda adın solunda, yoksa veya yüklenemezse ekran eski görünümünde kalır (24-frekans.js)
  if (typeof frekansRenderIdentity === 'function') frekansRenderIdentity()
  // Masaüstü uygulamasında indirme kartı gösterilmez (sayfa masaüstünde zaten açılmaz, yine de korunur)
  if (tanitimEl.desktop) tanitimEl.desktop.hidden = tanitimDesktop()
}

// Ortak alt bilgi (#site-foot): sürüm ve masaüstünde gizlenen indirme bağlantısı. Tanıtımda ve her giriş
// kartında yeniden yazılır, sürüm GET /api/info yanıtından gelir.
function siteFootRender () {
  const info = state.info || {}
  const version = typeof info.version === 'string' ? info.version : ''
  if (tanitimEl.version) setLive(tanitimEl.version, () => (version ? t('landing.version', { version: version }) : t('app.name')))
  const download = byId('site-foot-download')
  if (download) download.hidden = tanitimDesktop()
}

// focus: kullanıcı giriş kartından geri döndüyse odak birincil düğmeye taşınır
function tanitimShow (focus) {
  if (!tanitimCache()) {
    showLogin('')
    return
  }
  showView('auth')
  el.authView.setAttribute('data-card', 'tanitim')
  setMsg(el.authNotice, '', 'error')
  const stage = el.authView.querySelector('.auth-stage')
  if (stage) stage.hidden = true
  tanitimEl.joinNote.hidden = true
  tanitimEl.join.setAttribute('aria-expanded', 'false')
  tanitimRender()
  tanitimEl.root.hidden = false
  document.title = state.serverName
  el.authView.scrollTop = 0
  if (focus) focusNode(tanitimEl.login)
}

// 03-auth.js showAuthCard her kartta çağırır: tanıtım gizlenir, giriş kartında geri dönüş düğmesi görünür
function tanitimHide (card) {
  if (!tanitimCache()) return
  tanitimEl.root.hidden = true
  const stage = el.authView.querySelector('.auth-stage')
  if (stage) stage.hidden = false
  if (tanitimEl.back) tanitimEl.back.hidden = card !== 'login' || tanitimDesktop()
  siteFootRender()
}
