'use strict'

// Ekran paylaşımı seçicisinin ön yükleme betiği. Sayfaya yalnızca seçim çağrılarını açar:
// window.telsizPicker.init(), choose(kaynakKimligi, sistemSesi) ve cancel(). Seçilen kimliğin
// gerçekten sunulan kaynaklardan biri olduğu ana süreçte denetlenir (src/lib/screen-share.js).

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = {
  pickerInit: 'telsiz:picker-init',
  pickerChoose: 'telsiz:picker-choose',
  pickerCancel: 'telsiz:picker-cancel'
}

contextBridge.exposeInMainWorld('telsizPicker', {
  init: () => ipcRenderer.invoke(CHANNELS.pickerInit),
  choose: (id, systemAudio) => ipcRenderer.invoke(CHANNELS.pickerChoose, typeof id === 'string' ? id : '', systemAudio === true),
  cancel: () => ipcRenderer.invoke(CHANNELS.pickerCancel)
})
