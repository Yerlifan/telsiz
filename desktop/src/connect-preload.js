'use strict'

// Sunucu adresi penceresinin ön yükleme betiği. Sayfaya yalnızca üç çağrı açar:
// window.telsizConnect.init(), submit(adres, yineDeBaglan) ve cancel(). Adres ana süreçte
// doğrulanır, sunucu ana süreçte denetlenir (src/main.js, src/lib/server-url.js).

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = {
  connectInit: 'telsiz:connect-init',
  connectSubmit: 'telsiz:connect-submit',
  connectCancel: 'telsiz:connect-cancel'
}

contextBridge.exposeInMainWorld('telsizConnect', {
  init: () => ipcRenderer.invoke(CHANNELS.connectInit),
  submit: (address, acceptMismatch) => ipcRenderer.invoke(CHANNELS.connectSubmit, typeof address === 'string' ? address : '', acceptMismatch === true),
  cancel: () => ipcRenderer.invoke(CHANNELS.connectCancel)
})
