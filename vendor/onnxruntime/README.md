# ONNX Runtime Web 1.30.0

Vendored same-origin WASM runtime for the local background-template worker. Only the WASM JavaScript bundle, runtime module and WASM binary are included. MIT license is reproduced in `LICENSE`.

- Package: https://www.npmjs.com/package/onnxruntime-web/v/1.30.0
- Archive: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz
- Archive SHA-512 integrity: `q0y+JrrtukXSzsBWEMccVfqX25LRmosXHF+CaRJmg8pZClzcV7svNc4rKY3jL02Vb7QmRMDs1SigqR4CXAfKYQ==`
- License source: https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE
- Deployment reference: https://onnxruntime.ai/docs/tutorials/web/deploy.html

The worker uses a single WASM thread, same-origin runtime/model URLs and no proxy. CSP permits `wasm-unsafe-eval` for WebAssembly compilation while still excluding `unsafe-eval` and inline scripts. The Service Worker verifies and precaches these files atomically with the rest of the app. First installation adds approximately 21 MB including the model and background; no additional AI API charge applies to background compositing.
