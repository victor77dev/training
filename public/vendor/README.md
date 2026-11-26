# Vendored libraries

Bundled locally so the app works offline and on GitHub Pages without a build step.

| File | Library | Version | License | Used for |
|---|---|---|---|---|
| `qrcode-generator.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT (header in file) | Drawing pairing QR codes |
| `jsQR.js` | [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 (`licenses/jsQR-LICENSE.txt`) | Scanning QR codes from the camera |
| `peerjs.min.js` | [PeerJS](https://github.com/peers/peerjs) | 1.5.4 | MIT (`licenses/peerjs-LICENSE.txt`) | Online code pairing via the free PeerJS broker |

Source: the npm registry tarballs of the versions above (`peerjs.min.js` with its sourceMappingURL line removed).
